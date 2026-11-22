"""
DeliveryEtaOrchestrator
=======================
End-to-end ETA prediction driven entirely from MongoDB data.

Flow for predict_by_delivery_id(delivery_id):
  1. Load delivery from MongoDB
  2. Resolve linked order (for order number)
  3. Resolve driver (for vehicle type + location)
  4. Geocode destination from delivery address (zone lookup)
  5. Geocode origin from driver zone / live coords
  6. Call OSRM for real road distance + duration
  7. Call OpenWeather for live weather at destination
  8. Run ML model (or heuristic fallback)
  9. Save prediction to MongoDB
 10. Return structured result
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import unicodedata
from datetime import datetime, timezone
from typing import Optional

import httpx

from .database import (
    get_delivery,
    get_driver,
    get_order_for_delivery,
    get_latest_prediction,
    get_prediction_history,
    save_prediction,
)
from .model import EtaModelService
from .schemas import EtaPredictionRequest, EtaPredictionResponse

log = logging.getLogger("delivery-eta.orchestrator")

OSRM_BASE      = os.getenv("OSRM_BASE_URL",       "https://router.project-osrm.org")
WEATHER_BASE   = os.getenv("OPENWEATHER_BASE_URL", "https://api.openweathermap.org")
WEATHER_KEY    = os.getenv("OPENWEATHER_API_KEY",  "")
HTTP_TIMEOUT   = float(os.getenv("HTTP_TIMEOUT_SECONDS", "6"))

# ── Tunisia zone → (lat, lng) ─────────────────────────────────────────────────
ZONE_COORDS: list[tuple[tuple[float, float], list[str]]] = [
    ((36.8065, 10.1815), ["grand tunis", "greater tunis", "tunis capitale", "tunis", "lac 1", "lac1", "lac 2", "lac2", "charguia"]),
    ((36.8782, 10.3247), ["la marsa", "marsa"]),
    ((36.8528, 10.3233), ["carthage", "kartaj"]),
    ((36.8702, 10.3417), ["sidi bou said", "sidi bousaid"]),
    ((36.8665, 10.1647), ["ariana", "raoued", "soukra", "la soukra", "mnihla"]),
    ((36.7435, 10.2319), ["ben arous", "rades", "megrine", "mourouj", "ezzahra"]),
    ((36.8080, 10.0972), ["manouba", "den den", "douar hicher"]),
    ((36.4513, 10.7353), ["nabeul", "nabel"]),
    ((36.5786, 10.8583), ["korba"]),
    ((36.4001, 10.6167), ["hammamet", "yasmine hammamet"]),
    ((37.2744,  9.8739), ["bizerte", "bizert", "menzel bourguiba", "ras jebel"]),
    ((35.8245, 10.6346), ["sousse", "sahloul", "khezama", "akouda"]),
    ((35.7643, 10.8113), ["monastir", "ksar hellal"]),
    ((35.5047, 11.0622), ["mahdia", "chebba"]),
    ((34.7406, 10.7603), ["sfax", "sakiet ezzit", "sakiet eddaier", "thyna"]),
    ((35.6781, 10.0963), ["kairouan"]),
    ((35.0382,  9.4858), ["sidi bouzid"]),
    ((35.1676,  8.8365), ["kasserine"]),
    ((34.4250,  8.7842), ["gafsa"]),
    ((33.8881, 10.0975), ["gabes", "matmata"]),
    ((33.3549, 10.5055), ["medenine", "djerba", "houmt souk"]),
    ((32.9297, 10.4518), ["tataouine"]),
    ((33.7044,  8.9690), ["kebili", "douz"]),
    ((33.9197,  8.1335), ["tozeur", "nefta"]),
    ((36.7256,  9.1817), ["beja"]),
    ((36.5011,  8.7802), ["jendouba", "tabarka"]),
    ((36.1822,  8.7148), ["kef", "le kef"]),
    ((36.0833,  9.3667), ["siliana"]),
    ((36.4029, 10.1429), ["zaghouan"]),
]

DEFAULT_COORDS = (36.8065, 10.1815)   # Grand Tunis fallback


# ── Geocoding helpers ─────────────────────────────────────────────────────────

def _normalize(text: str) -> str:
    nfkd = unicodedata.normalize("NFD", text or "")
    ascii_str = nfkd.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9 ]", " ", ascii_str.lower()).strip()


def geocode_address(address: str) -> tuple[float, float]:
    """Best-effort geocode from a free-text Tunisian address."""
    norm = _normalize(address)
    best: Optional[tuple[tuple[float, float], int]] = None
    for coords, aliases in ZONE_COORDS:
        for alias in aliases:
            a = _normalize(alias)
            if f" {a} " in f" {norm} " or norm == a or norm.startswith(a + " ") or norm.endswith(" " + a):
                if best is None or len(a) > best[1]:
                    best = (coords, len(a))
    if best:
        return best[0]
    # Deterministic jitter so same address always maps to same point
    return _jitter(DEFAULT_COORDS, address, 0.11)


def _jitter(base: tuple[float, float], seed: str, amount: float) -> tuple[float, float]:
    h = int(hashlib.md5(seed.encode()).hexdigest(), 16)
    dlat = ((h % 2000) / 1000.0 - 1.0) * amount
    dlng = (((h >> 16) % 2000) / 1000.0 - 1.0) * amount
    return (round(base[0] + dlat, 5), round(base[1] + dlng, 5))


def _is_valid_tunisia(lat: float, lng: float) -> bool:
    return 30 <= lat <= 38.5 and 7 <= lng <= 12.5


# ── External API calls ────────────────────────────────────────────────────────

def fetch_route(origin: tuple[float, float], dest: tuple[float, float]) -> tuple[float, float]:
    """
    Call OSRM to get real road distance (km) and duration (min).
    Returns (distance_km, duration_min).
    Falls back to haversine if OSRM is unavailable.
    """
    try:
        coords_str = f"{origin[1]},{origin[0]};{dest[1]},{dest[0]}"
        url = f"{OSRM_BASE}/route/v1/driving/{coords_str}?overview=false&alternatives=false"
        with httpx.Client(timeout=HTTP_TIMEOUT) as client:
            resp = client.get(url)
            data = resp.json()
        routes = data.get("routes", [])
        if routes:
            r = routes[0]
            dist_km  = float(r["distance"]) / 1000.0
            dur_min  = float(r["duration"]) / 60.0
            if dist_km > 0 and dur_min > 0:
                log.info(f"OSRM route: {dist_km:.2f} km, {dur_min:.1f} min")
                return dist_km, dur_min
    except Exception as e:
        log.warning(f"OSRM unavailable, using haversine: {e}")
    dist_km = _haversine(origin, dest)
    dur_min = max(5.0, (dist_km / 35.0) * 60.0 + 5.0)
    return dist_km, dur_min


def fetch_weather(lat: float, lng: float) -> tuple[str, float, float]:
    """
    Call OpenWeather to get current conditions.
    Returns (weather_main, temperature_c, wind_speed_ms).
    Falls back to Clear/22°C/3 m/s if unavailable.
    """
    if not WEATHER_KEY:
        return "Clear", 22.0, 3.0
    try:
        url = (
            f"{WEATHER_BASE}/data/2.5/weather"
            f"?lat={lat}&lon={lng}&units=metric&appid={WEATHER_KEY}"
        )
        with httpx.Client(timeout=HTTP_TIMEOUT) as client:
            data = client.get(url).json()
        weather_list = data.get("weather", [{}])
        main_str  = weather_list[0].get("main", "Clear") if weather_list else "Clear"
        temp      = float(data.get("main", {}).get("temp", 22.0))
        wind      = float(data.get("wind", {}).get("speed", 3.0))
        log.info(f"Weather at ({lat},{lng}): {main_str}, {temp}°C, wind {wind} m/s")
        return main_str, temp, wind
    except Exception as e:
        log.warning(f"OpenWeather unavailable: {e}")
        return "Clear", 22.0, 3.0


def _haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    R = 6371.0
    dlat = math.radians(b[0] - a[0])
    dlng = math.radians(b[1] - a[1])
    h = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0]))
         * math.sin(dlng / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


# ── Main orchestrator ─────────────────────────────────────────────────────────

class DeliveryEtaOrchestrator:

    def __init__(self, model_service: EtaModelService):
        self.model = model_service

    # ── Public API ────────────────────────────────────────────────────────────

    def predict_by_delivery_id(
        self,
        delivery_id: str,
        origin_lat: Optional[float] = None,
        origin_lng: Optional[float] = None,
        dest_lat:   Optional[float] = None,
        dest_lng:   Optional[float] = None,
    ) -> dict:
        """
        Full end-to-end prediction driven from MongoDB.

        1. Load delivery + order + driver from MongoDB
        2. Geocode origin (driver) and destination (delivery address)
        3. Fetch real road route from OSRM
        4. Fetch live weather from OpenWeather
        5. Run ML model
        6. Save prediction to MongoDB
        7. Return result dict
        """
        # ── 1. Load from MongoDB ──────────────────────────────────────────────
        delivery = get_delivery(delivery_id)
        if not delivery:
            raise ValueError(f"Delivery not found: {delivery_id}")

        order  = get_order_for_delivery(delivery)
        driver = get_driver(delivery.get("userId"))

        order_number = (
            order.get("orderNumber")
            if order
            else self._format_order_number(delivery)
        )
        order_id_str = str(order["_id"]) if order else None

        # ── 2. Geocode ────────────────────────────────────────────────────────
        # Destination: use provided coords, else geocode from address
        if dest_lat and dest_lng and _is_valid_tunisia(dest_lat, dest_lng):
            destination = (dest_lat, dest_lng)
        else:
            destination = geocode_address(delivery.get("address", ""))

        # Origin: use provided coords, else driver zone / live location
        if origin_lat and origin_lng and _is_valid_tunisia(origin_lat, origin_lng):
            origin = (origin_lat, origin_lng)
        elif driver:
            origin = self._driver_coords(driver)
        else:
            origin = (destination[0] + 0.02, destination[1] - 0.02)

        # ── 3. Route ──────────────────────────────────────────────────────────
        dist_km, dur_min = fetch_route(origin, destination)

        # ── 4. Weather ────────────────────────────────────────────────────────
        weather_main, temp_c, wind_speed = fetch_weather(*destination)

        # ── 5. ML prediction ──────────────────────────────────────────────────
        now = datetime.now()
        vehicle_type = (driver or {}).get("vehicleType") or "Car"
        if not vehicle_type.strip():
            vehicle_type = "Car"

        request = EtaPredictionRequest(
            orderId              = order_number or delivery_id,
            distanceKm           = dist_km,
            routeDurationMinutes = dur_min,
            weather              = weather_main,
            temperatureC         = temp_c,
            windSpeed            = wind_speed,
            isRain               = weather_main.lower() in ("rain", "thunderstorm", "drizzle"),
            hourOfDay            = now.hour,
            dayOfWeek            = now.isoweekday(),
            vehicleType          = vehicle_type,
        )
        prediction: EtaPredictionResponse = self.model.predict(request)

        # ── 6. Save to MongoDB ────────────────────────────────────────────────
        doc = {
            "deliveryId":          delivery_id,
            "orderId":             order_id_str,
            "orderNumber":         order_number,
            "estimatedMinutes":    prediction.estimatedMinutes,
            "riskLevel":           prediction.riskLevel,
            "reason":              prediction.reason,
            "weather":             prediction.weather,
            "temperatureC":        temp_c,
            "windSpeed":           wind_speed,
            "distanceKm":          round(dist_km, 2),
            "routeDurationMinutes": round(dur_min, 1),
            "originLatitude":      origin[0],
            "originLongitude":     origin[1],
            "destinationLatitude": destination[0],
            "destinationLongitude": destination[1],
            "vehicleType":         vehicle_type,
            "modelVersion":        prediction.modelVersion,
            "source":              "ML" if "heuristic" not in prediction.modelVersion else "HEURISTIC",
            "createdAt":           datetime.utcnow(),
        }
        inserted_id = save_prediction(doc)
        doc["id"] = inserted_id

        log.info(
            f"Prediction saved for delivery {delivery_id}: "
            f"{prediction.estimatedMinutes} min, {prediction.riskLevel} risk, "
            f"{dist_km:.2f} km"
        )
        return doc

    def get_latest(self, delivery_id: str) -> Optional[dict]:
        return get_latest_prediction(delivery_id)

    def get_history(self, delivery_id: str) -> list[dict]:
        return get_prediction_history(delivery_id)

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _driver_coords(self, driver: dict) -> tuple[float, float]:
        """Resolve driver coordinates: live location → zone → default."""
        # Live GPS (fresh within 6 hours)
        lat = driver.get("currentLatitude") or driver.get("latitude")
        lng = driver.get("currentLongitude") or driver.get("longitude")
        updated = driver.get("lastLocationUpdatedAt")
        if lat and lng and _is_valid_tunisia(float(lat), float(lng)):
            if updated:
                try:
                    ts = datetime.fromisoformat(str(updated).replace("Z", "+00:00"))
                    age_h = (datetime.now(timezone.utc) - ts).total_seconds() / 3600
                    if age_h <= 6:
                        return (float(lat), float(lng))
                except Exception:
                    pass

        # Zone-based geocoding
        zone = driver.get("deliveryZone") or ""
        if zone:
            coords = geocode_address(zone)
            if coords != DEFAULT_COORDS:
                return coords

        return _jitter(DEFAULT_COORDS, driver.get("email", ""), 0.055)

    @staticmethod
    def _format_order_number(delivery: dict) -> str:
        cart_id = delivery.get("cartId")
        if not cart_id:
            return "ORD-UNKNOWN"
        year = datetime.utcnow().year
        short = str(cart_id)[:5].upper()
        return f"ORD-{year}-{short}"

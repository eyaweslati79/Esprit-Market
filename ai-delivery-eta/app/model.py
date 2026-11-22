"""
EtaModelService
===============
Wraps the trained GradientBoosting ETA model and RandomForest risk classifier.

The model takes OSRM road travel time (route_duration_min) as its primary
input and learns to add realistic overhead on top of it:
  estimated_minutes = route_duration_min + overhead(vehicle, weather, hour, ...)

speed_kmh is derived from distance / route_duration and captures the
combined effect of vehicle type + road conditions in a single number.
"""

from __future__ import annotations

from pathlib import Path
import json
import os

import joblib

from .schemas import EtaPredictionRequest, EtaPredictionResponse

MODEL_VERSION = "delivery-eta-v2"

# Overhead per vehicle type (minutes added on top of road travel time)
VEHICLE_OVERHEAD = {
    "car":        6.0,
    "motorcycle": 4.0,
    "scooter":    3.5,
    "bike":       2.5,
}


class EtaModelService:
    def __init__(self) -> None:
        self.eta_model  = self._load(os.getenv("DELIVERY_ETA_MODEL_PATH",  "artifacts/eta_model.joblib"))
        self.risk_model = self._load(os.getenv("DELIVERY_RISK_MODEL_PATH", "artifacts/risk_model.joblib"))
        self.metadata   = self._load_metadata(os.getenv("DELIVERY_ETA_METADATA_PATH", "artifacts/metadata.json"))

    # ── Public ────────────────────────────────────────────────────────────────

    def predict(self, payload: EtaPredictionRequest) -> EtaPredictionResponse:
        if self.eta_model and self.risk_model:
            frame    = self._as_frame(payload)
            estimated = int(round(float(self.eta_model.predict(frame)[0])))
            risk      = str(self.risk_model.predict(frame)[0])
            reason    = self._reason(payload, risk)
            return EtaPredictionResponse(
                orderId          = payload.orderId,
                estimatedMinutes = max(3, estimated),
                riskLevel        = risk,
                reason           = reason,
                weather          = payload.weather,
                distanceKm       = round(payload.distanceKm, 2),
                modelVersion     = self.metadata.get("modelVersion", MODEL_VERSION),
            )

        # ML model not loaded — use physics-based heuristic
        estimated, risk, reason = self._heuristic(payload)
        return EtaPredictionResponse(
            orderId          = payload.orderId,
            estimatedMinutes = estimated,
            riskLevel        = risk,
            reason           = reason,
            weather          = payload.weather,
            distanceKm       = round(payload.distanceKm, 2),
            modelVersion     = f"{MODEL_VERSION}-heuristic",
        )

    # ── Feature engineering ───────────────────────────────────────────────────

    def _as_frame(self, payload: EtaPredictionRequest):
        import pandas as pd

        # Derive speed_kmh from OSRM distance + duration
        # This is the key dynamic feature: it captures actual road conditions
        dur = max(payload.routeDurationMinutes, 0.1)
        speed_kmh = round((payload.distanceKm / dur) * 60.0, 1)
        speed_kmh = min(speed_kmh, 120.0)   # cap at 120 km/h

        return pd.DataFrame([{
            "distance_km":        payload.distanceKm,
            "route_duration_min": payload.routeDurationMinutes,  # PRIMARY: OSRM road time
            "speed_kmh":          speed_kmh,                     # derived dynamic feature
            "weather":            payload.weather,
            "temperature_c":      payload.temperatureC,
            "wind_speed":         payload.windSpeed,
            "is_rain":            int(payload.isRain),
            "hour":               payload.hourOfDay,
            "day_of_week":        payload.dayOfWeek,
            "vehicle_type":       payload.vehicleType,
        }])

    # ── Physics-based heuristic (fallback when model not loaded) ─────────────

    def _heuristic(self, payload: EtaPredictionRequest) -> tuple[int, str, str]:
        """
        When the ML model is unavailable, compute ETA from first principles:
          total = OSRM_road_time + vehicle_overhead + condition_penalties

        OSRM already accounts for road speed and distance.
        We only add overhead that OSRM doesn't know about.
        """
        # Validate OSRM duration: must imply ≥ 15 km/h (otherwise it's wrong)
        min_plausible_dur = (payload.distanceKm / 80.0) * 60.0   # 80 km/h max
        max_plausible_dur = (payload.distanceKm / 15.0) * 60.0   # 15 km/h min

        if 0 < payload.routeDurationMinutes <= max_plausible_dur:
            road_time = max(payload.routeDurationMinutes, min_plausible_dur)
        else:
            # OSRM unavailable or returned garbage — compute from vehicle speed
            vehicle_speeds = {"car": 35, "motorcycle": 40, "scooter": 28, "bike": 15}
            v_key  = payload.vehicleType.lower()
            speed  = vehicle_speeds.get(v_key, 35)
            road_time = (payload.distanceKm / speed) * 60.0

        # Vehicle-specific overhead (parking, handoff, building access)
        v_key    = payload.vehicleType.lower()
        overhead = VEHICLE_OVERHEAD.get(v_key, 6.0)

        # Condition penalties (on top of OSRM time)
        penalty = 0.0
        risk_points = 0
        reasons: list[str] = []

        weather = payload.weather.lower()
        if payload.isRain or any(t in weather for t in ["rain", "storm", "thunder", "drizzle"]):
            penalty     += road_time * 0.18   # 18% slower in rain
            overhead    += 2.5                # extra handoff time
            risk_points += 2
            reasons.append("rain")
        elif any(t in weather for t in ["mist", "fog", "snow"]):
            penalty     += road_time * 0.10
            risk_points += 1
            reasons.append(payload.weather.lower())

        if payload.hourOfDay in (7, 8, 17, 18, 19):
            penalty     += road_time * 0.15   # 15% slower in rush hour
            risk_points += 1
            reasons.append("rush hour")

        if payload.windSpeed >= 12:
            penalty     += road_time * 0.06
            risk_points += 1
            reasons.append("wind")

        if payload.distanceKm >= 15:
            risk_points += 2
            reasons.append("long distance")
        elif payload.distanceKm >= 8:
            risk_points += 1
            reasons.append("medium distance")

        total = road_time + penalty + overhead
        risk  = "HIGH" if risk_points >= 4 else "MEDIUM" if risk_points >= 2 else "LOW"
        reason_str = " + ".join(reasons) if reasons else "normal conditions"
        return max(3, int(round(total))), risk, reason_str

    def _reason(self, payload: EtaPredictionRequest, risk: str) -> str:
        parts = []
        if payload.isRain:
            parts.append("rain")
        if payload.distanceKm >= 8:
            parts.append("long distance" if payload.distanceKm >= 15 else "medium distance")
        if payload.hourOfDay in (7, 8, 17, 18, 19):
            parts.append("rush hour")
        if payload.windSpeed >= 12:
            parts.append("wind")
        if not parts:
            parts.append("normal conditions")
        return f"Distance {payload.distanceKm:.1f} km. Flags: {' + '.join(parts)} ({risk.lower()} risk)"

    # ── Loaders ───────────────────────────────────────────────────────────────

    def _load(self, path: str):
        file = Path(path)
        return joblib.load(file) if file.exists() else None

    def _load_metadata(self, path: str) -> dict:
        file = Path(path)
        if not file.exists():
            return {"modelVersion": f"{MODEL_VERSION}-heuristic"}
        return json.loads(file.read_text(encoding="utf-8"))

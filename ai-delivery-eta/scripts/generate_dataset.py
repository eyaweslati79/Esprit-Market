"""
Dataset generator for the Delivery ETA model.

Each row represents one real delivery scenario.
The key insight: route_duration_min comes from OSRM (real road time).
The model's job is to add the overhead on top of that:
  - loading/handoff time
  - traffic conditions beyond what OSRM knows
  - vehicle-specific delays (parking, access)
  - weather impact on actual travel vs OSRM estimate

Features:
  distance_km          — straight-line or road distance (km)
  route_duration_min   — OSRM road travel time (minutes, the primary signal)
  speed_kmh            — implied speed = distance / route_duration * 60
  weather              — weather condition string
  temperature_c        — temperature in Celsius
  wind_speed           — wind speed in m/s
  is_rain              — 1 if rain/storm
  hour                 — hour of day (0-23)
  day_of_week          — 1=Mon … 7=Sun
  vehicle_type         — Car / Motorcycle / Scooter / Bike

Target:
  estimated_minutes    — total delivery time including overhead
  risk_level           — LOW / MEDIUM / HIGH
"""

from pathlib import Path
import random
import math

import pandas as pd

RAW_PATH = Path("data/raw/delivery_eta_dataset.csv")
WEATHER  = ["Clear", "Clouds", "Rain", "Thunderstorm", "Mist"]
VEHICLES = ["Car", "Motorcycle", "Scooter", "Bike"]

# Realistic road speeds per vehicle (km/h) — what OSRM would compute
ROAD_SPEED = {
    "Car":        (28, 60),   # urban/suburban car
    "Motorcycle": (32, 65),   # slightly faster, lane-splits
    "Scooter":    (22, 45),   # slower, urban only
    "Bike":       (10, 20),   # bicycle
}

# Fixed overhead per vehicle (minutes): parking, handoff, access
OVERHEAD = {
    "Car":        (4, 9),
    "Motorcycle": (2, 6),
    "Scooter":    (2, 5),
    "Bike":       (1, 4),
}


def simulate_row(rng: random.Random) -> dict:
    distance = round(rng.uniform(0.5, 32.0), 2)
    weather  = rng.choices(WEATHER, weights=[45, 25, 18, 4, 8])[0]
    hour     = rng.randint(6, 22)
    wind     = round(rng.uniform(0, 20), 1)
    vehicle  = rng.choice(VEHICLES)
    temp     = round(rng.uniform(8, 40), 1)

    # ── Step 1: compute OSRM-like road speed ──────────────────────────────────
    lo, hi = ROAD_SPEED[vehicle]
    speed = rng.uniform(lo, hi)

    # Rush hour: −15 to −25% speed
    if hour in (7, 8, 17, 18, 19):
        speed *= rng.uniform(0.75, 0.85)

    # Weather impact on road speed
    if weather in ("Rain", "Thunderstorm"):
        speed *= rng.uniform(0.68, 0.82)
    elif weather == "Mist":
        speed *= rng.uniform(0.84, 0.93)
    elif weather == "Clouds":
        speed *= rng.uniform(0.96, 1.00)

    speed = max(5.0, speed)

    # ── Step 2: OSRM road travel time ─────────────────────────────────────────
    # OSRM gives pure travel time — no overhead
    road_travel_min = (distance / speed) * 60.0
    # Small OSRM noise (±5%)
    road_travel_min *= rng.uniform(0.95, 1.05)
    road_travel_min = round(road_travel_min, 1)

    # ── Step 3: overhead (parking, handoff, building access) ──────────────────
    oh_lo, oh_hi = OVERHEAD[vehicle]
    overhead = rng.uniform(oh_lo, oh_hi)

    # Extra overhead for bad weather (finding shelter, slower handoff)
    if weather in ("Rain", "Thunderstorm"):
        overhead += rng.uniform(1.5, 4.0)

    # ── Step 4: total estimated delivery time ─────────────────────────────────
    total = road_travel_min + overhead
    # Tiny real-world noise (±1.5 min)
    total += rng.uniform(-1.5, 1.5)
    estimated = max(3, int(round(total)))

    # ── Step 5: implied speed (what the model sees) ───────────────────────────
    speed_kmh = round((distance / road_travel_min) * 60.0, 1) if road_travel_min > 0 else 0.0

    # ── Step 6: risk label ────────────────────────────────────────────────────
    risk_score = 0
    risk_score += 2 if distance >= 15 else 1 if distance >= 8 else 0
    risk_score += 2 if weather in ("Rain", "Thunderstorm") else 1 if weather == "Mist" else 0
    risk_score += 1 if hour in (7, 8, 17, 18, 19) else 0
    risk_score += 1 if wind >= 12 else 0
    risk_score += 1 if vehicle == "Bike" and distance >= 8 else 0
    risk_level = "HIGH" if risk_score >= 4 else "MEDIUM" if risk_score >= 2 else "LOW"

    return {
        "distance_km":        distance,
        "route_duration_min": road_travel_min,
        "speed_kmh":          speed_kmh,
        "weather":            weather,
        "temperature_c":      temp,
        "wind_speed":         wind,
        "is_rain":            int(weather in ("Rain", "Thunderstorm")),
        "hour":               hour,
        "day_of_week":        rng.randint(1, 7),
        "vehicle_type":       vehicle,
        "estimated_minutes":  estimated,
        "risk_level":         risk_level,
    }


def main() -> None:
    RAW_PATH.parent.mkdir(parents=True, exist_ok=True)
    rng = random.Random(42)
    rows = [simulate_row(rng) for _ in range(3000)]
    df = pd.DataFrame(rows)
    df.to_csv(RAW_PATH, index=False)
    print(f"Generated {len(rows)} rows -> {RAW_PATH}")

    # Sanity check: print expected ETA per distance/vehicle
    print("\nSanity check (Clear weather, non-rush hour):")
    for vehicle in ["Car", "Motorcycle", "Scooter", "Bike"]:
        for dist in [2, 5, 10, 20]:
            sub = df[
                (df["distance_km"].between(dist - 0.8, dist + 0.8)) &
                (df["vehicle_type"] == vehicle) &
                (df["weather"] == "Clear") &
                (~df["hour"].isin([7, 8, 17, 18, 19]))
            ]
            if not sub.empty:
                avg = sub["estimated_minutes"].mean()
                lo  = sub["estimated_minutes"].min()
                hi  = sub["estimated_minutes"].max()
                print(f"  {vehicle:12s} ~{dist:2d} km → avg {avg:5.1f} min  ({lo}–{hi})")


if __name__ == "__main__":
    main()

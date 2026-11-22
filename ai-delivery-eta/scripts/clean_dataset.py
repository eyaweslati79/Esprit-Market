from pathlib import Path

import numpy as np
import pandas as pd

RAW_PATH   = Path("data/raw/delivery_eta_dataset.csv")
CLEAN_PATH = Path("data/cleaned/delivery_eta_dataset_clean.csv")


def main() -> None:
    if not RAW_PATH.exists():
        raise SystemExit("Run scripts/generate_dataset.py first.")

    df = pd.read_csv(RAW_PATH)
    df = df.drop_duplicates()

    df["weather"]      = df["weather"].fillna("Clear").astype(str).str.strip().str.title()
    df["vehicle_type"] = df["vehicle_type"].fillna("Car").astype(str).str.strip().str.title()

    numeric = [
        "distance_km", "route_duration_min", "temperature_c", "wind_speed",
        "is_rain", "hour", "day_of_week", "estimated_minutes",
    ]
    for col in numeric:
        df[col] = pd.to_numeric(df[col], errors="coerce")
        df[col] = df[col].fillna(df[col].median())

    # Derive speed_kmh — the key dynamic feature
    df["speed_kmh"] = (df["distance_km"] / df["route_duration_min"].replace(0, np.nan)) * 60.0
    df["speed_kmh"] = df["speed_kmh"].fillna(35.0).round(1).clip(upper=120.0)

    # Sanity filters
    df = df[(df["distance_km"] >= 0) & (df["estimated_minutes"] >= 1)]
    df = df[df["route_duration_min"] > 0]

    CLEAN_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(CLEAN_PATH, index=False)
    print(f"Cleaned {len(df)} rows -> {CLEAN_PATH}")
    print(f"  speed_kmh range: {df['speed_kmh'].min():.1f} – {df['speed_kmh'].max():.1f} km/h")
    print(f"  ETA range:       {df['estimated_minutes'].min()} – {df['estimated_minutes'].max()} min")


if __name__ == "__main__":
    main()

"""
Train the Delivery ETA model.

Key design decisions:
  - route_duration_min is the PRIMARY feature (real OSRM road time)
  - speed_kmh is derived from distance/duration — captures vehicle+conditions
  - GradientBoostingRegressor handles the non-linear overhead on top of OSRM time
  - RandomForestClassifier for risk level (categorical output)
"""

from pathlib import Path
import json

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingRegressor, RandomForestClassifier
from sklearn.metrics import accuracy_score, mean_absolute_error
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

CLEAN_PATH = Path("data/cleaned/delivery_eta_dataset_clean.csv")
ARTIFACTS  = Path("artifacts")

# route_duration_min and speed_kmh are the two most important features.
# The model learns: estimated_minutes ≈ route_duration_min + overhead(conditions)
FEATURES = [
    "distance_km",
    "route_duration_min",   # PRIMARY: real OSRM road travel time
    "speed_kmh",            # derived: distance / route_duration * 60
    "weather",
    "temperature_c",
    "wind_speed",
    "is_rain",
    "hour",
    "day_of_week",
    "vehicle_type",
]
CATEGORICAL = ["weather", "vehicle_type"]
NUMERIC     = [f for f in FEATURES if f not in CATEGORICAL]


def main() -> None:
    if not CLEAN_PATH.exists():
        raise SystemExit("Run scripts/clean_dataset.py first.")

    df = pd.read_csv(CLEAN_PATH)

    # Derive speed_kmh if not present (backward compat with old datasets)
    if "speed_kmh" not in df.columns:
        df["speed_kmh"] = (df["distance_km"] / df["route_duration_min"].replace(0, np.nan)) * 60.0
        df["speed_kmh"] = df["speed_kmh"].fillna(35.0).clip(upper=120.0)

    x      = df[FEATURES]
    y_eta  = df["estimated_minutes"]
    y_risk = df["risk_level"]

    x_train, x_test, eta_train, eta_test, risk_train, risk_test = train_test_split(
        x, y_eta, y_risk, test_size=0.2, random_state=42, stratify=y_risk
    )

    preprocessor = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL),
        ("num", "passthrough", NUMERIC),
    ])

    # GradientBoosting learns the non-linear overhead on top of route_duration_min
    eta_model = Pipeline([
        ("features", preprocessor),
        ("model", GradientBoostingRegressor(
            n_estimators=200,
            learning_rate=0.08,
            max_depth=4,
            min_samples_leaf=5,
            subsample=0.85,
            random_state=42,
        )),
    ])

    risk_model = Pipeline([
        ("features", preprocessor),
        ("model", RandomForestClassifier(
            n_estimators=150,
            max_depth=8,
            min_samples_leaf=4,
            random_state=42,
        )),
    ])

    print("Training ETA model...")
    eta_model.fit(x_train, eta_train)
    print("Training risk model...")
    risk_model.fit(x_train, risk_train)

    eta_pred  = eta_model.predict(x_test)
    risk_pred = risk_model.predict(x_test)
    mae       = mean_absolute_error(eta_test, eta_pred)
    acc       = accuracy_score(risk_test, risk_pred)

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    joblib.dump(eta_model,  ARTIFACTS / "eta_model.joblib")
    joblib.dump(risk_model, ARTIFACTS / "risk_model.joblib")

    metadata = {
        "modelVersion":  "delivery-eta-v2",
        "maeMinutes":    round(float(mae), 2),
        "riskAccuracy":  round(float(acc), 3),
        "features":      FEATURES,
        "primarySignal": "route_duration_min (OSRM road time)",
    }
    (ARTIFACTS / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"\nModel trained:")
    print(f"  MAE:           {mae:.2f} min")
    print(f"  Risk accuracy: {acc:.1%}")
    print(f"  Version:       delivery-eta-v2")

    # Validation: show predictions for key scenarios
    print("\nValidation (model predictions):")
    scenarios = [
        (2.0,  3.4, 35.3, "Clear",        22, 3, False, 14, 3, "Car"),
        (5.8,  9.9, 35.2, "Clear",        22, 3, False, 14, 3, "Car"),
        (5.8, 11.6, 30.0, "Clear",        22, 3, False,  8, 2, "Car"),   # rush hour
        (5.8, 12.1, 28.8, "Rain",         18, 8, True,  18, 4, "Car"),   # rain+rush
        (10.0, 17.1, 35.1, "Clear",       22, 3, False, 14, 3, "Car"),
        (20.0, 34.3, 35.0, "Clear",       22, 3, False, 14, 3, "Car"),
        (5.8,  9.9, 35.2, "Clear",        22, 3, False, 14, 3, "Motorcycle"),
        (5.8, 16.6, 21.0, "Clear",        22, 3, False, 14, 3, "Scooter"),
        (5.8, 26.4, 13.2, "Clear",        22, 3, False, 14, 3, "Bike"),
    ]
    cols = FEATURES
    for s in scenarios:
        row = pd.DataFrame([dict(zip(cols, s))])
        mins = int(round(float(eta_model.predict(row)[0])))
        risk = risk_model.predict(row)[0]
        spd  = round(s[0] / (mins / 60), 1) if mins > 0 else 0
        print(f"  {s[0]:5.1f}km  OSRM={s[1]:5.1f}min  {s[3]:12s}  h={s[7]:2d}  {s[9]:12s}"
              f"  → {mins:3d}min  ({spd}km/h eff)  {risk}")


if __name__ == "__main__":
    main()

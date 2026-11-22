"""
Esprit Market — Delivery ETA AI Service
========================================
Port 8000

Endpoints
---------
  POST /predict                          — raw prediction (numbers in, prediction out)
  POST /predict/{delivery_id}            — MongoDB-driven: load delivery, run model, save result
  POST /predict/{delivery_id}/with-coords — same but with explicit map coordinates
  GET  /latest/{delivery_id}             — most recent saved prediction for a delivery
  GET  /history/{delivery_id}            — full prediction history for a delivery
  GET  /health                           — health check (includes DB connectivity)
  GET  /stats                            — aggregate stats from MongoDB
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from bson import ObjectId
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .database import get_db, predictions_col
from .delivery_service import DeliveryEtaOrchestrator
from .model import EtaModelService
from .schemas import EtaPredictionRequest, EtaPredictionResponse

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger("delivery-eta")

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Esprit Market — Delivery ETA AI",
    description="ML-powered delivery time and risk prediction, connected to MongoDB",
    version="2.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Services ──────────────────────────────────────────────────────────────────
model_service = EtaModelService()
orchestrator  = DeliveryEtaOrchestrator(model_service)


# ── Pydantic models ───────────────────────────────────────────────────────────

class CoordsBody(BaseModel):
    """Optional explicit map coordinates for more accurate routing."""
    originLat: Optional[float] = None
    originLng: Optional[float] = None
    destLat:   Optional[float] = None
    destLng:   Optional[float] = None


def _serialize(doc: dict) -> dict:
    """Convert MongoDB ObjectIds and datetimes to JSON-safe types."""
    out = {}
    for k, v in doc.items():
        if isinstance(v, ObjectId):
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


# =============================================================================
# ROUTES
# =============================================================================

@app.get("/")
def root():
    return {
        "service": "Delivery ETA AI",
        "version": "2.0.0",
        "endpoints": {
            "raw_predict":        "POST /predict",
            "predict_by_id":      "POST /predict/{delivery_id}",
            "predict_with_coords":"POST /predict/{delivery_id}/with-coords",
            "latest":             "GET  /latest/{delivery_id}",
            "history":            "GET  /history/{delivery_id}",
            "health":             "GET  /health",
            "stats":              "GET  /stats",
        },
    }


@app.get("/health")
def health() -> dict:
    """Health check — also verifies MongoDB connectivity."""
    db_ok = False
    db_msg = "not connected"
    try:
        get_db().command("ping")
        db_ok  = True
        db_msg = "connected"
    except Exception as e:
        db_msg = str(e)

    model_ok = model_service.eta_model is not None and model_service.risk_model is not None
    return {
        "status":    "ok" if db_ok else "degraded",
        "service":   "delivery-eta-ai",
        "version":   "2.0.0",
        "mongodb":   db_msg,
        "ml_model":  "loaded" if model_ok else "heuristic-fallback",
    }


@app.post("/predict", response_model=EtaPredictionResponse)
def predict_raw(payload: EtaPredictionRequest) -> EtaPredictionResponse:
    """
    Raw prediction endpoint — accepts all features directly.
    Used by the Java backend when it has already resolved distance/weather.
    Does NOT read from or write to MongoDB.
    """
    return model_service.predict(payload)


@app.post("/predict/{delivery_id}")
def predict_by_id(delivery_id: str) -> dict:
    """
    MongoDB-driven prediction.
    Loads the delivery, order, and driver from MongoDB,
    calls OSRM + OpenWeather, runs the model, saves the result.
    """
    try:
        result = orchestrator.predict_by_delivery_id(delivery_id)
        return _serialize(result)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        log.error(f"Prediction failed for {delivery_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Prediction failed: {e}")


@app.post("/predict/{delivery_id}/with-coords")
def predict_by_id_with_coords(delivery_id: str, body: CoordsBody) -> dict:
    """
    MongoDB-driven prediction with explicit map coordinates.
    Coordinates from the Leaflet map override zone-centroid geocoding
    for more accurate OSRM routing.
    """
    try:
        result = orchestrator.predict_by_delivery_id(
            delivery_id,
            origin_lat=body.originLat,
            origin_lng=body.originLng,
            dest_lat=body.destLat,
            dest_lng=body.destLng,
        )
        return _serialize(result)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        log.error(f"Prediction failed for {delivery_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Prediction failed: {e}")


@app.get("/latest/{delivery_id}")
def latest(delivery_id: str) -> dict:
    """Return the most recent saved prediction for a delivery."""
    doc = orchestrator.get_latest(delivery_id)
    if not doc:
        raise HTTPException(status_code=404, detail="No prediction found for this delivery")
    return _serialize(doc)


@app.get("/history/{delivery_id}")
def history(delivery_id: str) -> list[dict]:
    """Return all predictions for a delivery, newest first."""
    docs = orchestrator.get_history(delivery_id)
    return [_serialize(d) for d in docs]


@app.get("/stats")
def stats() -> dict:
    """Aggregate statistics from the predictions collection."""
    try:
        col   = predictions_col()
        total = col.count_documents({})
        pipeline = [
            {"$group": {
                "_id":   "$riskLevel",
                "count": {"$sum": 1},
                "avgMinutes": {"$avg": "$estimatedMinutes"},
            }}
        ]
        risk_breakdown = {
            doc["_id"]: {
                "count":      doc["count"],
                "avgMinutes": round(doc["avgMinutes"], 1),
            }
            for doc in col.aggregate(pipeline)
        }
        avg_dist_pipeline = [
            {"$group": {"_id": None, "avgDist": {"$avg": "$distanceKm"}}}
        ]
        avg_dist_result = list(col.aggregate(avg_dist_pipeline))
        avg_dist = round(avg_dist_result[0]["avgDist"], 2) if avg_dist_result else 0.0

        return {
            "totalPredictions": total,
            "riskBreakdown":    risk_breakdown,
            "avgDistanceKm":    avg_dist,
        }
    except Exception as e:
        log.error(f"Stats query failed: {e}")
        return {"error": str(e)}

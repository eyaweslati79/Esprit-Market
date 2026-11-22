"""
MongoDB connection and collection helpers for the Delivery ETA AI service.

Collections used (all in the esprit_market database):
  deliveries              — SAV delivery documents
  orders                  — order documents (linked via cartId or orderId)
  users                   — driver profiles (vehicleType, deliveryZone, coords)
  delivery_eta_predictions — predictions written by this service
"""

from __future__ import annotations

import os
import logging
from datetime import datetime
from typing import Optional

from bson import ObjectId
from pymongo import MongoClient, DESCENDING
from pymongo.collection import Collection
from pymongo.database import Database

log = logging.getLogger("delivery-eta.db")

MONGO_URI = os.getenv(
    "MONGODB_URI",
    "mongodb+srv://admin:admin@espritmarket.pm6cdbe.mongodb.net/"
    "esprit_market?retryWrites=true&w=majority",
)
DB_NAME = os.getenv("MONGODB_DB", "esprit_market")

_client: Optional[MongoClient] = None


def get_db() -> Database:
    global _client
    if _client is None:
        _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    return _client[DB_NAME]


# ── Collection accessors ──────────────────────────────────────────────────────

def deliveries_col() -> Collection:
    return get_db()["deliveries"]

def orders_col() -> Collection:
    return get_db()["orders"]

def users_col() -> Collection:
    return get_db()["users"]

def predictions_col() -> Collection:
    return get_db()["delivery_eta_predictions"]


# ── Read helpers ──────────────────────────────────────────────────────────────

def get_delivery(delivery_id: str) -> Optional[dict]:
    """Fetch a delivery document by its ObjectId string."""
    try:
        return deliveries_col().find_one({"_id": ObjectId(delivery_id)})
    except Exception as e:
        log.warning(f"Could not fetch delivery {delivery_id}: {e}")
        return None


def get_order_for_delivery(delivery: dict) -> Optional[dict]:
    """Resolve the order linked to a delivery (via orderId or cartId)."""
    try:
        db = get_db()
        # Try direct orderId reference first
        order_id = delivery.get("orderId")
        if order_id:
            doc = db["orders"].find_one({"_id": ObjectId(str(order_id))})
            if doc:
                return doc
        # Fall back to cartId
        cart_id = delivery.get("cartId")
        if cart_id:
            return db["orders"].find_one({"cartId": ObjectId(str(cart_id))})
    except Exception as e:
        log.warning(f"Could not resolve order for delivery: {e}")
    return None


def get_driver(user_id) -> Optional[dict]:
    """Fetch a driver/user document."""
    if not user_id:
        return None
    try:
        return users_col().find_one({"_id": ObjectId(str(user_id))})
    except Exception as e:
        log.warning(f"Could not fetch driver {user_id}: {e}")
        return None


def get_latest_prediction(delivery_id: str) -> Optional[dict]:
    """Return the most recent prediction for a delivery."""
    try:
        return predictions_col().find_one(
            {"deliveryId": delivery_id},
            sort=[("createdAt", DESCENDING)],
        )
    except Exception as e:
        log.warning(f"Could not fetch latest prediction for {delivery_id}: {e}")
        return None


def get_prediction_history(delivery_id: str) -> list[dict]:
    """Return all predictions for a delivery, newest first."""
    try:
        return list(
            predictions_col()
            .find({"deliveryId": delivery_id})
            .sort("createdAt", DESCENDING)
        )
    except Exception as e:
        log.warning(f"Could not fetch prediction history for {delivery_id}: {e}")
        return []


# ── Write helpers ─────────────────────────────────────────────────────────────

def save_prediction(doc: dict) -> str:
    """
    Persist a prediction document and return its inserted _id as a string.
    The document should contain at minimum:
      deliveryId, orderId, orderNumber, estimatedMinutes, riskLevel,
      reason, weather, distanceKm, modelVersion, createdAt
    """
    try:
        doc.setdefault("createdAt", datetime.utcnow())
        result = predictions_col().insert_one(doc)
        return str(result.inserted_id)
    except Exception as e:
        log.error(f"Could not save prediction: {e}")
        return ""

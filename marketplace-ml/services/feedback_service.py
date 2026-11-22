"""
FeedbackService — real-time interaction ingestion.
Appends new interactions to the live CSV and triggers a full model retrain.
"""

from __future__ import annotations

import os
import logging
import pandas as pd
from datetime import datetime

log = logging.getLogger("marketplace-ml.feedback")

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
os.makedirs(DATA_DIR, exist_ok=True)
INTERACTIONS_FILE = os.path.join(DATA_DIR, "interactions_live.csv")

SCORE_MAP = {
    "view":        1.0,
    "like":        2.0,
    "favorite":    4.0,
    "add_to_cart": 3.0,
    "purchase":    5.0,
}


class FeedbackService:

    def __init__(self, engine):
        self.engine = engine

    def add_interaction(self, user_id: str, product_id: str, action: str) -> dict:
        score = SCORE_MAP.get(action, 1.0)

        new_row = {
            "interaction_id": int(datetime.now().timestamp() * 1000),
            "user_id":        str(user_id),
            "product_id":     str(product_id),
            "action":         action,
            "score":          score,
            "timestamp":      datetime.now().strftime("%Y-%m-%d"),
        }

        # Persist to live CSV so it survives restarts
        try:
            if os.path.exists(INTERACTIONS_FILE):
                df = pd.read_csv(INTERACTIONS_FILE)
                df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
            else:
                df = pd.DataFrame([new_row])
            df.to_csv(INTERACTIONS_FILE, index=False)
            log.info(f"✅ Interaction saved: user={user_id} product={product_id} action={action}")
        except Exception as e:
            log.warning(f"⚠️ Could not persist interaction: {e}")

        # Also update the in-memory engine immediately (lightweight)
        try:
            self.engine.record_feedback(user_id, product_id, action)
        except Exception as e:
            log.warning(f"⚠️ In-memory feedback update failed: {e}")

        return {
            "message":    "Interaction recorded — model will retrain in background",
            "user_id":    user_id,
            "product_id": product_id,
            "action":     action,
            "score":      score,
        }

    def retrain_model(self):
        """Full retrain: reload all data from MongoDB + live CSV."""
        log.info("🔄 Retraining marketplace ML model from MongoDB...")
        try:
            from main import (
                load_interactions_from_mongo,
                load_products_from_mongo,
                load_users_from_mongo,
            )
            interactions = load_interactions_from_mongo()
            products     = load_products_from_mongo()
            users        = load_users_from_mongo()
            self.engine.__init__(interactions, products, users)
            log.info("✅ Model retrained successfully")
        except Exception as e:
            log.error(f"❌ Retrain failed: {e}")

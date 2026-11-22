"""
Marketplace ML Service — Port 8003
====================================
Shein-style context-aware hybrid recommendation engine.

Context endpoints
-----------------
  GET  /recommend/home/{user_id}          → personalised multi-category feed
  GET  /recommend/product/{user_id}       → same-category items (product page)
  POST /recommend/cart                    → cart-category + complementary items

Generic / legacy endpoints
--------------------------
  GET  /recommend/{user_id}               → generic (delegates to home or category)
  POST /recommend                         → POST version of generic

Utility endpoints
-----------------
  POST /feedback                          → ingest real-time interaction
  POST /predict                           → product insight (promo/price signal)
  POST /predict/batch                     → batch product insights
  POST /reload                            → force reload engine from MongoDB
  GET  /health                            → health check
  GET  /stats                             → model statistics
"""

from __future__ import annotations

import os
import logging
from typing import List, Optional
from datetime import datetime

import pandas as pd
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo import MongoClient

from model.recommender import RecommendationEngine
from services.feedback_service import FeedbackService

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger("marketplace-ml")

# ── FastAPI ───────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Marketplace ML — Shein-style Recommender",
    description="Context-aware hybrid recommendation engine",
    version="5.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── MongoDB ───────────────────────────────────────────────────────────────────
MONGO_URI = os.getenv(
    "MONGODB_URI",
    "mongodb+srv://admin:admin@espritmarket.pm6cdbe.mongodb.net/"
    "esprit_market?retryWrites=true&w=majority",
)
DB_NAME = "esprit_market"

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)
INTERACTIONS_CSV = os.path.join(DATA_DIR, "interactions_live.csv")

# ── Global state ──────────────────────────────────────────────────────────────
engine:       Optional[RecommendationEngine] = None
feedback_svc: Optional[FeedbackService]      = None
mongo_client: Optional[MongoClient]          = None


# ── MongoDB loaders ───────────────────────────────────────────────────────────

def get_db():
    global mongo_client
    if mongo_client is None:
        mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    return mongo_client[DB_NAME]


def load_users_from_mongo() -> pd.DataFrame:
    rows = []
    try:
        db = get_db()
        for u in db["users"].find({}, {"_id": 1, "trustScore": 1}):
            rows.append({
                "user_id":    str(u["_id"]),
                "trustScore": float(u.get("trustScore", 1.0) or 1.0),
            })
        log.info(f"✅ Loaded {len(rows)} users")
    except Exception as e:
        log.error(f"❌ User load failed: {e}")
    if not rows:
        return pd.DataFrame(columns=["user_id", "trustScore"])
    return pd.DataFrame(rows)


def load_interactions_from_mongo() -> pd.DataFrame:
    rows = []
    try:
        db     = get_db()
        ts_now = datetime.utcnow().strftime("%Y-%m-%d")

        # Purchases
        order_map: dict = {}
        for order in db["orders"].find({}, {"_id": 1, "user": 1, "createdAt": 1}):
            uid = order.get("user")
            if uid:
                uid = str(uid["$id"]) if isinstance(uid, dict) and "$id" in uid else str(uid)
                ts  = order.get("createdAt", datetime.utcnow())
                order_map[str(order["_id"])] = (
                    uid,
                    ts.strftime("%Y-%m-%d") if hasattr(ts, "strftime") else ts_now,
                )
        for item in db["order_items"].find({}, {"orderId": 1, "productId": 1, "quantity": 1}):
            pid = item.get("productId")
            oid = str(item.get("orderId", ""))
            if pid and oid in order_map:
                uid, ts_str = order_map[oid]
                qty = item.get("quantity", 1) or 1
                rows.append({"user_id": uid, "product_id": str(pid),
                              "action": "purchase", "score": min(5.0 * qty, 15.0),
                              "timestamp": ts_str})

        # Favorites
        for fav in db["favoris"].find({}, {"userId": 1, "productId": 1, "createdAt": 1}):
            uid = fav.get("userId")
            pid = fav.get("productId")
            if uid and pid:
                ts = fav.get("createdAt", datetime.utcnow())
                rows.append({"user_id": str(uid), "product_id": str(pid),
                              "action": "favorite", "score": 4.0,
                              "timestamp": ts.strftime("%Y-%m-%d") if hasattr(ts, "strftime") else ts_now})

        # Cart items
        cart_map: dict = {}
        for cart in db["carts"].find({}, {"_id": 1, "userId": 1, "updatedAt": 1}):
            uid = cart.get("userId")
            if uid:
                ts = cart.get("updatedAt", datetime.utcnow())
                cart_map[str(cart["_id"])] = (
                    str(uid),
                    ts.strftime("%Y-%m-%d") if hasattr(ts, "strftime") else ts_now,
                )
        for item in db["cart_items"].find({}, {"cartId": 1, "productId": 1}):
            pid = item.get("productId")
            cid = str(item.get("cartId", ""))
            if pid and cid in cart_map:
                uid, ts_str = cart_map[cid]
                rows.append({"user_id": uid, "product_id": str(pid),
                              "action": "add_to_cart", "score": 3.0,
                              "timestamp": ts_str})

        log.info(f"✅ Loaded {len(rows)} interactions from MongoDB")
    except Exception as e:
        log.error(f"❌ Interaction load failed: {e}")

    # Merge live feedback CSV
    if os.path.exists(INTERACTIONS_CSV):
        try:
            live = pd.read_csv(INTERACTIONS_CSV)
            if not live.empty:
                rows.extend(live.to_dict("records"))
                log.info(f"  + {len(live)} live interactions merged")
        except Exception as e:
            log.warning(f"Could not read live CSV: {e}")

    if not rows:
        return pd.DataFrame(columns=["user_id", "product_id", "action", "score", "timestamp"])
    df = pd.DataFrame(rows)
    df["interaction_id"] = range(len(df))
    return df


def load_products_from_mongo() -> pd.DataFrame:
    rows = []
    try:
        db      = get_db()
        cat_map = {str(c["_id"]): c.get("name", "")
                   for c in db["categories"].find({}, {"_id": 1, "name": 1})}
        for p in db["products"].find({"status": "APPROVED"},
                                     {"_id": 1, "name": 1, "price": 1,
                                      "stock": 1, "categoryIds": 1}):
            pid      = str(p["_id"])
            cat_ids  = p.get("categoryIds", [])
            cat_name = cat_map.get(str(cat_ids[0]), "") if cat_ids else ""
            rows.append({"product_id": pid, "name": p.get("name", pid),
                         "category": cat_name, "price": p.get("price", 0.0),
                         "stock": p.get("stock", 0)})
        log.info(f"✅ Loaded {len(rows)} products")
    except Exception as e:
        log.error(f"❌ Product load failed: {e}")
    if not rows:
        return pd.DataFrame(columns=["product_id", "name", "category", "price", "stock"])
    return pd.DataFrame(rows)


# ── Engine loader ─────────────────────────────────────────────────────────────

def load_engine():
    global engine, feedback_svc
    try:
        interactions = load_interactions_from_mongo()
        products     = load_products_from_mongo()
        users        = load_users_from_mongo()
        engine       = RecommendationEngine(interactions, products, users)
        feedback_svc = FeedbackService(engine)
        log.info(
            f"✅ Engine ready — {len(interactions)} interactions, "
            f"{len(products)} products, {len(users)} users"
        )
    except Exception as e:
        log.error(f"❌ Engine load failed: {e}")
        engine = None


@app.on_event("startup")
def startup():
    load_engine()


# ── Pydantic models ───────────────────────────────────────────────────────────

class RecommendRequest(BaseModel):
    user_id:  str
    top_n:    int = 8
    category: Optional[str] = None


class CartRecommendRequest(BaseModel):
    user_id:   str
    cart_pids: List[str]   # product IDs currently in the cart
    top_n:     int = 8


class FeedbackRequest(BaseModel):
    user_id:    str
    product_id: str
    action:     str   # view | like | add_to_cart | purchase | favorite


class PredictRequest(BaseModel):
    product_id:                  str
    unit_price:                  float = 0.0
    stock:                       int   = 0
    cost_price:                  float = 0.0
    sales_volume:                float = 0.0
    return_rate:                 float = 0.05
    profit:                      float = 0.0
    demand_score:                float = 0.5
    price_competitiveness_score: float = 0.65
    cart_abandonment_rate:       float = 0.3
    loyalty_score:               float = 0.5
    shop_performance_index:      float = 0.7
    category:                    str   = "General"


class BatchPredictRequest(BaseModel):
    products: List[PredictRequest]


# ── Shared response builder ───────────────────────────────────────────────────

def _rec_response(user_id: str, recs: list, context: str, category: str = None) -> dict:
    return {
        "user_id":         user_id,
        "context":         context,
        "recommendations": recs,
        "total_count":     len(recs),
        "algorithm_used":  "collab-filter+trust+category-affinity+time-decay",
        "category_filter": category,
        "generated_at":    datetime.utcnow().isoformat(),
    }


# ── Insight helper ────────────────────────────────────────────────────────────

def _derive_insight(product_id: str, unit_price: float = 0.0, stock: int = 0) -> dict:
    pid = str(product_id)
    if engine is None:
        return {"product_id": pid, "promotion_suggestion": "NO",
                "price_adjustment": "STABLE", "model_used": "fallback",
                "expected_impact": "ML engine not loaded"}

    pop    = float(engine.popularity.get(pid, 0.0))
    trust  = float(engine.trust.get(pid, 0.0))
    signal = pop * 0.6 + trust * 0.4

    promo      = "YES" if signal > 0.35 else "NO"
    conf_promo = min(0.95, signal) if signal > 0.6 else signal if signal > 0.35 else 1.0 - signal
    price_adj  = "STABLE"
    rec_price  = None
    impact     = f"Demand signal={signal:.2f}"

    if trust > 0.7 and stock < 10:
        price_adj = "INCREASE"
        if unit_price > 0:
            rec_price = round(unit_price * 1.08, 2)
        impact += " | Price increase suggested"
    elif pop < 0.2 and stock > 50:
        price_adj = "DECREASE"
        if unit_price > 0:
            rec_price = round(unit_price * 0.92, 2)
        impact += " | Price decrease suggested"

    return {
        "product_id":           pid,
        "promotion_suggestion": promo,
        "price_adjustment":     price_adj,
        "confidence_promo":     round(conf_promo, 4),
        "confidence_price":     round(0.5 + abs(trust - pop) * 0.3, 4),
        "recommended_price":    rec_price,
        "expected_impact":      impact,
        "model_used":           "marketplace-ml-v5",
    }


# =============================================================================
# CONTEXT ENDPOINTS
# =============================================================================

@app.get("/recommend/home/{user_id}", summary="Home page — personalised multi-category feed")
def recommend_home(user_id: str, top_n: int = 12):
    """
    Home / discovery page.
    Returns a mix of products from the user's top preferred categories,
    weighted by their interaction frequency.
    Multi-category mixing is ALLOWED here.
    """
    if engine is None:
        raise HTTPException(503, "ML engine not loaded")
    recs = engine.recommend_home(user_id, top_n=top_n)
    return _rec_response(user_id, recs, context="home")


@app.get("/recommend/product/{user_id}", summary="Product page — same-category items only")
def recommend_product_page(user_id: str, product_id: str, top_n: int = 8):
    """
    Product detail page.
    Returns ONLY products from the SAME category as the viewed product.
    Price-similarity boost applied within the category.
    Cross-category mixing is FORBIDDEN.
    """
    if engine is None:
        raise HTTPException(503, "ML engine not loaded")
    if not product_id:
        raise HTTPException(400, "product_id query param is required")
    recs = engine.recommend_product_page(user_id, product_id, top_n=top_n)
    viewed_cat = engine.category_map.get(str(product_id), "")
    return _rec_response(user_id, recs, context="product_page", category=viewed_cat)


@app.post("/recommend/cart", summary="Cart page — cart categories + complementary items")
def recommend_cart(req: CartRecommendRequest):
    """
    Cart / panier page.
    Detects categories of items in the cart and recommends ONLY from those
    categories plus complementary ones (upsell logic).
    Unrelated categories are NEVER included.
    """
    if engine is None:
        raise HTTPException(503, "ML engine not loaded")
    if not req.cart_pids:
        raise HTTPException(400, "cart_pids must not be empty")
    recs = engine.recommend_cart(req.user_id, req.cart_pids, top_n=req.top_n)
    cart_cats = list({
        engine.category_map.get(str(p), "") for p in req.cart_pids
    } - {""})
    return {
        **_rec_response(req.user_id, recs, context="cart"),
        "cart_categories": cart_cats,
    }


# =============================================================================
# GENERIC / LEGACY ENDPOINTS  (used by Spring Boot backend)
# =============================================================================

@app.get("/recommend/{user_id}", summary="Generic — delegates to home or category")
def recommend_get(user_id: str, top_n: int = 8, category: str = None):
    """
    Generic endpoint used by the Spring Boot backend.
    - No category → delegates to recommend_home()
    - With category → strict single-category mode
    """
    if engine is None:
        raise HTTPException(503, "ML engine not loaded")
    recs = engine.recommend(user_id, top_n=top_n, category=category)
    return _rec_response(user_id, recs, context="generic", category=category)


@app.post("/recommend", summary="Generic POST version")
def recommend_post(req: RecommendRequest):
    if engine is None:
        raise HTTPException(503, "ML engine not loaded")
    recs = engine.recommend(req.user_id, top_n=req.top_n, category=req.category)
    return _rec_response(req.user_id, recs, context="generic", category=req.category)


# =============================================================================
# FEEDBACK / ONLINE LEARNING
# =============================================================================

@app.post("/feedback", summary="Ingest a real-time user interaction")
def feedback(req: FeedbackRequest, background_tasks: BackgroundTasks):
    """
    Record a user interaction (view, like, add_to_cart, purchase, favorite).
    Updates the in-memory model immediately; triggers a full MongoDB retrain
    in the background.
    """
    if feedback_svc is None:
        raise HTTPException(503, "Feedback service not available")
    result = feedback_svc.add_interaction(req.user_id, req.product_id, req.action)
    background_tasks.add_task(feedback_svc.retrain_model)
    return result


# =============================================================================
# PRODUCT INSIGHT (promo / price signal)
# =============================================================================

@app.post("/predict")
def predict(req: PredictRequest):
    return _derive_insight(req.product_id, req.unit_price, req.stock)


@app.post("/predict/batch")
def predict_batch(req: BatchPredictRequest):
    return [_derive_insight(p.product_id, p.unit_price, p.stock) for p in req.products]


# =============================================================================
# ADMIN / UTILITY
# =============================================================================

@app.get("/")
def root():
    return {
        "service": "Marketplace ML — Shein-style Recommender",
        "version": "5.0.0",
        "status":  "running" if engine else "engine not loaded",
        "endpoints": {
            "home":         "GET /recommend/home/{user_id}",
            "product_page": "GET /recommend/product/{user_id}?product_id=<id>",
            "cart":         "POST /recommend/cart",
            "generic":      "GET /recommend/{user_id}",
            "feedback":     "POST /feedback",
            "reload":       "POST /reload",
            "health":       "GET /health",
            "stats":        "GET /stats",
        },
    }


@app.get("/health")
def health():
    if engine is None:
        return {"status": "DOWN", "healthy": False}
    n_users = len(engine.matrix.index) if not engine.matrix.empty else 0
    return {
        "status":            "UP",
        "healthy":           True,
        "products_in_model": len(engine.popularity),
        "users_in_model":    n_users,
    }


@app.post("/reload")
def reload_engine():
    """Force full reload from MongoDB."""
    load_engine()
    return {"message": "Engine reloaded from MongoDB", "status": "ok"}


@app.get("/stats")
def stats():
    if engine is None:
        return {"error": "Engine not loaded"}
    n_users = len(engine.matrix.index) if not engine.matrix.empty else 0
    top5    = engine.popularity.sort_values(ascending=False).head(5).to_dict()
    return {
        "total_products":       len(engine.popularity),
        "total_users":          n_users,
        "top_popular_products": top5,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8003, reload=True)

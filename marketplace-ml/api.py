from fastapi import FastAPI
import pandas as pd

from model.recommender import RecommendationEngine
from services.feedback_service import FeedbackService
from storage import get_db

app = FastAPI()

# =========================
# LOAD DATA FROM MONGODB
# =========================
db = get_db()

interactions = pd.DataFrame(list(db.interactions.find()))
products = pd.DataFrame(list(db.products.find()))

# clean Mongo _id
interactions.drop(columns=["_id"], inplace=True, errors="ignore")
products.drop(columns=["_id"], inplace=True, errors="ignore")

print("📊 Data loaded from MongoDB")

# =========================
# TRAIN MODEL
# =========================
engine = RecommendationEngine(interactions, products)
feedback_service = FeedbackService(engine)

print("✅ Model loaded & trained")

# =========================
# ROUTES
# =========================
@app.get("/")
def home():
    return {"message": "Marketplace AI is running 🚀"}

@app.get("/recommend/{user_id}")
def recommend(user_id: str):
    return {
        "user_id": user_id,
        "recommendations": engine.recommend(user_id)
    }

@app.post("/feedback")
def feedback(user_id: int, product_id: int, action: str):
    return feedback_service.add_interaction(user_id, product_id, action)
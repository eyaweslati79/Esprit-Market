import pandas as pd
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

# =========================
# 1. LOAD DATA
# =========================
df = pd.read_csv("data/interactions_raw.csv")
products = pd.read_csv("data/products_raw.csv")

print("📊 Data loaded")
print(df.head())

# =========================
# 2. CLEANING
# =========================
df["user_id"] = df["user_id"].astype(str)
df["product_id"] = df["product_id"].astype(str)
df["score"] = df["score"].astype(float)
df["timestamp"] = pd.to_datetime(df["timestamp"])

products["product_id"] = products["product_id"].astype(str)

# =========================
# 3. PRODUCT MAPPING (FIX UNKNOWN)
# =========================
product_map = products.set_index("product_id")["name"].to_dict()

def get_product_name(pid):
    return product_map.get(str(pid), f"Product_{pid}")

# DEBUG missing products
missing = set(df["product_id"]) - set(products["product_id"])
print("⚠️ Missing products in catalog:", list(missing)[:10])

print(f"📦 Products loaded: {len(product_map)}")

# =========================
# 4. TIME DECAY (RECENCY BOOST)
# =========================
latest_time = df["timestamp"].max()

df["time_weight"] = df["timestamp"].apply(
    lambda x: np.exp(-0.15 * (latest_time - x).days)
)

df["final_score"] = df["score"] * df["time_weight"]

print("✅ Time decay applied")

# =========================
# 5. USER-PRODUCT MATRIX
# =========================
matrix = df.pivot_table(
    index="user_id",
    columns="product_id",
    values="final_score",
    fill_value=0
)

print("📊 Matrix shape:", matrix.shape)

# =========================
# 6. USER SIMILARITY
# =========================
similarity = cosine_similarity(matrix)

similarity_df = pd.DataFrame(
    similarity,
    index=matrix.index,
    columns=matrix.index
)

print("✅ Similarity computed")

# =========================
# 7. POPULARITY SCORE (GLOBAL TREND)
# =========================
product_popularity = df.groupby("product_id")["final_score"].sum()

product_popularity = (
    product_popularity - product_popularity.min()
) / (product_popularity.max() - product_popularity.min() + 1e-9)

print("🔥 Popularity computed")

# =========================
# 8. TRUST SCORE (BUSINESS KPI)
# =========================
trust_score = df.groupby("product_id")["score"].sum()

trust_score = (
    trust_score - trust_score.min()
) / (trust_score.max() - trust_score.min() + 1e-9)

print("📊 Trust score computed")

# =========================
# 9. COLD START (POPULARITY)
# =========================
def get_popular(n=5):
    return product_popularity.sort_values(ascending=False).head(n)

# =========================
# 10. RECOMMENDATION ENGINE (PRO HYBRID)
# =========================
def recommend(user_id, top_n=5):

    user_id = str(user_id)

    # =====================
    # EXISTING USER
    # =====================
    if user_id in matrix.index:

        sim_users = similarity_df[user_id].sort_values(ascending=False)[1:6]

        scores = pd.Series(dtype=float)

        for sim_user, sim_score in sim_users.items():
            scores = scores.add(matrix.loc[sim_user] * sim_score, fill_value=0)

        # remove already seen products
        seen = matrix.loc[user_id]
        scores = scores[seen == 0]

        # HYBRID BOOST
        scores = scores.add(product_popularity, fill_value=0)
        scores = scores.add(trust_score, fill_value=0)

    # =====================
    # COLD START USER
    # =====================
    else:
        print("⚠️ Cold start user → popularity fallback")
        scores = product_popularity.copy()

    # =====================
    # FORMAT OUTPUT (PRO API STYLE)
    # =====================
    results = []

    for pid, score in scores.sort_values(ascending=False).head(top_n).items():
        results.append({
            "product_id": pid,
            "product_name": get_product_name(pid),
            "score": float(score)
        })

    return results

# =========================
# 11. TEST RUN
# =========================
if __name__ == "__main__":
    test_user = df["user_id"].iloc[0]

    print("\n🔥 Recommendations for user:", test_user)
    print(recommend(test_user))
from storage.recommender_cache import save_model

model_data = {
    "matrix": matrix,
    "similarity": similarity_df,
    "product_popularity": product_popularity,
    "trust_score": trust_score
}

save_model(model_data)

print("💾 Model saved to storage cache")
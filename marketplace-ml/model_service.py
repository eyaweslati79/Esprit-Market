import pandas as pd
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from storage import interactions_col, products_col

class RecommendationEngine:

    def __init__(self):
        self.load_data()
        self.train()

    def load_data(self):

        self.interactions = pd.DataFrame(list(interactions_col.find()))
        self.products = pd.DataFrame(list(products_col.find()))

        print("📊 Data loaded from MongoDB")

        self.interactions["user_id"] = self.interactions["user_id"].astype(str)
        self.interactions["product_id"] = self.interactions["product_id"].astype(str)
        self.products["product_id"] = self.products["product_id"].astype(str)

        self.product_map = dict(zip(
            self.products["product_id"],
            self.products["name"]
        ))

    def train(self):

        self.interactions["timestamp"] = pd.to_datetime(self.interactions["timestamp"])
        latest_time = self.interactions["timestamp"].max()

        self.interactions["time_weight"] = self.interactions["timestamp"].apply(
            lambda x: np.exp(-0.1 * (latest_time - x).days)
        )

        self.interactions["final_score"] = (
            self.interactions["score"] * self.interactions["time_weight"]
        )

        self.matrix = self.interactions.pivot_table(
            index="user_id",
            columns="product_id",
            values="final_score",
            fill_value=0
        )

        self.similarity = cosine_similarity(self.matrix)

        self.sim_df = pd.DataFrame(
            self.similarity,
            index=self.matrix.index,
            columns=self.matrix.index
        )

        self.popularity = self.interactions.groupby("product_id")["final_score"].mean()

        self.trust = self.interactions.groupby("product_id")["score"].sum()
        self.trust = self.trust / self.trust.max()

        print("✅ Model trained")

    def recommend(self, user_id, top_n=5):

        user_id = str(user_id)

        if user_id in self.matrix.index:

            sim_users = self.sim_df[user_id].sort_values(ascending=False)[1:6]

            scores = pd.Series(dtype=float)

            for u, s in sim_users.items():
                scores = scores.add(self.matrix.loc[u] * s, fill_value=0)

            seen = self.matrix.loc[user_id]
            scores = scores[seen == 0]

            scores = scores.add(self.popularity, fill_value=0)
            scores = scores.add(self.trust, fill_value=0)

        else:
            scores = self.popularity

        results = []

        for pid, score in scores.sort_values(ascending=False).head(top_n).items():
            results.append({
                "product_id": pid,
                "product_name": self.product_map.get(pid, "Unknown"),
                "score": float(score)
            })

        return result
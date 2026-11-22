import pandas as pd
import numpy as np
import random

# =========================
# CONFIG
# =========================
np.random.seed(42)

NUM_USERS = 120
NUM_PRODUCTS = 300
NUM_INTERACTIONS = 8000

# =========================
# 1. PRODUCTS (REALISTIC)
# =========================
categories = [
    "electronics",
    "school_supplies",
    "accessories",
    "gadgets"
]

product_names = [
    "USB Cable", "Laptop Charger", "Notebook A4", "Backpack",
    "Mechanical Keyboard", "Wireless Mouse", "Phone Case",
    "SSD 1TB", "Headphones", "Marker Set", "Calculator",
    "Tablet Stylus", "External HDD", "LED Lamp", "Smart Watch"
]

products = []

for i in range(NUM_PRODUCTS):
    products.append({
        "product_id": str(i),
        "name": random.choice(product_names) + f" {i}",
        "category": random.choice(categories),
        "price": round(random.uniform(2, 1200), 2),
        "stock": random.randint(0, 200),
        "shopId": f"shop_{random.randint(1,20)}"
    })

products_df = pd.DataFrame(products)

# =========================
# 2. USERS
# =========================
users = []

for i in range(NUM_USERS):
    users.append({
        "user_id": str(i),
        "type": random.choice(["student", "seller"]),
        "city": random.choice(["Tunis", "Ariana", "Sfax"]),
    })

users_df = pd.DataFrame(users)

# =========================
# 3. INTERACTIONS (REAL BEHAVIOR)
# =========================
actions = ["view", "add_to_cart", "purchase"]

interactions = []

for i in range(NUM_INTERACTIONS):
    user = random.choice(users)["user_id"]
    product = random.choice(products)["product_id"]
    action = random.choices(actions, weights=[0.7, 0.2, 0.1])[0]

    score_map = {
        "view": 1,
        "add_to_cart": 3,
        "purchase": 5
    }

    interactions.append({
        "interaction_id": i,
        "user_id": user,
        "product_id": product,
        "action": action,
        "score": score_map[action] + np.random.normal(0, 0.2),
        "timestamp": pd.Timestamp("2026-04-25") - pd.to_timedelta(random.randint(0, 30), unit="d")
    })

interactions_df = pd.DataFrame(interactions)

# =========================
# 4. ADD NOISE (REAL WORLD)
# =========================
# duplicates
interactions_df = pd.concat([interactions_df, interactions_df.sample(200)])

# missing values (real life problem)
interactions_df.loc[interactions_df.sample(50).index, "score"] = np.nan

# =========================
# 5. SAVE FILES
# =========================
products_df.to_csv("data/products_raw.csv", index=False)
users_df.to_csv("data/users_raw.csv", index=False)
interactions_df.to_csv("data/interactions_raw.csv", index=False)

print("✅ Dataset PRO generated:")
print("Products:", len(products_df))
print("Users:", len(users_df))
print("Interactions:", len(interactions_df))
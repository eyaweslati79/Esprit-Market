import pandas as pd
from storage import get_db

# =========================
# CONNECT MONGO
# =========================
db = get_db()

users_col = db["users"]
products_col = db["products"]
interactions_col = db["interactions"]

# =========================
# LOAD CSV
# =========================
users = pd.read_csv("data/users_raw.csv")
products = pd.read_csv("data/products_raw.csv")
interactions = pd.read_csv("data/interactions_raw.csv")

print("📊 CSV loaded")

# =========================
# INSERT USERS
# =========================
users_col.delete_many({})
users_col.insert_many(users.to_dict("records"))

print("✅ Users inserted")

# =========================
# INSERT PRODUCTS
# =========================
products_col.delete_many({})
products_col.insert_many(products.to_dict("records"))

print("✅ Products inserted")

# =========================
# INSERT INTERACTIONS
# =========================
interactions_col.delete_many({})
interactions_col.insert_many(interactions.to_dict("records"))

print("✅ Interactions inserted")

print("🚀 DATA READY IN MONGODB")
import pandas as pd

products = pd.read_csv("data/products_raw.csv")
users = pd.read_csv("data/users_raw.csv")
interactions = pd.read_csv("data/interactions_raw.csv")

# ---------------- CLEAN PRODUCTS ----------------
products = products.dropna()
products = products.drop_duplicates()
products = products[products["price"] > 0]
products = products[products["stock"] > 0]

# ---------------- CLEAN USERS ----------------
users = users.dropna()
users = users.drop_duplicates()

# correction trustScore vide
users["trustScore"] = users["trustScore"].fillna(0)

# ---------------- CLEAN INTERACTIONS ----------------
interactions = interactions.drop_duplicates()

print("✅ CLEAN DONE")

products.to_csv("data/products_clean.csv", index=False)
users.to_csv("data/users_clean.csv", index=False)
interactions.to_csv("data/interactions_clean.csv", index=False)
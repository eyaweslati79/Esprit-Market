import pandas as pd
import random

users = list(range(1, 81))
products = list(range(1, 71))

actions = ["view", "like", "add_to_cart", "purchase"]

data = []

for i in range(1500):
    user = random.choice(users)
    product = random.choice(products)
    action = random.choices(actions, weights=[60,15,15,10])[0]

    score_map = {
        "view": 1,
        "like": 2,
        "add_to_cart": 3,
        "purchase": 5
    }

    data.append([
        i,
        user,
        product,
        action,
        score_map[action],
        "2026-04-25"
    ])

df = pd.DataFrame(data, columns=[
    "interaction_id","user_id","product_id","action","score","timestamp"
])

df.to_csv("data/interactions_raw.csv", index=False)

print("DONE 1500 interactions")
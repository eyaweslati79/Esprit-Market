"""
Negotiation dataset generator — realistic marketplace data.

Key improvements:
- 10 000 samples (was 5 000) for better model generalisation
- message_length has a stronger, graduated effect on acceptance
- has_image_attachment gives a meaningful boost
- buyer_rating influence is more realistic
- is_return_customer gives a solid loyalty bonus
- price_ratio thresholds are tighter and more realistic
"""

import pandas as pd
import numpy as np
import os
import random

random.seed(42)
np.random.seed(42)

CATEGORIES = [
    "Electronics", "Clothing", "Home & Garden", "Sports", "Beauty",
    "Toys", "Books", "Automotive", "Food & Grocery", "Health"
]


def _provider_decision(
    base_price: float,
    offered_price: float,
    buyer_rating: float,
    buyer_account_age_months: int,
    is_return_customer: int,
    message_length: int,
    has_exchange_proposal: int,
    has_image_attachment: int,
) -> tuple[str, float]:
    """Return (decision, probability) for a negotiation offer."""

    price_ratio = offered_price / (base_price + 0.01)

    # ── Base probability from price ratio ─────────────────────────────────────
    if price_ratio >= 1.0:
        prob = 0.97
    elif price_ratio >= 0.95:
        prob = 0.92
    elif price_ratio >= 0.90:
        prob = 0.85
    elif price_ratio >= 0.85:
        prob = 0.75
    elif price_ratio >= 0.80:
        prob = 0.62
    elif price_ratio >= 0.75:
        prob = 0.48
    elif price_ratio >= 0.70:
        prob = 0.34
    elif price_ratio >= 0.65:
        prob = 0.20
    elif price_ratio >= 0.60:
        prob = 0.10
    else:
        prob = 0.04

    # ── Buyer rating ──────────────────────────────────────────────────────────
    if buyer_rating >= 4.8:
        prob += 0.12
    elif buyer_rating >= 4.5:
        prob += 0.08
    elif buyer_rating >= 4.0:
        prob += 0.04
    elif buyer_rating < 3.0:
        prob -= 0.12
    elif buyer_rating < 2.0:
        prob -= 0.22

    # ── Return customer loyalty ───────────────────────────────────────────────
    if is_return_customer:
        prob += 0.12

    # ── Account age (trust signal) ────────────────────────────────────────────
    if buyer_account_age_months >= 24:
        prob += 0.05
    elif buyer_account_age_months >= 12:
        prob += 0.02
    elif buyer_account_age_months < 3:
        prob -= 0.05

    # ── Message / description quality (graduated) ─────────────────────────────
    # A well-written message shows intent and builds trust with the provider.
    if message_length >= 300:
        prob += 0.14
    elif message_length >= 200:
        prob += 0.10
    elif message_length >= 100:
        prob += 0.07
    elif message_length >= 50:
        prob += 0.04
    elif message_length >= 20:
        prob += 0.02
    # No message (0–19 chars) → no boost

    # ── Image attachment ──────────────────────────────────────────────────────
    if has_image_attachment:
        prob += 0.06

    # ── Exchange proposal ─────────────────────────────────────────────────────
    # Adds complexity — slight negative on average, but some providers like it
    if has_exchange_proposal:
        prob -= 0.03

    prob = max(0.01, min(0.99, prob))
    decision = "ACCEPT" if random.random() < prob else "REJECT"
    return decision, prob


def generate_negotiation_dataset(num_samples: int = 10_000) -> None:
    data = []

    for i in range(num_samples):
        base_price               = round(random.uniform(5, 2000), 2)
        offered_price            = round(base_price * random.uniform(0.40, 1.10), 2)
        quantity                 = random.randint(1, 5)
        buyer_rating             = round(random.uniform(1.0, 5.0), 1)
        buyer_account_age_months = random.randint(1, 60)
        is_return_customer       = 1 if random.random() < 0.22 else 0
        # Realistic message length distribution: many short, some long
        message_length           = int(np.clip(np.random.exponential(scale=80), 0, 500))
        has_exchange_proposal    = 1 if random.random() < 0.10 else 0
        has_image_attachment     = 1 if random.random() < 0.18 else 0
        product_category         = random.choice(CATEGORIES)

        decision, _ = _provider_decision(
            base_price, offered_price, buyer_rating,
            buyer_account_age_months, is_return_customer,
            message_length, has_exchange_proposal, has_image_attachment,
        )

        data.append({
            "offer_id":                  f"OFFER_{i:05d}",
            "base_price":                base_price,
            "offered_price":             offered_price,
            "quantity":                  quantity,
            "buyer_rating":              buyer_rating,
            "buyer_account_age_months":  buyer_account_age_months,
            "is_return_customer":        is_return_customer,
            "message_length":            message_length,
            "has_exchange_proposal":     has_exchange_proposal,
            "has_image_attachment":      has_image_attachment,
            "product_category":          product_category,
            "provider_decision":         decision,
        })

    df = pd.DataFrame(data)
    accept_rate = (df["provider_decision"] == "ACCEPT").mean()
    print(f"Generated {num_samples} samples — accept rate: {accept_rate:.1%}")

    os.makedirs("../datasets", exist_ok=True)
    df.to_csv("../datasets/negotiation_dataset.csv", index=False)
    print("Saved → ../datasets/negotiation_dataset.csv")


if __name__ == "__main__":
    generate_negotiation_dataset()

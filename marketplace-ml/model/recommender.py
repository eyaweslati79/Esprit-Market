"""
RecommendationEngine — Shein-style context-aware hybrid recommender
====================================================================

Context modes
-------------
  product_page  → ONLY same category as the viewed product
                  + price-similarity boost within that category
  home          → Multi-category personalised feed weighted by
                  the user's category affinity distribution
  cart          → ONLY categories present in the cart
                  + complementary-item boost (upsell logic)

Core algorithm
--------------
  1. Time decay          — recent interactions matter more  (λ=0.1)
  2. User trust weight   — high-trust users' signals count more
  3. Collaborative CF    — user-user cosine similarity (top-5 neighbours)
  4. Category affinity   — per-user category preference profile
  5. Hybrid scoring      — 60% CF + 20% popularity + 10% trust + 10% affinity

Interaction scores
------------------
  view=1  like=2  add_to_cart=3  favorite=4  purchase=5
"""

from __future__ import annotations

import pandas as pd
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from typing import Optional

INTERACTION_SCORES: dict[str, float] = {
    "view":        1.0,
    "like":        2.0,
    "add_to_cart": 3.0,
    "favorite":    4.0,
    "purchase":    5.0,
}

# Complementary category pairs for cart upsell logic
# key = category (lower), value = list of complementary categories (lower)
COMPLEMENTARY: dict[str, list[str]] = {
    "shoes":        ["socks", "accessories"],
    "bags":         ["accessories", "shoes"],
    "clothing":     ["accessories", "shoes", "bags"],
    "electronics":  ["accessories"],
    "sports":       ["accessories", "shoes"],
    "accessories":  ["clothing", "bags", "shoes"],
    "beauty":       ["accessories"],
    "home":         ["accessories"],
}


class RecommendationEngine:
    """
    Hybrid context-aware recommendation engine.

    Parameters
    ----------
    interactions : pd.DataFrame  — user_id, product_id, action, score, timestamp
    products     : pd.DataFrame  — product_id, name, category, price, stock
    users        : pd.DataFrame  — user_id, trustScore  (optional)
    """

    def __init__(
        self,
        interactions: pd.DataFrame,
        products:     pd.DataFrame,
        users:        Optional[pd.DataFrame] = None,
    ):
        self.df       = interactions.copy()
        self.products = products.copy()
        self.users    = users.copy() if users is not None else pd.DataFrame()
        self._prepare()

    # =========================================================================
    # PREPROCESSING
    # =========================================================================

    def _prepare(self) -> None:
        # ── Type coercion ─────────────────────────────────────────────────────
        self.df["user_id"]    = self.df["user_id"].astype(str)
        self.df["product_id"] = self.df["product_id"].astype(str)
        self.products["product_id"] = self.products["product_id"].astype(str)

        self.df["score"]     = pd.to_numeric(self.df["score"], errors="coerce").fillna(1.0)
        self.df["timestamp"] = pd.to_datetime(self.df["timestamp"], errors="coerce")
        self.df["timestamp"] = self.df["timestamp"].fillna(pd.Timestamp.now())

        # ── Product lookup maps ───────────────────────────────────────────────
        self.product_map  = {}
        self.category_map = {}
        self.stock_map    = {}
        self.price_map    = {}

        if "name"     in self.products.columns:
            self.product_map  = self.products.set_index("product_id")["name"].to_dict()
        if "category" in self.products.columns:
            self.category_map = self.products.set_index("product_id")["category"].to_dict()
        if "stock"    in self.products.columns:
            self.stock_map    = self.products.set_index("product_id")["stock"].to_dict()
        if "price"    in self.products.columns:
            self.price_map    = self.products.set_index("product_id")["price"].to_dict()

        # ── Empty interactions → cold-start only ──────────────────────────────
        if self.df.empty:
            self.matrix       = pd.DataFrame()
            self.sim_df       = pd.DataFrame()
            self.popularity   = pd.Series(dtype=float)
            self.trust        = pd.Series(dtype=float)
            self.user_profile = None
            print("⚠️  No interactions — cold-start mode")
            return

        # ── Time decay (λ=0.1, half-life ≈ 7 days) ───────────────────────────
        latest = self.df["timestamp"].max()
        self.df["days"]        = (latest - self.df["timestamp"]).dt.days.fillna(0).clip(lower=0)
        self.df["time_weight"] = np.exp(-0.1 * self.df["days"])

        # ── User trust weighting ──────────────────────────────────────────────
        if (
            not self.users.empty
            and "user_id"    in self.users.columns
            and "trustScore" in self.users.columns
        ):
            self.users["user_id"] = self.users["user_id"].astype(str)
            trust_map = dict(zip(self.users["user_id"], self.users["trustScore"]))
            max_trust = float(self.users["trustScore"].max() or 1.0)
            self.df["trust_weight"] = self.df["user_id"].map(
                lambda u: float(trust_map.get(u, 1.0)) / max_trust
            )
        else:
            self.df["trust_weight"] = 1.0

        self.df["final_score"] = (
            self.df["score"] * self.df["time_weight"] * self.df["trust_weight"]
        )

        # ── User-product matrix ───────────────────────────────────────────────
        self.matrix = self.df.pivot_table(
            index="user_id",
            columns="product_id",
            values="final_score",
            aggfunc="sum",
            fill_value=0,
        )

        # ── User-user cosine similarity ───────────────────────────────────────
        sim_values = cosine_similarity(self.matrix)
        self.sim_df = pd.DataFrame(
            sim_values,
            index=self.matrix.index,
            columns=self.matrix.index,
        )

        # ── Popularity (normalised 0-1) ───────────────────────────────────────
        raw_pop = self.df.groupby("product_id")["final_score"].mean()
        self.popularity = (raw_pop - raw_pop.min()) / (raw_pop.max() - raw_pop.min() + 1e-9)

        # ── Trust score (normalised 0-1) ──────────────────────────────────────
        raw_trust  = self.df.groupby("product_id")["score"].sum()
        self.trust = raw_trust / (raw_trust.max() or 1.0)

        # ── Per-user category affinity profile ────────────────────────────────
        # user_profile[user][category] = fraction of that user's interactions
        self.user_profile = None
        if "category" in self.products.columns:
            merged = self.df.merge(
                self.products[["product_id", "category"]],
                on="product_id",
                how="left",
            )
            profile = (
                merged.groupby(["user_id", "category"])["score"]
                .sum()
                .unstack(fill_value=0)
            )
            row_sum = profile.sum(axis=1).replace(0, 1)
            self.user_profile = profile.div(row_sum, axis=0)

        print(
            f"✅ RecommendationEngine ready — "
            f"{len(self.matrix.index)} users, "
            f"{len(self.matrix.columns)} products in matrix"
        )

    # =========================================================================
    # INTERNAL HELPERS
    # =========================================================================

    def _category_pids(self, category: str) -> set[str]:
        """Product IDs belonging to a category (case-insensitive substring)."""
        if not category or "category" not in self.products.columns:
            return set()
        cat_lower = category.strip().lower()
        return set(
            self.products[
                self.products["category"].str.lower().str.contains(cat_lower, na=False)
            ]["product_id"].tolist()
        )

    def _in_stock(self, pids: set[str]) -> set[str]:
        """Filter to in-stock products only."""
        return {p for p in pids if self.stock_map.get(p, 1) > 0}

    def _collab_scores(self, user_id: str) -> pd.Series:
        """
        Raw collaborative-filtering scores for a known user.
        Returns a Series indexed by product_id (already-seen products excluded).
        """
        sim_users = (
            self.sim_df[user_id]
            .drop(index=user_id, errors="ignore")
            .sort_values(ascending=False)
            .head(5)
        )
        scores = pd.Series(dtype=float)
        for uid, sim in sim_users.items():
            if sim <= 0:
                continue
            scores = scores.add(self.matrix.loc[uid] * sim, fill_value=0)

        seen         = self.matrix.loc[user_id]
        already_seen = seen[seen > 0].index.tolist()
        return scores.drop(index=already_seen, errors="ignore")

    def _hybrid(
        self,
        collab:    pd.Series,
        user_id:   str,
        allowed:   Optional[set[str]] = None,
    ) -> tuple[pd.Series, pd.Series]:
        """
        Apply category affinity boost and hybrid scoring.
        Returns (final_scores, cat_boost) both indexed by product_id.
        Optionally restricts to `allowed` product IDs.
        """
        if allowed is not None:
            collab = collab[collab.index.isin(allowed)]

        if collab.empty:
            return pd.Series(dtype=float), pd.Series(dtype=float)

        # Category affinity boost
        cat_boost = pd.Series(0.0, index=collab.index)
        if self.user_profile is not None and user_id in self.user_profile.index:
            user_cat = self.user_profile.loc[user_id]
            for pid in collab.index:
                cat = self.category_map.get(str(pid), "")
                if cat:
                    cat_boost[pid] = float(user_cat.get(cat, 0.0))

        pop_a   = self.popularity.reindex(collab.index, fill_value=0)
        trust_a = self.trust.reindex(collab.index, fill_value=0)

        final = (
            collab    * 0.6 +
            pop_a     * 0.2 +
            trust_a   * 0.1 +
            cat_boost * 0.1
        )
        return final, cat_boost

    def _popular_in(self, pids: set[str], n: int) -> pd.Series:
        """
        Popularity+trust blend for a set of product IDs.
        Used as cold-start or fallback within a restricted set.
        """
        if self.popularity.empty:
            return pd.Series(1.0, index=list(self._in_stock(pids))[:n])

        pop   = self.popularity.reindex(list(pids), fill_value=0)
        trust = self.trust.reindex(list(pids), fill_value=0)
        combined = pop * 0.6 + trust * 0.4

        # Include in-stock products with no history at score 0
        no_hist = self._in_stock(pids) - set(combined[combined > 0].index)
        if no_hist:
            combined = pd.concat([combined, pd.Series(0.0, index=list(no_hist))])

        combined = pd.Series({
            pid: s for pid, s in combined.items()
            if self.stock_map.get(str(pid), 1) > 0
        })
        return combined.sort_values(ascending=False).head(n)

    def _format(
        self,
        scores:    pd.Series,
        mode:      str = "personalized",
        cat_boost: Optional[pd.Series] = None,
        context:   str = "",
    ) -> list[dict]:
        results = []
        for pid, score in scores.items():
            pid = str(pid)
            results.append({
                "product_id":   pid,
                "name":         self.product_map.get(pid, f"Product_{pid}"),
                "category":     self.category_map.get(pid, ""),
                "price":        float(self.price_map.get(pid, 0.0)),
                "score":        round(float(score), 4),
                "reason":       self._reason(
                    pid, float(score), mode=mode,
                    cat_boost=float(cat_boost.get(pid, 0.0)) if cat_boost is not None else 0.0,
                    context=context,
                ),
            })
        return results

    def _reason(
        self,
        pid:       str,
        score:     float,
        mode:      str   = "personalized",
        cat_boost: float = 0.0,
        context:   str   = "",
    ) -> str:
        pop   = float(self.popularity.get(pid, 0.0))
        trust = float(self.trust.get(pid, 0.0))
        cat   = self.category_map.get(pid, "this category")

        if mode == "cold":
            if trust > 0.7:  return "Highly trusted by the community"
            if pop  > 0.6:   return "Trending in the marketplace"
            return "Popular right now"

        if context == "product_page":
            if score > 0.7:  return f"Similar item in {cat}"
            if pop   > 0.6:  return f"Popular in {cat}"
            return f"You might also like this {cat} item"

        if context == "cart":
            if cat_boost > 0.3: return f"Complements items in your cart"
            if pop > 0.6:       return f"Popular with shoppers like you"
            return "Goes well with your cart"

        if context == "home":
            if cat_boost > 0.4: return f"Based on your interest in {cat}"
            if score > 0.7:     return "Highly recommended for you"
            if pop > 0.6:       return "Trending now"
            return "Recommended for you"

        # generic
        if cat_boost > 0.4: return f"Based on your interest in {cat}"
        if score > 0.7:     return "Highly recommended for you"
        if pop > 0.6:       return "Trending — users like you love this"
        return "Recommended based on your activity"

    # =========================================================================
    # CONTEXT 1 — PRODUCT PAGE
    # Strict same-category, price-similarity boost, exclude viewed product
    # =========================================================================

    def recommend_product_page(
        self,
        user_id:    str,
        product_id: str,
        top_n:      int = 8,
    ) -> list[dict]:
        """
        Called when a user views a product page.

        Rules (hard):
          - ONLY products from the SAME category as `product_id`
          - Exclude the viewed product itself
          - Boost products with similar price (within ±50% of viewed price)
          - Never mix categories

        Parameters
        ----------
        user_id    : str  — viewer's MongoDB ObjectId
        product_id : str  — the product being viewed
        top_n      : int  — max results
        """
        user_id    = str(user_id)
        product_id = str(product_id)

        # Resolve category of the viewed product
        viewed_cat   = self.category_map.get(product_id, "")
        viewed_price = float(self.price_map.get(product_id, 0.0))

        if not viewed_cat:
            # Product has no category — fall back to global popular
            return self._format(
                self._popular_in(self._in_stock(set(self.products["product_id"])), top_n),
                mode="cold", context="product_page",
            )

        # Hard boundary: same category only, exclude viewed product
        allowed = self._category_pids(viewed_cat) - {product_id}
        allowed = self._in_stock(allowed)

        if not allowed:
            return []

        # ── Price-similarity boost ────────────────────────────────────────────
        # Products within ±50% of the viewed price get a boost of up to 0.3
        def price_boost(pid: str) -> float:
            p = float(self.price_map.get(pid, 0.0))
            if viewed_price <= 0 or p <= 0:
                return 0.0
            ratio = min(p, viewed_price) / max(p, viewed_price)  # 0-1, 1=identical
            return ratio * 0.3

        # ── Known user: collaborative filtering ───────────────────────────────
        if not self.matrix.empty and user_id in self.matrix.index:
            collab = self._collab_scores(user_id)
            final, cat_boost = self._hybrid(collab, user_id, allowed=allowed)

            # Add price boost
            for pid in final.index:
                final[pid] = final[pid] + price_boost(pid)

            # Stock filter
            final = pd.Series({
                pid: s for pid, s in final.items()
                if self.stock_map.get(str(pid), 1) > 0
            })

            if not final.empty:
                top = final.sort_values(ascending=False).head(top_n)
                return self._format(top, mode="personalized", cat_boost=cat_boost,
                                    context="product_page")

        # ── Cold-start / fallback: popular within same category ───────────────
        pop = self._popular_in(allowed, top_n)
        # Add price boost to cold-start too
        boosted = pd.Series({
            pid: s + price_boost(pid) for pid, s in pop.items()
        }).sort_values(ascending=False).head(top_n)
        return self._format(boosted, mode="cold", context="product_page")

    # =========================================================================
    # CONTEXT 2 — HOME PAGE
    # Multi-category personalised feed weighted by category affinity
    # =========================================================================

    def recommend_home(
        self,
        user_id: str,
        top_n:   int = 12,
    ) -> list[dict]:
        """
        Called on the home / discovery page.

        Rules:
          - Mix of ALL categories the user interacts with most
          - Allocate slots proportionally to category affinity scores
          - New users get a globally popular multi-category feed
          - No single-category restriction

        Parameters
        ----------
        user_id : str  — MongoDB user ObjectId
        top_n   : int  — total results (distributed across categories)
        """
        user_id = str(user_id)

        # ── New user: globally popular across all categories ──────────────────
        if self.matrix.empty or user_id not in self.matrix.index:
            pop = self._popular_in(
                self._in_stock(set(self.products["product_id"].tolist())),
                top_n,
            )
            return self._format(pop, mode="cold", context="home")

        # ── Known user: category-affinity-weighted feed ───────────────────────

        # Get this user's category affinity (fraction per category)
        if self.user_profile is None or user_id not in self.user_profile.index:
            # No profile yet — fall back to global popular
            pop = self._popular_in(
                self._in_stock(set(self.products["product_id"].tolist())),
                top_n,
            )
            return self._format(pop, mode="cold", context="home")

        affinity = self.user_profile.loc[user_id].sort_values(ascending=False)
        # Keep top-5 categories with non-zero affinity
        top_cats = affinity[affinity > 0].head(5)

        if top_cats.empty:
            pop = self._popular_in(
                self._in_stock(set(self.products["product_id"].tolist())),
                top_n,
            )
            return self._format(pop, mode="cold", context="home")

        # Allocate slots per category proportionally to affinity
        total_affinity = top_cats.sum()
        slots: dict[str, int] = {}
        remaining = top_n
        cats_list  = top_cats.index.tolist()

        for i, cat in enumerate(cats_list):
            if i == len(cats_list) - 1:
                slots[cat] = remaining  # give remainder to last category
            else:
                n_slots = max(1, round((top_cats[cat] / total_affinity) * top_n))
                slots[cat] = min(n_slots, remaining)
                remaining  = max(0, remaining - slots[cat])

        # Collect collaborative scores once (all products)
        collab = self._collab_scores(user_id)

        all_results: list[dict] = []
        seen_pids: set[str] = set()

        for cat, n_slots in slots.items():
            if n_slots <= 0:
                continue

            allowed = self._in_stock(self._category_pids(cat)) - seen_pids
            if not allowed:
                continue

            final, cat_boost = self._hybrid(collab, user_id, allowed=allowed)

            if final.empty:
                # Fallback: popular within this category
                pop = self._popular_in(allowed, n_slots)
                recs = self._format(pop, mode="cold", context="home")
            else:
                top = final.sort_values(ascending=False).head(n_slots)
                recs = self._format(top, mode="personalized",
                                    cat_boost=cat_boost, context="home")

            all_results.extend(recs)
            seen_pids.update(r["product_id"] for r in recs)

        # Sort final list by score descending (preserves category diversity)
        all_results.sort(key=lambda x: x["score"], reverse=True)
        return all_results[:top_n]

    # =========================================================================
    # CONTEXT 3 — CART PAGE
    # Only categories in cart + complementary-item upsell
    # =========================================================================

    def recommend_cart(
        self,
        user_id:     str,
        cart_pids:   list[str],
        top_n:       int = 8,
    ) -> list[dict]:
        """
        Called when the user views their cart.

        Rules:
          - Detect ALL categories of items in the cart
          - Recommend from ALL those categories (balanced mix)
          - Add complementary categories (upsell) based on COMPLEMENTARY map
          - Allocate slots proportionally: cart categories get priority,
            complementary categories fill remaining slots
          - Exclude products already in the cart
          - Never recommend unrelated categories

        Example: cart has Electronics + Clothing
          → recommends Electronics items + Clothing items + Accessories (complementary)
        """
        user_id   = str(user_id)
        cart_pids = [str(p) for p in cart_pids]

        if not cart_pids:
            return []

        # ── Resolve cart categories ───────────────────────────────────────────
        cart_cats: set[str] = set()
        for pid in cart_pids:
            cat = self.category_map.get(pid, "")
            if cat:
                cart_cats.add(cat.lower())

        if not cart_cats:
            return []

        # ── Complementary categories (upsell) ─────────────────────────────────
        complementary_cats: set[str] = set()
        for cat in cart_cats:
            for comp in COMPLEMENTARY.get(cat, []):
                if comp not in cart_cats:          # don't double-count
                    complementary_cats.add(comp)

        # ── Slot allocation ───────────────────────────────────────────────────
        # Cart categories get 75% of slots, complementary get 25%
        n_cart_cats = len(cart_cats)
        n_comp_cats = len(complementary_cats)

        cart_total = max(1, round(top_n * 0.75)) if n_comp_cats > 0 else top_n
        comp_total = top_n - cart_total

        slots_per_cart_cat = max(1, cart_total // n_cart_cats) if n_cart_cats > 0 else 0
        slots_per_comp_cat = max(1, comp_total // n_comp_cats) if n_comp_cats > 0 else 0

        # ── Collect collaborative scores once ─────────────────────────────────
        collab = pd.Series(dtype=float)
        if not self.matrix.empty and user_id in self.matrix.index:
            collab = self._collab_scores(user_id)

        cart_set   = set(cart_pids)
        all_results: list[dict] = []
        seen_pids:  set[str]    = set(cart_pids)   # exclude cart items from results

        def _pick_from_cat(cat: str, n_slots: int, context_label: str) -> list[dict]:
            """Pick top-n recommendations from a single category."""
            allowed = self._in_stock(self._category_pids(cat)) - seen_pids
            if not allowed:
                return []

            if not collab.empty:
                final, cat_boost = self._hybrid(collab, user_id, allowed=allowed)
                final = pd.Series({
                    pid: s for pid, s in final.items()
                    if self.stock_map.get(str(pid), 1) > 0
                })
                if not final.empty:
                    top = final.sort_values(ascending=False).head(n_slots)
                    return self._format(top, mode="personalized",
                                        cat_boost=cat_boost, context="cart")

            # Cold-start fallback
            pop = self._popular_in(allowed, n_slots)
            return self._format(pop, mode="cold", context="cart")

        # ── Fill cart-category slots ───────────────────────────────────────────
        for cat in sorted(cart_cats):          # sorted for determinism
            recs = _pick_from_cat(cat, slots_per_cart_cat, "cart")
            all_results.extend(recs)
            seen_pids.update(r["product_id"] for r in recs)

        # ── Fill complementary-category slots ─────────────────────────────────
        for cat in sorted(complementary_cats):
            recs = _pick_from_cat(cat, slots_per_comp_cat, "cart")
            # Mark complementary items with a reason
            for r in recs:
                r["reason"] = "Complements items in your cart"
            all_results.extend(recs)
            seen_pids.update(r["product_id"] for r in recs)

        # ── If we still have room, fill with more from cart categories ─────────
        if len(all_results) < top_n:
            extra_needed = top_n - len(all_results)
            for cat in sorted(cart_cats):
                if extra_needed <= 0:
                    break
                recs = _pick_from_cat(cat, extra_needed, "cart")
                all_results.extend(recs)
                seen_pids.update(r["product_id"] for r in recs)
                extra_needed -= len(recs)

        # ── Sort by score, preserve category interleaving ─────────────────────
        # Group by category and round-robin to ensure balanced output
        by_cat: dict[str, list[dict]] = {}
        for r in all_results:
            c = r.get("category", "").lower()
            by_cat.setdefault(c, []).append(r)

        # Sort each category bucket by score
        for c in by_cat:
            by_cat[c].sort(key=lambda x: x["score"], reverse=True)

        # Round-robin interleave
        interleaved: list[dict] = []
        queues = list(by_cat.values())
        while len(interleaved) < top_n and any(queues):
            for q in queues:
                if q and len(interleaved) < top_n:
                    interleaved.append(q.pop(0))
            queues = [q for q in queues if q]

        return interleaved[:top_n]

    # =========================================================================
    # GENERIC RECOMMEND (backward-compatible, used by Spring Boot)
    # =========================================================================

    def recommend(
        self,
        user_id:  str,
        top_n:    int = 8,
        category: str = None,
    ) -> list[dict]:
        """
        Generic recommendation — used by the Spring Boot backend.
        If category is provided, strictly enforced (no mixing).
        If not, delegates to recommend_home().
        """
        user_id = str(user_id)

        if not category:
            return self.recommend_home(user_id, top_n=top_n)

        # Strict single-category mode
        allowed = self._in_stock(self._category_pids(category))
        if not allowed:
            return []

        if self.matrix.empty or user_id not in self.matrix.index:
            pop = self._popular_in(allowed, top_n)
            return self._format(pop, mode="cold", context="home")

        collab = self._collab_scores(user_id)
        final, cat_boost = self._hybrid(collab, user_id, allowed=allowed)

        if final.empty:
            pop = self._popular_in(allowed, top_n)
            return self._format(pop, mode="cold", context="home")

        final = pd.Series({
            pid: s for pid, s in final.items()
            if self.stock_map.get(str(pid), 1) > 0
        })
        if final.empty:
            return self._format(self._popular_in(allowed, top_n), mode="cold")

        top = final.sort_values(ascending=False).head(top_n)
        return self._format(top, mode="personalized", cat_boost=cat_boost, context="home")

    # =========================================================================
    # ONLINE LEARNING
    # =========================================================================

    def record_feedback(self, user_id: str, product_id: str, action: str) -> None:
        """
        Immediately update the in-memory matrix with a new interaction.
        A full background retrain from MongoDB is triggered by FeedbackService.
        """
        score = INTERACTION_SCORES.get(action, 1.0)

        new_row = pd.DataFrame([{
            "user_id":      str(user_id),
            "product_id":   str(product_id),
            "action":       action,
            "score":        score,
            "timestamp":    pd.Timestamp.now(),
            "days":         0,
            "time_weight":  1.0,
            "trust_weight": 1.0,
            "final_score":  score,
        }])
        self.df = pd.concat([self.df, new_row], ignore_index=True)

        pid = str(product_id)
        uid = str(user_id)

        if self.matrix.empty:
            self._prepare()
            return

        if pid not in self.matrix.columns:
            self.matrix[pid] = 0.0
        if uid not in self.matrix.index:
            self.matrix.loc[uid] = 0.0

        self.matrix.loc[uid, pid] = float(self.matrix.loc[uid, pid]) + score

        sim_values = cosine_similarity(self.matrix)
        self.sim_df = pd.DataFrame(
            sim_values,
            index=self.matrix.index,
            columns=self.matrix.index,
        )

        product_rows = self.df[self.df["product_id"] == pid]
        if not product_rows.empty:
            new_pop = product_rows["final_score"].mean()
            if not self.popularity.empty:
                pop_min = min(self.popularity.min(), new_pop)
                pop_max = max(self.popularity.max(), new_pop)
                self.popularity[pid] = (new_pop - pop_min) / (pop_max - pop_min + 1e-9)
            else:
                self.popularity[pid] = 1.0

            new_trust = product_rows["score"].sum()
            max_trust = max(self.trust.max() if not self.trust.empty else 1.0, new_trust)
            self.trust[pid] = new_trust / max_trust

"""
Forum Recommendation Model
===========================
Uses FAISS + sentence-transformers (all-MiniLM-L6-v2) for semantic search.
Data source: MongoDB Atlas (posts collection) with Excel dataset fallback.

Pipeline:
  1. Load posts from MongoDB (title + content → full_text)
  2. Clean text (lowercase, strip URLs, punctuation)
  3. Encode with MiniLM → float32 embeddings (normalized)
  4. Build FAISS IndexFlatIP (cosine similarity via inner product)
  5. On /search: encode query → FAISS search → return ranked posts
  6. On /ingest: add new post to index in real-time (no full rebuild)
  7. On /admin/reindex: full rebuild from MongoDB
"""

from __future__ import annotations

import os
import re
import csv
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .schemas import (
    ForumRecommendationRequest,
    ForumRecommendationResponse,
    ForumRecommendedPost,
    ReindexResponse,
)

log = logging.getLogger("forum-ai")

# ── Optional heavy deps ───────────────────────────────────────────────────────
try:
    import faiss  # type: ignore
except Exception:
    faiss = None
    log.warning("faiss not installed — falling back to numpy cosine similarity")

try:
    from pymongo import MongoClient
except Exception:
    MongoClient = None
    log.warning("pymongo not installed — MongoDB source unavailable")

try:
    from sentence_transformers import SentenceTransformer
except Exception:
    SentenceTransformer = None
    log.warning("sentence-transformers not installed — TF-IDF fallback will be used")

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity as sk_cosine
except Exception:
    TfidfVectorizer = None
    sk_cosine = None


MODEL_NAME = "all-MiniLM-L6-v2"
MODEL_VERSION = "forum-faiss-minilm-v2"


# ── Data class ────────────────────────────────────────────────────────────────

@dataclass
class IndexedPost:
    post_id: str
    title: str
    content: str
    category_id: str | None
    category: str | None
    likes: int
    source: str

    @property
    def full_text(self) -> str:
        """Cleaned combined text used for embedding."""
        raw = f"{self.title} {self.content} {self.category or ''}"
        return _clean(raw)

    @property
    def excerpt(self) -> str:
        text = self.content.replace("\n", " ").strip()
        return text[:220] + "..." if len(text) > 220 else text


# ── Text cleaning (same as user's notebook) ───────────────────────────────────

def _clean(text: str) -> str:
    text = str(text).lower()
    text = re.sub(r"http\S+", "", text)           # remove URLs
    text = re.sub(r"[^a-z0-9\s]", " ", text)      # keep only alphanumeric
    text = re.sub(r"\s+", " ", text)               # collapse whitespace
    return text.strip()


# ── Main service ──────────────────────────────────────────────────────────────

class ForumRecommendationService:

    def __init__(self) -> None:
        default_artifact_dir = Path(__file__).resolve().parents[1] / "artifacts"
        self.artifact_dir = Path(os.getenv("FORUM_AI_ARTIFACT_DIR", str(default_artifact_dir)))
        self.mongo_uri = os.getenv(
            "MONGODB_URI",
            "mongodb://localhost:27017/esprit_market"
        )
        self.mongo_database = os.getenv("MONGODB_DATABASE", "esprit_market")

        self.posts: list[IndexedPost] = []
        self.texts: list[str] = []          # cleaned full_text per post
        self.ids: list[str] = []            # post_id per post

        self.embedding_model = None
        self.faiss_index = None
        self.embeddings: np.ndarray | None = None   # (N, D) float32

        # TF-IDF fallback
        self.vectorizer = None
        self.tfidf_matrix = None

        self.backend = "none"
        self.source = "none"
        self.last_error: str | None = None

        self.reindex()

    # ── Public API ────────────────────────────────────────────────────────────

    def health(self) -> dict:
        return {
            "status": "ok" if self.posts else "degraded",
            "service": "forum-recommendation-ai",
            "indexed_count": len(self.posts),
            "source": self.source,
            "algorithm_used": self.backend,
            "last_error": self.last_error,
        }

    def reindex(self) -> ReindexResponse:
        """Full rebuild from MongoDB (or dataset fallback)."""
        self.last_error = None
        log.info("Reindexing forum posts...")

        mongo_posts = self._load_mongo_posts()
        if mongo_posts:
            self._build_index(mongo_posts, source="mongodb")
            log.info(f"✅ Indexed {len(self.posts)} posts from MongoDB")
        else:
            fallback = self._load_dataset_posts()
            self._build_index(fallback, source="dataset")
            log.info(f"⚠️  Indexed {len(self.posts)} posts from dataset fallback")

        return ReindexResponse(
            status="ok" if self.posts else "empty",
            indexed_count=len(self.posts),
            source=self.source,
            algorithm_used=self.backend,
        )

    def ingest(self, post_id: str, title: str, content: str,
               category_id: str | None = None, category: str | None = None) -> dict:
        """
        Add a single new post to the index in real-time.
        Called by Spring Boot when a new forum post is created.
        """
        # Avoid duplicates
        if any(p.post_id == post_id for p in self.posts):
            return {"status": "already_indexed", "post_id": post_id}

        post = IndexedPost(
            post_id=post_id,
            title=title,
            content=content,
            category_id=category_id,
            category=category,
            likes=0,
            source="realtime",
        )

        self.posts.append(post)
        self.texts.append(post.full_text)
        self.ids.append(post_id)

        # Add to FAISS index
        if self.embedding_model is not None and self.faiss_index is not None:
            try:
                vec = self.embedding_model.encode(
                    [post.full_text],
                    convert_to_numpy=True,
                    normalize_embeddings=True,
                    show_progress_bar=False,
                ).astype("float32")
                self.faiss_index.add(vec)
                # Append to embedding matrix
                if self.embeddings is not None:
                    self.embeddings = np.vstack([self.embeddings, vec])
                log.info(f"✅ Ingested post {post_id} into FAISS index")
                return {"status": "indexed", "post_id": post_id, "backend": self.backend}
            except Exception as exc:
                log.warning(f"FAISS ingest failed: {exc}")

        # TF-IDF fallback: rebuild (cheap for small datasets)
        if self.vectorizer is not None:
            try:
                self.tfidf_matrix = self.vectorizer.fit_transform(self.texts)
                return {"status": "indexed", "post_id": post_id, "backend": self.backend}
            except Exception as exc:
                log.warning(f"TF-IDF ingest failed: {exc}")

        return {"status": "indexed_partial", "post_id": post_id}

    def recommend(self, payload: ForumRecommendationRequest) -> ForumRecommendationResponse:
        """Semantic search: find posts similar to the given content."""
        if not self.posts:
            self.reindex()

        recommendations: list[ForumRecommendedPost] = []
        if self.posts and payload.content.strip():
            recommendations = self._rank(payload)

        return ForumRecommendationResponse(
            post_id=payload.post_id,
            recommendations=recommendations[: payload.top_k],
            total_count=len(recommendations[: payload.top_k]),
            algorithm_used=self.backend,
            generated_at=datetime.now(timezone.utc).isoformat(),
        )

    def search(self, query: str, top_k: int = 5,
               exclude_id: str | None = None,
               category_id: str | None = None) -> list[dict]:
        """
        Direct FAISS search — same as /recommend but returns raw dicts.
        Matches the user's /search endpoint style.
        """
        if not self.posts:
            self.reindex()

        cleaned = _clean(query)
        candidates = self._score_candidates(cleaned)

        results = []
        seen: set[str] = set()

        for idx, score in candidates:
            if idx < 0 or idx >= len(self.posts):
                continue
            post = self.posts[idx]
            if post.post_id in seen:
                continue
            if exclude_id and post.post_id == exclude_id:
                continue
            # Category boost
            if category_id and post.category_id == category_id:
                score = min(1.0, score + 0.05)
            seen.add(post.post_id)
            results.append({
                "id":       post.post_id,
                "title":    post.title,
                "excerpt":  post.excerpt,
                "category": post.category,
                "score":    round(float(score), 4),
                "source":   post.source,
            })
            if len(results) >= top_k:
                break

        return results

    # ── Index building ────────────────────────────────────────────────────────

    def _build_index(self, posts: list[IndexedPost], source: str) -> None:
        self.posts = posts
        self.texts = [p.full_text for p in posts]
        self.ids = [p.post_id for p in posts]
        self.source = source if posts else "none"
        self.backend = "none"
        self.faiss_index = None
        self.embeddings = None
        self.vectorizer = None
        self.tfidf_matrix = None

        if not posts:
            return

        # Try precomputed artifacts first (fast startup)
        if source == "dataset" and self._load_precomputed_index():
            return

        # Try MiniLM + FAISS
        if self._build_sentence_index():
            return

        # TF-IDF fallback
        if self._build_tfidf_index():
            return

        self.backend = "keyword-fallback"

    def _build_sentence_index(self) -> bool:
        if SentenceTransformer is None:
            self.last_error = "sentence-transformers not installed"
            return False
        try:
            if self.embedding_model is None:
                log.info(f"Loading embedding model: {MODEL_NAME}")
                self.embedding_model = SentenceTransformer(MODEL_NAME)

            log.info(f"Encoding {len(self.texts)} posts...")
            embeddings = self.embedding_model.encode(
                self.texts,
                convert_to_numpy=True,
                normalize_embeddings=True,
                show_progress_bar=True,
            ).astype("float32")

            self.embeddings = embeddings

            if faiss is not None:
                dim = embeddings.shape[1]
                index = faiss.IndexFlatIP(dim)   # cosine via inner product (normalized vecs)
                index.add(embeddings)
                self.faiss_index = index
                self.backend = f"{MODEL_VERSION}-faiss"
                log.info(f"✅ FAISS index built: {index.ntotal} vectors, dim={dim}")
            else:
                self.backend = f"{MODEL_VERSION}-numpy"
                log.info("✅ Numpy cosine index built (no FAISS)")

            return True
        except Exception as exc:
            self.last_error = f"MiniLM index failed: {exc}"
            log.error(self.last_error)
            return False

    def _load_precomputed_index(self) -> bool:
        """Load pre-built FAISS index + embeddings from artifacts/ folder."""
        if SentenceTransformer is None:
            return False
        try:
            if self.embedding_model is None:
                self.embedding_model = SentenceTransformer(MODEL_NAME)

            index_path = self.artifact_dir / "faiss_index.bin"
            emb_path   = self.artifact_dir / "embeddings.npy"

            if faiss is not None and index_path.exists():
                index = faiss.read_index(str(index_path))
                if index.ntotal == len(self.posts):
                    self.faiss_index = index
                    self.backend = f"{MODEL_VERSION}-precomputed-faiss"
                    log.info("✅ Loaded precomputed FAISS index")
                    return True

            if emb_path.exists():
                emb = np.load(emb_path).astype("float32")
                if len(emb) == len(self.posts):
                    norms = np.linalg.norm(emb, axis=1, keepdims=True)
                    norms[norms == 0] = 1.0
                    self.embeddings = emb / norms
                    self.backend = f"{MODEL_VERSION}-precomputed-numpy"
                    log.info("✅ Loaded precomputed numpy embeddings")
                    return True
        except Exception as exc:
            self.last_error = f"Precomputed index load failed: {exc}"
        return False

    def _build_tfidf_index(self) -> bool:
        if TfidfVectorizer is None:
            return False
        try:
            self.vectorizer = TfidfVectorizer(
                stop_words="english", ngram_range=(1, 2), max_features=20_000
            )
            self.tfidf_matrix = self.vectorizer.fit_transform(self.texts)
            self.backend = f"{MODEL_VERSION}-tfidf"
            log.info("✅ TF-IDF index built")
            return True
        except Exception as exc:
            self.last_error = f"TF-IDF index failed: {exc}"
            return False

    # ── Scoring ───────────────────────────────────────────────────────────────

    def _score_candidates(self, cleaned_query: str) -> list[tuple[int, float]]:
        limit = min(len(self.posts), 50)

        # FAISS (fastest)
        if self.faiss_index is not None and self.embedding_model is not None:
            q = self.embedding_model.encode(
                [cleaned_query],
                convert_to_numpy=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            ).astype("float32")
            scores, idxs = self.faiss_index.search(q, limit)
            return [(int(i), float(s)) for i, s in zip(idxs[0], scores[0]) if i >= 0]

        # Numpy cosine
        if self.embeddings is not None and self.embedding_model is not None:
            q = self.embedding_model.encode(
                [cleaned_query],
                convert_to_numpy=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            ).astype("float32")
            scores = np.dot(self.embeddings, q[0])
            idxs = np.argsort(scores)[::-1][:limit]
            return [(int(i), float(scores[i])) for i in idxs]

        # TF-IDF
        if self.vectorizer is not None and self.tfidf_matrix is not None and sk_cosine is not None:
            q = self.vectorizer.transform([cleaned_query])
            scores = sk_cosine(q, self.tfidf_matrix)[0]
            idxs = np.argsort(scores)[::-1][:limit]
            return [(int(i), float(scores[i])) for i in idxs]

        # Keyword overlap fallback
        query_terms = set(cleaned_query.split())
        scored = []
        for idx, post in enumerate(self.posts):
            terms = set(post.full_text.split())
            overlap = len(query_terms & terms)
            denom = max(1, len(query_terms | terms))
            scored.append((idx, overlap / denom))
        return sorted(scored, key=lambda x: x[1], reverse=True)[:limit]

    def _rank(self, payload: ForumRecommendationRequest) -> list[ForumRecommendedPost]:
        candidates = self._score_candidates(_clean(payload.content))
        excluded = str(payload.post_id) if payload.post_id else None
        ranked: list[tuple[IndexedPost, float]] = []

        for idx, score in candidates:
            if idx < 0 or idx >= len(self.posts):
                continue
            post = self.posts[idx]
            if excluded and post.post_id == excluded:
                continue
            adj = float(score)
            if payload.category_id and post.category_id == payload.category_id:
                adj = min(1.0, adj + 0.05)
            ranked.append((post, adj))

        ranked.sort(key=lambda x: (x[1], x[0].likes), reverse=True)

        seen: set[str] = set()
        output: list[ForumRecommendedPost] = []
        for post, score in ranked:
            if post.post_id in seen:
                continue
            seen.add(post.post_id)
            output.append(ForumRecommendedPost(
                post_id=post.post_id,
                title=post.title,
                excerpt=post.excerpt,
                content=post.content,
                category_id=post.category_id,
                category=post.category,
                score=round(max(0.0, min(1.0, score)), 4),
                source=post.source,
            ))
        return output

    # ── Data loaders ──────────────────────────────────────────────────────────

    def _load_mongo_posts(self) -> list[IndexedPost]:
        if MongoClient is None:
            self.last_error = "pymongo not installed"
            return []
        try:
            client = MongoClient(self.mongo_uri, serverSelectionTimeoutMS=4000)
            db = client[self.mongo_database]
            client.admin.command("ping")

            # Build category map
            categories: dict[str, str] = {
                str(c.get("_id")): str(c.get("name", ""))
                for c in db["category_forum"].find({}, {"name": 1})
            }

            posts: list[IndexedPost] = []
            for doc in db["posts"].find({}, {"content": 1, "categoryId": 1, "reactionIds": 1}):
                content = str(doc.get("content") or "").strip()
                if not content:
                    continue
                title, body = self._split_title(content)
                cat_id = str(doc["categoryId"]) if doc.get("categoryId") is not None else None
                posts.append(IndexedPost(
                    post_id=str(doc["_id"]),
                    title=title,
                    content=body,
                    category_id=cat_id,
                    category=categories.get(cat_id or ""),
                    likes=len(doc.get("reactionIds") or []),
                    source="mongodb",
                ))

            client.close()
            log.info(f"Loaded {len(posts)} posts from MongoDB")
            return posts
        except Exception as exc:
            self.last_error = f"MongoDB load failed: {exc}"
            log.error(self.last_error)
            return []

    def _load_dataset_posts(self) -> list[IndexedPost]:
        dataset_path = self.artifact_dir / "forum_dataset_v2.xlsx"
        if not dataset_path.exists():
            self.last_error = f"Dataset not found: {dataset_path}"
            log.warning(self.last_error)
            return []
        try:
            frame = pd.read_excel(dataset_path)
            rows: list[dict]
            if len(frame.columns) == 1 and "," in str(frame.columns[0]):
                header = str(frame.columns[0]).split(",")
                rows = []
                for val in frame.iloc[:, 0].dropna().astype(str):
                    parsed = next(csv.reader([val]))
                    if len(parsed) == len(header):
                        rows.append(dict(zip(header, parsed)))
            else:
                rows = frame.to_dict(orient="records")

            posts = []
            for row in rows:
                title   = str(row.get("title") or "").strip()
                content = str(row.get("content") or title).strip()
                if not content:
                    continue
                posts.append(IndexedPost(
                    post_id=str(row.get("postId", "")),
                    title=title or content[:80],
                    content=content,
                    category_id=None,
                    category=str(row.get("category") or "").strip() or None,
                    likes=self._safe_int(row.get("likes")),
                    source="dataset",
                ))
            log.info(f"Loaded {len(posts)} posts from dataset")
            return posts
        except Exception as exc:
            self.last_error = f"Dataset load failed: {exc}"
            log.error(self.last_error)
            return []

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _split_title(self, content: str) -> tuple[str, str]:
        lines = [l.strip() for l in content.splitlines() if l.strip()]
        if not lines:
            return "Untitled", ""
        if len(lines) == 1:
            return lines[0][:120], lines[0]
        return lines[0][:160], "\n".join(lines[1:]).strip()

    def _safe_int(self, value: Any) -> int:
        try:
            return int(value)
        except Exception:
            return 0

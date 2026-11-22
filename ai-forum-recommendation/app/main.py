"""
Forum Recommendation AI — Port 8001
=====================================
Endpoints:
  GET  /                  → service info
  GET  /health            → health check + index stats
  POST /recommend         → semantic recommendations (existing Spring Boot API)
  POST /search            → direct FAISS search (query string style)
  POST /ingest            → add a single new post to the index in real-time
  POST /admin/reindex     → full rebuild from MongoDB
"""

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .model import ForumRecommendationService
from .schemas import (
    ForumRecommendationRequest,
    ForumRecommendationResponse,
    ReindexResponse,
    SearchRequest,
    SearchResponse,
    SearchResult,
    IngestRequest,
    IngestResponse,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")

app = FastAPI(
    title="Esprit Market — Forum Recommendation AI",
    description="FAISS + MiniLM semantic search over forum posts (MongoDB-backed)",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Single shared service instance (loaded at startup)
model_service = ForumRecommendationService()


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def root() -> dict:
    return {
        "service": "forum-recommendation-ai",
        "version": "2.0.0",
        "status": "running",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
def health() -> dict:
    return model_service.health()


@app.post("/recommend", response_model=ForumRecommendationResponse)
def recommend(payload: ForumRecommendationRequest) -> ForumRecommendationResponse:
    """
    Semantic recommendations for a forum post.
    Used by Spring Boot ForumAiService.
    """
    return model_service.recommend(payload)


@app.post("/search", response_model=SearchResponse)
def search(req: SearchRequest) -> SearchResponse:
    """
    Direct FAISS search by query string.
    Returns ranked posts with scores.
    """
    results = model_service.search(
        query=req.query,
        top_k=req.top_k,
        exclude_id=req.exclude_id,
        category_id=req.category_id,
    )
    return SearchResponse(
        query=req.query,
        results=[SearchResult(**r) for r in results],
        total=len(results),
        algorithm_used=model_service.backend,
    )


@app.post("/ingest", response_model=IngestResponse)
def ingest(req: IngestRequest) -> IngestResponse:
    """
    Add a new forum post to the FAISS index in real-time.
    Called by Spring Boot when a post is created/updated.
    """
    result = model_service.ingest(
        post_id=req.post_id,
        title=req.title,
        content=req.content,
        category_id=req.category_id,
        category=req.category,
    )
    return IngestResponse(
        status=result.get("status", "unknown"),
        post_id=req.post_id,
        backend=result.get("backend", model_service.backend),
    )


@app.post("/admin/reindex", response_model=ReindexResponse)
def reindex() -> ReindexResponse:
    """
    Full rebuild of the FAISS index from MongoDB.
    Use after bulk data changes.
    """
    return model_service.reindex()

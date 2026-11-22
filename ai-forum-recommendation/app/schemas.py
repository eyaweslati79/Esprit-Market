from pydantic import BaseModel, Field


# ── Existing recommendation schemas ──────────────────────────────────────────

class ForumRecommendationRequest(BaseModel):
    post_id: str | None = None
    content: str = Field(min_length=1)
    category_id: str | None = None
    top_k: int = Field(default=5, ge=1, le=20)


class ForumRecommendedPost(BaseModel):
    post_id: str
    title: str
    excerpt: str
    content: str
    category_id: str | None = None
    category: str | None = None
    score: float
    source: str


class ForumRecommendationResponse(BaseModel):
    post_id: str | None = None
    recommendations: list[ForumRecommendedPost]
    total_count: int
    algorithm_used: str
    generated_at: str


class ReindexResponse(BaseModel):
    status: str
    indexed_count: int
    source: str
    algorithm_used: str


# ── New search endpoint (user's /search style) ────────────────────────────────

class SearchRequest(BaseModel):
    query: str = Field(min_length=1)
    top_k: int = Field(default=5, ge=1, le=20)
    exclude_id: str | None = None
    category_id: str | None = None


class SearchResult(BaseModel):
    id: str
    title: str
    excerpt: str
    category: str | None = None
    score: float
    source: str


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResult]
    total: int
    algorithm_used: str


# ── Ingest endpoint (Spring Boot pushes new posts) ────────────────────────────

class IngestRequest(BaseModel):
    post_id: str
    title: str
    content: str
    category_id: str | None = None
    category: str | None = None


class IngestResponse(BaseModel):
    status: str
    post_id: str
    backend: str | None = None

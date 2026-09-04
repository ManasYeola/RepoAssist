"""
Pydantic request/response models for the Python RAG microservice.
"""

from typing import Optional
from pydantic import BaseModel


# ─── /embed ───────────────────────────────────────────────────────────────────

class CodeChunk(BaseModel):
    """A single code chunk from the Node.js AST parser."""
    file_path: str
    language: str
    symbol_name: Optional[str] = None
    symbol_type: Optional[str] = None
    parent_symbol: Optional[str] = None
    start_line: int
    end_line: int
    content: str


class EmbedRequest(BaseModel):
    """Sent by Node.js indexing service to embed chunks for a repository."""
    repository_id: int
    chunks: list[CodeChunk]


class EmbedResponse(BaseModel):
    repository_id: int
    chunks_embedded: int
    message: str


# ─── /embed/delete-file ───────────────────────────────────────────────────────

class DeleteFileRequest(BaseModel):
    """Delete vectors for a specific file — used in incremental re-indexing."""
    repository_id: int
    file_path: str


# ─── /chat ────────────────────────────────────────────────────────────────────

class ChatHistoryMessage(BaseModel):
    role: str  # "USER" or "ASSISTANT"
    content: str


class ChatRequest(BaseModel):
    """Sent by Node.js chat controller for RAG query."""
    question: str
    repository_id: int
    chat_history: list[ChatHistoryMessage] = []
    mode: str = "default"  # "default" | "security" | "blast_radius" | "architecture" | "docs"


class SourceCitation(BaseModel):
    file_path: str
    symbol_name: Optional[str] = None
    symbol_type: Optional[str] = None
    start_line: int
    end_line: int
    language: str
    score: Optional[float] = None


class ChatResponse(BaseModel):
    answer: str
    sources: list[SourceCitation]


# ─── /architecture ────────────────────────────────────────────────────────────

class ArchitectureRequest(BaseModel):
    prompt: Optional[str] = None


class ArchitectureResponse(BaseModel):
    repository_id: int
    diagram: str   # Raw Mermaid syntax string
    sources: list[SourceCitation]


# ─── /docs ────────────────────────────────────────────────────────────────────

class DocsRequest(BaseModel):
    prompt: Optional[str] = None


class DocsResponse(BaseModel):
    repository_id: int
    documentation: str   # Markdown documentation string
    sources: list[SourceCitation]


# ─── /summary ─────────────────────────────────────────────────────────────────

class SummaryResponse(BaseModel):
    repository_id: int
    summary: str




# ─── /benchmark ───────────────────────────────────────────────────────────────

class BenchmarkResult(BaseModel):
    strategy: str          # "code_aware" or "naive"
    recall_at_5: float
    precision_at_5: float
    mrr: float
    avg_chunks_retrieved: float


class BenchmarkResponse(BaseModel):
    repository_id: int
    results: list[BenchmarkResult]
    winner: str
    improvement_pct: float


# ─── /repo/{id} ───────────────────────────────────────────────────────────────

class DeleteResponse(BaseModel):
    repository_id: int
    message: str

"""
Python FastAPI microservice — LangChain RAG backend for RepoGPT.

Runs on port 8000. Called internally by the Node.js Express backend.

Routes:
  GET  /health               — Health check
  POST /embed                — Receive chunks from Node.js, embed into PGVector
  POST /embed/delete-file    — Delete vectors for a specific file (incremental re-index)
  POST /chat                 — Run LangChain RAG chain, return answer + citations
  POST /chat/stream          — Streaming RAG (SSE)
  GET  /architecture/{id}   — Generate Mermaid architecture diagram for a repo
  DELETE /repo/{id}          — Delete all vectors for a repo (for full re-indexing)
"""

import os
import logging
from contextlib import asynccontextmanager

from typing import Optional
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from models import (
    EmbedRequest,
    EmbedResponse,
    ChatRequest,
    ChatResponse,
    SourceCitation,
    DeleteResponse,
    DeleteFileRequest,
    ArchitectureRequest,
    ArchitectureResponse,
    DocsRequest,
    DocsResponse,
    SummaryResponse,
)
from services.vectorstore import add_chunks, delete_repository, delete_file_vectors
from services.rag import rag_query, rag_stream, generate_architecture_diagram, generate_documentation, generate_repository_summary

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("repogpt-rag")


# ─── App Lifespan ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🐍 RepoAssist Python RAG service starting (gemini-3.5-flash-lite + fastembed/bge-base-en-v1.5)...")
    try:
        import asyncio
        from services.embeddings import get_embeddings
        from services.rag import get_llm
        logger.info("⚡ Pre-warming embeddings and LLM cache...")
        await asyncio.to_thread(get_embeddings)
        await asyncio.to_thread(get_llm)
        logger.info("✅ Hybrid RAG service ready — Dense + BM25 retrieval active!")
    except Exception as e:
        logger.warning(f"⚠️ Pre-warm skipped: {e}")
    yield
    logger.info("🐍 RepoGPT Python RAG service shutting down...")


# ─── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="RepoGPT RAG Service",
    description="LangChain-powered Hybrid RAG pipeline for GitHub code intelligence",
    version="2.0.0",
    lifespan=lifespan,
)

# Allow calls from Node.js backend only
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.getenv("NODE_BACKEND_URL", "http://localhost:3000"),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "repogpt-rag",
        "version": "2.0.0",
        "retrieval": "hybrid (dense + bm25 + rrf)",
    }


@app.post("/embed", response_model=EmbedResponse)
async def embed_chunks(request: EmbedRequest):
    """
    Receive code chunks from Node.js indexing pipeline.
    Embed them using offline sentence-transformers and store in PGVector.
    """
    logger.info(
        f"[Embed] repo={request.repository_id} chunks={len(request.chunks)}"
    )

    if not request.chunks:
        return EmbedResponse(
            repository_id=request.repository_id,
            chunks_embedded=0,
            message="No chunks provided",
        )

    try:
        chunk_dicts = [chunk.model_dump() for chunk in request.chunks]
        count = add_chunks(request.repository_id, chunk_dicts)
        logger.info(f"[Embed] ✓ Stored {count} chunks for repo {request.repository_id}")

        return EmbedResponse(
            repository_id=request.repository_id,
            chunks_embedded=count,
            message=f"Successfully embedded {count} chunks",
        )
    except Exception as e:
        logger.error(f"[Embed] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/embed/delete-file")
async def delete_file_embedding(request: DeleteFileRequest):
    """
    Delete all vector embeddings for a specific file in a repository.
    Used during incremental re-indexing when a file is modified or deleted.
    """
    logger.info(
        f"[DeleteFile] repo={request.repository_id} file={request.file_path}"
    )
    try:
        delete_file_vectors(request.repository_id, request.file_path)
        return {
            "repository_id": request.repository_id,
            "file_path": request.file_path,
            "message": f"Deleted vectors for {request.file_path}",
        }
    except Exception as e:
        logger.error(f"[DeleteFile] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Run the full hybrid LangChain RAG pipeline for a user question.
    Returns the LLM answer + source citations.
    Supports specialized modes: default, security, blast_radius, docs, architecture.
    """
    logger.info(
        f"[Chat] repo={request.repository_id} mode={request.mode} question='{request.question[:60]}...'"
    )

    try:
        history = [msg.model_dump() for msg in request.chat_history]

        result = await rag_query(
            question=request.question,
            repository_id=request.repository_id,
            chat_history=history,
            mode=request.mode,
        )

        sources = [SourceCitation(**src) for src in result["sources"]]

        logger.info(
            f"[Chat] ✓ Answer generated, {len(sources)} sources cited"
        )

        return ChatResponse(answer=result["answer"], sources=sources)

    except Exception as e:
        logger.error(f"[Chat] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """
    Stream tokens from the hybrid LangChain RAG pipeline via Server-Sent Events (SSE).
    Yields events: 'sources', 'token', and 'done'.
    Supports specialized modes: default, security, blast_radius, docs, architecture.
    """
    logger.info(
        f"[ChatStream] repo={request.repository_id} mode={request.mode} question='{request.question[:60]}...'"
    )
    history = [msg.model_dump() for msg in request.chat_history]
    return StreamingResponse(
        rag_stream(
            question=request.question,
            repository_id=request.repository_id,
            chat_history=history,
            mode=request.mode,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/architecture/{repository_id}", response_model=ArchitectureResponse)
@app.get("/architecture/{repository_id}", response_model=ArchitectureResponse)
async def get_architecture(repository_id: int, request: Optional[ArchitectureRequest] = None):
    """
    Generate a Mermaid.js architecture diagram for the given repository.
    Supports optional custom user prompt / requirements.
    """
    custom_prompt = request.prompt if request else None
    logger.info(f"[Architecture] Generating diagram for repo {repository_id}, custom_prompt={bool(custom_prompt)}")

    try:
        result = await generate_architecture_diagram(repository_id, custom_prompt=custom_prompt)
        sources = [SourceCitation(**src) for src in result["sources"]]

        return ArchitectureResponse(
            repository_id=repository_id,
            diagram=result["diagram"],
            sources=sources,
        )
    except Exception as e:
        logger.error(f"[Architecture] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/docs/{repository_id}", response_model=DocsResponse)
@app.get("/docs/{repository_id}", response_model=DocsResponse)
async def get_docs(repository_id: int, request: Optional[DocsRequest] = None):
    """
    Generate comprehensive technical documentation in Markdown for a repository.
    Supports optional custom user prompt / requirements.
    """
    custom_prompt = request.prompt if request else None
    logger.info(f"[Docs] Generating documentation for repo {repository_id}, custom_prompt={bool(custom_prompt)}")

    try:
        result = await generate_documentation(repository_id, custom_prompt=custom_prompt)
        sources = [SourceCitation(**src) for src in result["sources"]]

        return DocsResponse(
            repository_id=repository_id,
            documentation=result["documentation"],
            sources=sources,
        )
    except Exception as e:
        logger.error(f"[Docs] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/summary/{repository_id}", response_model=SummaryResponse)
@app.get("/summary/{repository_id}", response_model=SummaryResponse)
async def get_summary(repository_id: int):
    """
    Generate an executive summary of the repository covering architecture,
    purpose, tech stack, and key modules.
    """
    logger.info(f"[Summary] Generating repository summary for repo {repository_id}")
    try:
        result = await generate_repository_summary(repository_id)
        return SummaryResponse(
            repository_id=repository_id,
            summary=result["summary"],
        )
    except Exception as e:
        logger.error(f"[Summary] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))





@app.delete("/repo/{repository_id}", response_model=DeleteResponse)
async def delete_repo_vectors(repository_id: int):
    """
    Delete all vector embeddings for a repository.
    Called by Node.js before a full re-index.
    """
    logger.info(f"[Delete] Deleting vectors for repo {repository_id}")

    try:
        delete_repository(repository_id)
        return DeleteResponse(
            repository_id=repository_id,
            message=f"Deleted all vectors for repository {repository_id}",
        )
    except Exception as e:
        logger.error(f"[Delete] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

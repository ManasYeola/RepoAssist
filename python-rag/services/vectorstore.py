"""
PGVector store service using LangChain's langchain-postgres PGVector.

The vector store uses the same Neon PostgreSQL database as the Node.js backend.
We write to a separate LangChain-managed table (langchain_pg_embedding) for
vector operations, while Node.js continues to own the code_chunks table for
metadata and citation display.
"""

import os
from dotenv import load_dotenv
from langchain_postgres import PGVector
from langchain_core.documents import Document

from services.embeddings import get_embeddings

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

# In-process BM25 corpus cache: repo_id -> List[Document]
# Invalidated whenever chunks are added or a repo is deleted.
_bm25_cache: dict[str, list] = {}


def _collection_name(repository_id: int) -> str:
    return f"repo_{repository_id}"


def get_vector_store(repository_id: int) -> PGVector:
    """Get or create a PGVector store for the given repository."""
    return PGVector(
        embeddings=get_embeddings(),
        collection_name=_collection_name(repository_id),
        connection=DATABASE_URL,
        use_jsonb=True,
    )


def add_chunks(repository_id: int, chunks: list[dict]) -> int:
    """
    Convert code chunks to LangChain Documents and add to PGVector.
    Metadata is stored alongside the embedding for citation retrieval.

    Args:
        repository_id: The repository these chunks belong to.
        chunks: List of chunk dicts from Node.js (file_path, content, etc.)

    Returns:
        Number of chunks successfully embedded.
    """
    from services.embeddings import prepare_chunk_text

    documents = []
    for chunk in chunks:
        # Build the text to embed
        text = prepare_chunk_text(chunk)

        # Store full chunk metadata so we can return citations
        metadata = {
            "repository_id": repository_id,
            "file_path": chunk.get("file_path", ""),
            "language": chunk.get("language", ""),
            "symbol_name": chunk.get("symbol_name"),
            "symbol_type": chunk.get("symbol_type"),
            "parent_symbol": chunk.get("parent_symbol"),
            "start_line": chunk.get("start_line", 0),
            "end_line": chunk.get("end_line", 0),
        }

        documents.append(Document(page_content=text, metadata=metadata))

    if not documents:
        return 0

    store = get_vector_store(repository_id)

    # Add in batches of 50 to avoid overwhelming the embedding model
    batch_size = 50
    total = 0
    for i in range(0, len(documents), batch_size):
        batch = documents[i : i + batch_size]
        store.add_documents(batch)
        total += len(batch)

    # Invalidate BM25 corpus cache for this repo — corpus changed
    _bm25_cache.pop(f"bm25_corpus_{repository_id}", None)

    return total


def delete_repository(repository_id: int) -> None:
    """
    Delete all vectors for a repository (called before re-indexing).
    Drops the PGVector collection entirely and clears BM25 cache.
    """
    store = get_vector_store(repository_id)
    store.delete_collection()
    # Invalidate BM25 corpus cache
    _bm25_cache.pop(f"bm25_corpus_{repository_id}", None)


def get_retriever(repository_id: int, k: int = 8):
    """
    Get a LangChain retriever for vector similarity search,
    scoped to the given repository.
    """
    store = get_vector_store(repository_id)
    return store.as_retriever(
        search_type="similarity",
        search_kwargs={"k": k},
    )


def get_all_documents(repository_id: int, limit: int = 3000) -> list:
    """
    Fetch all stored documents for a repository for BM25 corpus construction.

    Uses a DIRECT PostgreSQL query (no embedding computation) to fetch only
    document text + metadata from langchain_pg_embedding. This avoids the
    brute-force similarity_search("") approach that triggered a cosine-distance
    scan over every vector in the collection.

    Performance characteristics:
      - Pure SQL sequential scan on the collection, capped at `limit` rows
      - ~5-50ms for 3000 rows vs ~500ms+ for similarity_search("")
      - Result is cached per-repository via an in-memory dict (invalidated on embed)

    Args:
        repository_id: The repository to fetch documents for.
        limit: Max number of documents to load (prevents OOM for huge repos).

    Returns:
        List of LangChain Document objects with page_content and metadata.
    """
    import psycopg
    import json
    import logging

    logger = logging.getLogger("repogpt-rag")

    # Check in-process cache first (avoids DB round-trip for repeated queries)
    cache_key = f"bm25_corpus_{repository_id}"
    cached = _bm25_cache.get(cache_key)
    if cached is not None:
        return cached

    collection_name = _collection_name(repository_id)

    try:
        with psycopg.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT e.document, e.cmetadata
                    FROM langchain_pg_embedding e
                    JOIN langchain_pg_collection c ON e.collection_id = c.uuid
                    WHERE c.name = %s
                    ORDER BY e.id
                    LIMIT %s
                """, (collection_name, limit))

                rows = cur.fetchall()

        docs = []
        for document, cmetadata in rows:
            meta = cmetadata if isinstance(cmetadata, dict) else json.loads(cmetadata or '{}')
            docs.append(Document(page_content=document, metadata=meta))

        logger.info(
            f"[BM25] Loaded {len(docs)} docs for repo {repository_id} from SQL "
            f"(capped at {limit})"
        )

        # Cache the corpus (invalidated in add_chunks / delete_repository)
        _bm25_cache[cache_key] = docs
        return docs

    except Exception as e:
        logger.warning(f"[BM25] Direct SQL fetch failed, returning empty corpus: {e}")
        return []


def delete_file_vectors(repository_id: int, file_path: str) -> None:
    """
    Delete all vector embeddings for a specific file in a repository.
    Called during incremental re-indexing when a file is modified/deleted.
    """
    store = get_vector_store(repository_id)
    # LangChain PGVector supports filtering by metadata
    try:
        store.delete(
            filter={"repository_id": repository_id, "file_path": file_path}
        )
    except Exception as e:
        # Fallback: log and continue — partial stale data is acceptable
        import logging
        logging.getLogger("repogpt-rag").warning(
            f"Could not delete vectors for {file_path}: {e}"
        )

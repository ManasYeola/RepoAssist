import os
from functools import lru_cache
from dotenv import load_dotenv
from langchain_huggingface import HuggingFaceEmbeddings

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
load_dotenv()


@lru_cache(maxsize=1)
def get_embeddings() -> HuggingFaceEmbeddings:
    """Lazy singleton — loads local HuggingFace embeddings from cache.
    
    Uses sentence-transformers/all-mpnet-base-v2 (768-dim) matching PGVector vector(768).
    Runs 100% offline from local disk with zero network latency, no rate limits, and zero cost.
    """
    model_name = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-mpnet-base-v2")
    return HuggingFaceEmbeddings(
        model_name=model_name,
        model_kwargs={"device": "cpu", "local_files_only": True},
        encode_kwargs={"normalize_embeddings": True},
    )


def prepare_chunk_text(chunk_dict: dict) -> str:
    """
    Prepare a code chunk for embedding by prepending metadata context.
    Mirrors the Node.js prepareTextForEmbedding() logic.
    """
    parts = []
    if chunk_dict.get("symbol_name"):
        parts.append(f"Symbol: {chunk_dict['symbol_name']}")
    if chunk_dict.get("symbol_type"):
        parts.append(f"Type: {chunk_dict['symbol_type']}")
    if chunk_dict.get("file_path"):
        parts.append(f"File: {chunk_dict['file_path']}")

    meta = " | ".join(parts)
    content = chunk_dict.get("content", "")
    text = f"{meta}\n\n{content}" if meta else content

    # Truncate to ~8000 chars to stay within embedding token limits
    return text[:8000]

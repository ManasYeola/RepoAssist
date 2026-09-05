import os
from functools import lru_cache
from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings

load_dotenv()


@lru_cache(maxsize=1)
def get_embeddings() -> GoogleGenerativeAIEmbeddings:
    """Lazy singleton — loads Google Gemini Embeddings (768-dim).
    
    Uses models/text-embedding-004 matching PGVector vector(768).
    Eliminates PyTorch/CUDA dependencies, reducing build size from ~4GB to ~50MB.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set")
    return GoogleGenerativeAIEmbeddings(
        model="models/text-embedding-004",
        google_api_key=api_key,
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

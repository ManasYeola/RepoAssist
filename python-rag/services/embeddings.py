import os
from functools import lru_cache
from typing import List
from dotenv import load_dotenv
import google.generativeai as genai
from langchain_core.embeddings import Embeddings

load_dotenv()


import time
import logging
from google.api_core.exceptions import ResourceExhausted

logger = logging.getLogger("repogpt-rag")


def _embed_with_retry(model: str, content, dimension: int, max_retries: int = 5, base_delay: float = 3.0):
    """Embed content with exponential backoff for 429 quota/rate limit errors."""
    for attempt in range(max_retries):
        try:
            return genai.embed_content(
                model=model,
                content=content,
                output_dimensionality=dimension,
            )
        except Exception as e:
            err_str = str(e).lower()
            if "429" in err_str or "quota" in err_str or "resourceexhausted" in err_str or isinstance(e, ResourceExhausted):
                if attempt == max_retries - 1:
                    logger.error(f"[Embeddings] Rate limit exceeded after {max_retries} attempts.")
                    raise
                delay = base_delay * (2 ** attempt)
                logger.warning(f"[Embeddings] Google 429 rate limit hit. Pausing {delay:.1f}s before retry (attempt {attempt + 1}/{max_retries})...")
                time.sleep(delay)
            else:
                raise


class GeminiEmbeddings(Embeddings):
    """Google Gemini Embedding client supporting 768-dimensional output and automatic 429 retry."""

    def __init__(self, api_key: str, model: str = "models/gemini-embedding-001", dimension: int = 768):
        genai.configure(api_key=api_key)
        self.model = model
        self.dimension = dimension

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        results = []
        batch_size = 25  # Safer batch size for Free Tier token limits
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            res = _embed_with_retry(
                model=self.model,
                content=batch,
                dimension=self.dimension,
            )
            results.extend(res["embedding"])
            # Small delay between batches to respect free tier RPM limits
            if i + batch_size < len(texts):
                time.sleep(0.5)
        return results

    def embed_query(self, text: str) -> List[float]:
        res = _embed_with_retry(
            model=self.model,
            content=text,
            dimension=self.dimension,
        )
        return res["embedding"]


@lru_cache(maxsize=1)
def get_embeddings() -> GeminiEmbeddings:
    """Lazy singleton — loads Google Gemini Embeddings (768-dim)."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set")
    return GeminiEmbeddings(
        api_key=api_key,
        model="models/gemini-embedding-001",
        dimension=768,
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

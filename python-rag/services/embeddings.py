import os
from functools import lru_cache
from typing import List
from dotenv import load_dotenv
import google.generativeai as genai
from langchain_core.embeddings import Embeddings

load_dotenv()


class GeminiEmbeddings(Embeddings):
    """Google Gemini Embedding client supporting 768-dimensional output."""

    def __init__(self, api_key: str, model: str = "models/gemini-embedding-001", dimension: int = 768):
        genai.configure(api_key=api_key)
        self.model = model
        self.dimension = dimension

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        results = []
        batch_size = 50
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            res = genai.embed_content(
                model=self.model,
                content=batch,
                output_dimensionality=self.dimension,
            )
            results.extend(res["embedding"])
        return results

    def embed_query(self, text: str) -> List[float]:
        res = genai.embed_content(
            model=self.model,
            content=text,
            output_dimensionality=self.dimension,
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

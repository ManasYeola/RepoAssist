import os
import logging
from functools import lru_cache
from typing import List
from dotenv import load_dotenv
from langchain_core.embeddings import Embeddings
from fastembed import TextEmbedding

load_dotenv()

logger = logging.getLogger("repogpt-rag")


# Persistent cache directory for ONNX model weights
CACHE_DIR = os.getenv(
    "FASTEMBED_CACHE_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "local_cache")
)


class FastEmbedLocalEmbeddings(Embeddings):
    """Local, high-speed ONNX embedding model using BAAI/bge-base-en-v1.5 (768-dim).
    
    Runs 100% locally on CPU via Microsoft's ONNX Runtime.
    - Zero network calls / zero latency
    - Zero daily quotas or rate limits
    - Zero API keys needed for embeddings
    - Ultra-lightweight: ~120MB model, <100MB RAM, zero PyTorch/CUDA
    """

    def __init__(self, model_name: str = "BAAI/bge-base-en-v1.5"):
        logger.info(f"[FastEmbed] Loading local embedding model: {model_name} (cache: {CACHE_DIR})...")
        self.model = TextEmbedding(model_name=model_name, cache_dir=CACHE_DIR, threads=2)
        logger.info(f"[FastEmbed] Model {model_name} loaded successfully (768-dim)!")

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        # fastembed model.embed returns a generator of numpy arrays
        return [vec.tolist() for vec in self.model.embed(texts)]

    def embed_query(self, text: str) -> List[float]:
        vec = next(self.model.embed([text]))
        return vec.tolist()


@lru_cache(maxsize=1)
def get_embeddings() -> FastEmbedLocalEmbeddings:
    model_name = os.getenv("EMBEDDING_MODEL", "BAAI/bge-base-en-v1.5")
    return FastEmbedLocalEmbeddings(model_name=model_name)


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

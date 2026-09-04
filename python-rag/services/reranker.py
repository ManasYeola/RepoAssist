"""
Reranking service for RepoGPT.

Uses Reciprocal Rank Fusion (RRF) to fuse ranked lists from:
  - Dense vector retrieval (PGVector cosine similarity)
  - BM25 keyword retrieval (rank-bm25)

RRF formula: score(d) = Σ 1/(k + rank(d))  where k=60 (empirically best)
This is the same fusion strategy used by Cohere, Pinecone, and Elasticsearch.
"""

from langchain_core.documents import Document


_RRF_K = 60  # Constant k in RRF formula — higher k = smoother fusion


def reciprocal_rank_fusion(
    ranked_lists: list[list[Document]],
    top_k: int = 5,
) -> list[Document]:
    """
    Fuse multiple ranked document lists using Reciprocal Rank Fusion.

    Args:
        ranked_lists: List of ranked Document lists (each list is one retriever's output).
        top_k: Number of top documents to return after fusion.

    Returns:
        Fused and re-ranked list of up to top_k Documents.
    """
    scores: dict[str, float] = {}
    doc_map: dict[str, Document] = {}

    for ranked_list in ranked_lists:
        for rank, doc in enumerate(ranked_list):
            # Use file_path + start_line as a stable unique key per chunk
            key = f"{doc.metadata.get('file_path', '')}:{doc.metadata.get('start_line', 0)}"
            if key not in doc_map:
                doc_map[key] = doc
                scores[key] = 0.0
            scores[key] += 1.0 / (_RRF_K + rank + 1)

    # Sort descending by fused score
    sorted_keys = sorted(scores.keys(), key=lambda k: scores[k], reverse=True)

    result = []
    for key in sorted_keys[:top_k]:
        doc = doc_map[key]
        # Attach RRF score so _docs_to_sources can expose it
        doc.metadata["relevance_score"] = round(scores[key], 4)
        result.append(doc)

    return result

const { vectorSearch, keywordSearch } = require('./vectorStore.service');
const { generateEmbedding } = require('./embedding.service');

/**
 * Reciprocal Rank Fusion — combine ranked lists from multiple retrievers.
 * @param {Array[]} rankedLists - Array of ranked result arrays
 * @param {number} k - RRF constant (default 60)
 * @returns {Array} Fused and re-ranked results
 */
const reciprocalRankFusion = (rankedLists, k = 60) => {
  const scores = new Map();
  const items = new Map();

  for (const list of rankedLists) {
    list.forEach((item, rank) => {
      const id = item.id.toString();
      const score = 1 / (k + rank + 1);
      scores.set(id, (scores.get(id) || 0) + score);
      if (!items.has(id)) items.set(id, item);
    });
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ ...items.get(id), rrfScore: score }));
};

/**
 * Hybrid retrieval: vector similarity + keyword full-text search, fused with RRF.
 *
 * @param {string} query - User's natural language query
 * @param {number} repositoryId - Repository to search in
 * @param {number} topK - Final number of chunks to return
 * @returns {Array} Top-K relevant code chunks with scores
 */
const hybridRetrieve = async (query, repositoryId, topK = 8) => {
  const candidateK = topK * 3; // fetch more candidates then rerank

  // Run both searches in parallel
  const [queryEmbedding, keywordResults] = await Promise.all([
    generateEmbedding(query),
    keywordSearch(query, repositoryId, candidateK),
  ]);

  const vectorResults = await vectorSearch(queryEmbedding, repositoryId, candidateK);

  // Fuse results using RRF
  const fused = reciprocalRankFusion([vectorResults, keywordResults]);

  // Return top-K after fusion
  return fused.slice(0, topK);
};

/**
 * Pure vector retrieval (used when keyword search is not helpful).
 */
const vectorRetrieve = async (query, repositoryId, topK = 8) => {
  const queryEmbedding = await generateEmbedding(query);
  return vectorSearch(queryEmbedding, repositoryId, topK);
};

module.exports = { hybridRetrieve, vectorRetrieve };

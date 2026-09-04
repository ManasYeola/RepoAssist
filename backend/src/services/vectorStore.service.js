const prisma = require('../utils/prisma');

/**
 * Upsert a code chunk and its embedding into PGVector.
 * Uses raw SQL for the vector insert since Prisma doesn't natively support pgvector yet.
 */
const upsertChunk = async (chunk, embedding) => {
  const vectorStr = `[${embedding.join(',')}]`;

  // Upsert using raw SQL to handle the vector type
  await prisma.$executeRaw`
    INSERT INTO code_chunks (
      "repositoryId", "fileId", "filePath", language,
      "symbolName", "symbolType", "parentSymbol",
      "startLine", "endLine", content, embedding, "createdAt"
    )
    VALUES (
      ${chunk.repositoryId}, ${chunk.fileId}, ${chunk.filePath}, ${chunk.language},
      ${chunk.symbolName}, ${chunk.symbolType}, ${chunk.parentSymbol},
      ${chunk.startLine}, ${chunk.endLine}, ${chunk.content},
      ${vectorStr}::vector, NOW()
    )
    ON CONFLICT DO NOTHING
  `;
};

/**
 * Delete all chunks for a given repository (before re-indexing).
 */
const deleteChunksByRepository = async (repositoryId) => {
  await prisma.codeChunk.deleteMany({ where: { repositoryId } });
};

/**
 * Delete all chunks for a specific file (for incremental re-indexing).
 */
const deleteChunksByFile = async (fileId) => {
  await prisma.codeChunk.deleteMany({ where: { fileId } });
};

/**
 * Vector similarity search filtered to a specific repository.
 * Returns top-K chunks ranked by cosine similarity.
 * @param {number[]} queryEmbedding - Query vector (768-dim)
 * @param {number} repositoryId - Repo to scope the search
 * @param {number} topK - Number of results
 */
const vectorSearch = async (queryEmbedding, repositoryId, topK = 10) => {
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  const results = await prisma.$queryRaw`
    SELECT
      id, "repositoryId", "fileId", "filePath", language,
      "symbolName", "symbolType", "parentSymbol",
      "startLine", "endLine", content,
      1 - (embedding <=> ${vectorStr}::vector) AS similarity
    FROM code_chunks
    WHERE "repositoryId" = ${repositoryId}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${topK}
  `;

  return results;
};

/**
 * Full-text keyword search filtered to a specific repository.
 * Uses PostgreSQL tsvector for fast keyword matching.
 * @param {string} query - Search query string
 * @param {number} repositoryId
 * @param {number} topK
 */
const keywordSearch = async (query, repositoryId, topK = 10) => {
  // Sanitize query for tsquery
  const sanitizedQuery = query
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(' | ');

  if (!sanitizedQuery) return [];

  const results = await prisma.$queryRaw`
    SELECT
      id, "repositoryId", "fileId", "filePath", language,
      "symbolName", "symbolType", "parentSymbol",
      "startLine", "endLine", content,
      ts_rank(to_tsvector('english', content), to_tsquery('english', ${sanitizedQuery})) AS similarity
    FROM code_chunks
    WHERE "repositoryId" = ${repositoryId}
      AND to_tsvector('english', content) @@ to_tsquery('english', ${sanitizedQuery})
    ORDER BY similarity DESC
    LIMIT ${topK}
  `;

  return results;
};

module.exports = {
  upsertChunk,
  deleteChunksByRepository,
  deleteChunksByFile,
  vectorSearch,
  keywordSearch,
};

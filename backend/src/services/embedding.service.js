const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Embedding model: text-embedding-004 produces 768-dim vectors
const EMBEDDING_MODEL = 'text-embedding-004';
// LLM for generating answers
const LLM_MODEL = 'gemini-1.5-flash';

const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
const llmModel = genAI.getGenerativeModel({ model: LLM_MODEL });

/**
 * Generate a single embedding vector for the given text.
 * @param {string} text - Text to embed
 * @returns {number[]} 768-dimensional embedding vector
 */
const generateEmbedding = async (text) => {
  const result = await embeddingModel.embedContent(text);
  return result.embedding.values;
};

/**
 * Generate embeddings for multiple texts in batches.
 * Gemini allows up to 100 items per batch request.
 * @param {string[]} texts - Array of texts
 * @returns {number[][]} Array of embedding vectors
 */
const generateEmbeddingsBatch = async (texts, batchSize = 50) => {
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    const requests = batch.map((text) => ({
      content: { parts: [{ text }] },
    }));

    const result = await embeddingModel.batchEmbedContents({ requests });
    const batchEmbeddings = result.embeddings.map((e) => e.values);
    allEmbeddings.push(...batchEmbeddings);

    // Small delay to avoid rate limits
    if (i + batchSize < texts.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return allEmbeddings;
};

/**
 * Generate a text answer using Gemini 1.5 Flash.
 * @param {string} systemPrompt - System instruction
 * @param {string} userPrompt - User message
 * @returns {string} Generated answer text
 */
const generateAnswer = async (systemPrompt, userPrompt) => {
  const model = genAI.getGenerativeModel({
    model: LLM_MODEL,
    systemInstruction: systemPrompt,
  });

  const result = await model.generateContent(userPrompt);
  return result.response.text();
};

/**
 * Prepare text for embedding: normalize whitespace, truncate to ~8000 chars.
 */
const prepareTextForEmbedding = (chunk) => {
  const meta = [
    chunk.symbolName ? `Symbol: ${chunk.symbolName}` : '',
    chunk.symbolType ? `Type: ${chunk.symbolType}` : '',
    chunk.filePath ? `File: ${chunk.filePath}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  const text = `${meta}\n\n${chunk.content}`.replace(/\s+/g, ' ').trim();
  return text.slice(0, 8000);
};

module.exports = {
  generateEmbedding,
  generateEmbeddingsBatch,
  generateAnswer,
  prepareTextForEmbedding,
};

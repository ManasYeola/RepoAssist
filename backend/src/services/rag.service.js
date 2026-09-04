/**
 * RAG Service — delegates to Python LangChain microservice.
 *
 * The Python service at :8000 handles:
 *   - Offline embeddings (sentence-transformers/all-mpnet-base-v2)
 *   - Hybrid retrieval: Dense PGVector + BM25 keyword search fused via RRF
 *   - LLM generation (Gemini 3.5 Flash Lite via LangChain)
 *   - Specialized mode prompts: security, blast_radius, docs, architecture
 */

const axios = require('axios');

const PYTHON_RAG_URL = process.env.PYTHON_RAG_URL || 'http://localhost:8000';

const ragClient = axios.create({
  baseURL: PYTHON_RAG_URL,
  timeout: 180000, // 180s (3 min) — generous timeout for deep code generation
});

/**
 * Run the full RAG pipeline via the Python LangChain service.
 *
 * @param {string} question - User's natural language question
 * @param {number} repositoryId - Repository to search
 * @param {Array} chatHistory - Previous messages [{role, content}]
 * @returns {{ answer: string, sources: Array }}
 */
const ragQuery = async (question, repositoryId, chatHistory = [], mode = 'default') => {
  try {
    const response = await ragClient.post('/chat', {
      question,
      repository_id: repositoryId,
      mode,
      chat_history: chatHistory.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const rawSources = response.data.sources || [];
    const sources = rawSources.map((s) => ({
      filePath: s.filePath || s.file_path || '',
      startLine: s.startLine ?? s.start_line ?? 0,
      endLine: s.endLine ?? s.end_line ?? 0,
      symbolName: s.symbolName || s.symbol_name || null,
      symbolType: s.symbolType || s.symbol_type || null,
      language: s.language || '',
      score: s.score || null,
    }));

    return {
      answer: response.data.answer,
      sources,
    };
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      throw new Error(
        'Python RAG service is not running. Please start it with: cd python-rag && uvicorn main:app --reload --port 8000'
      );
    }
    const detail = err.response?.data?.detail || err.message;
    throw new Error(`RAG service error: ${detail}`);
  }
};

/**
 * Run the streaming RAG pipeline via the Python LangChain service.
 * Returns a readable stream of SSE events.
 */
const ragStream = async (question, repositoryId, chatHistory = [], mode = 'default') => {
  try {
    const response = await ragClient.post(
      '/chat/stream',
      {
        question,
        repository_id: repositoryId,
        mode,
        chat_history: chatHistory.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      },
      {
        responseType: 'stream',
      }
    );
    return response.data;
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      throw new Error(
        'Python RAG service is not running. Please start it with: cd python-rag && uvicorn main:app --reload --port 8000'
      );
    }
    const detail = err.response?.data?.detail || err.message;
    throw new Error(`RAG service error: ${detail}`);
  }
};

/**
 * Fetch an AI-generated Mermaid architecture diagram for a repository.
 * @param {number} repositoryId
 * @param {string|null} prompt - Optional custom requirement
 */
const getArchitectureDiagram = async (repositoryId, prompt = null) => {
  try {
    const response = await ragClient.post(`/architecture/${repositoryId}`, {
      prompt: prompt ? prompt.trim() : null,
    });
    return response.data;
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      throw new Error('Python RAG service is not running.');
    }
    const detail = err.response?.data?.detail || err.message;
    throw new Error(`Architecture diagram error: ${detail}`);
  }
};

/**
 * Fetch AI-generated Markdown technical documentation for a repository.
 * @param {number} repositoryId
 * @param {string|null} prompt - Optional custom requirement
 */
const getRepositoryDocs = async (repositoryId, prompt = null) => {
  try {
    const response = await ragClient.post(`/docs/${repositoryId}`, {
      prompt: prompt ? prompt.trim() : null,
    });
    return response.data;
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      throw new Error('Python RAG service is not running.');
    }
    const detail = err.response?.data?.detail || err.message;
    throw new Error(`Documentation generation error: ${detail}`);
  }
};

/**
 * Fetch AI-generated repository summary.
 * @param {number} repositoryId
 */
const getRepositorySummary = async (repositoryId) => {
  try {
    const response = await ragClient.get(`/summary/${repositoryId}`);
    return response.data;
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      throw new Error('Python RAG service is not running.');
    }
    const detail = err.response?.data?.detail || err.message;
    throw new Error(`Repository summary error: ${detail}`);
  }
};

module.exports = { ragQuery, ragStream, getArchitectureDiagram, getRepositoryDocs, getRepositorySummary };




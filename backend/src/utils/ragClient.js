const axios = require('axios');

const PYTHON_RAG_URL = process.env.PYTHON_RAG_URL ||
  (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true'
    ? 'https://repogpt-fh1b.onrender.com'
    : 'http://localhost:8000');

console.log(`🔗 [RAG Client] Target URL: ${PYTHON_RAG_URL}`);

const ragClient = axios.create({
  baseURL: PYTHON_RAG_URL,
  timeout: 180000, // 3 min
});

// Automatic retry interceptor for handling Render cold starts (502, 503, 504, ECONNRESET)
ragClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (!config) return Promise.reject(error);

    config.__retryCount = config.__retryCount || 0;
    const status = error.response ? error.response.status : null;
    const isRetryable =
      status === 502 ||
      status === 503 ||
      status === 504 ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNREFUSED';

    if (isRetryable && config.__retryCount < 5) {
      config.__retryCount += 1;
      const delay = Math.min(3000 * config.__retryCount, 15000);
      console.warn(
        `⚠️ [RAG Client] ${config.method?.toUpperCase()} ${config.url} returned ${status || error.code}. Render may be waking up. Retrying in ${delay / 1000}s (attempt ${config.__retryCount}/5)...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return ragClient(config);
    }

    return Promise.reject(error);
  }
);

/**
 * Ensures the Python RAG microservice is awake and ready before heavy operations.
 * If Render is booting from sleep, this polls until /health returns 200 OK.
 */
async function ensurePythonRagAwake(maxAttempts = 15, delayMs = 3000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.get(`${PYTHON_RAG_URL.replace(/\/$/, '')}/health`, { timeout: 8000 });
      if (res.status === 200) {
        console.log(`✅ [RAG Client] Python RAG service is awake and healthy.`);
        return true;
      }
    } catch (err) {
      const status = err.response ? err.response.status : err.code;
      console.log(`⏳ [RAG Client] Waiting for Python RAG service (${status}). Attempt ${attempt}/${maxAttempts}...`);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw new Error(`Python RAG service at ${PYTHON_RAG_URL} did not respond within ${Math.round((maxAttempts * delayMs) / 1000)}s.`);
}

module.exports = {
  ragClient,
  PYTHON_RAG_URL,
  ensurePythonRagAwake,
};

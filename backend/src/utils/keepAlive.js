const https = require('https');
const http = require('http');

/**
 * Keep-Alive Service for Render Free Tier.
 * Render spins down free tier instances after 15 minutes of inactivity.
 * This worker sends a lightweight HTTP ping every 10 minutes to:
 * 1. The Node.js backend public URL (resets backend inactivity timer)
 * 2. The Python RAG service public URL (resets Python service inactivity timer)
 */
function startKeepAlive() {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  const externalUrl = process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL || process.env.SERVER_URL;
  const pythonRagUrl = process.env.PYTHON_RAG_URL;

  if (!isProduction && !process.env.ENABLE_KEEP_ALIVE) {
    console.log('ℹ️ [KeepAlive] Development mode — keep-alive ping disabled.');
    return;
  }

  const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes (Render sleeps at 15m)

  const pingUrl = (urlStr, label) => {
    if (!urlStr) return;
    try {
      const parsed = new URL(urlStr);
      const client = parsed.protocol === 'https:' ? https : http;
      
      const req = client.get(urlStr, { timeout: 10000 }, (res) => {
        console.log(`💓 [KeepAlive] Pinged ${label} (${urlStr}) -> Status: ${res.statusCode}`);
        res.resume(); // Consume stream to free sockets
      });

      req.on('error', (err) => {
        console.warn(`⚠️ [KeepAlive] Error pinging ${label}: ${err.message}`);
      });

      req.on('timeout', () => {
        req.destroy();
        console.warn(`⚠️ [KeepAlive] Timeout pinging ${label}`);
      });
    } catch (err) {
      console.warn(`⚠️ [KeepAlive] Invalid URL for ${label}: ${urlStr}`);
    }
  };

  const runPings = () => {
    if (externalUrl) {
      const target = externalUrl.endsWith('/api/health') ? externalUrl : `${externalUrl.replace(/\/$/, '')}/api/health`;
      pingUrl(target, 'Node.js Backend');
    }
    if (pythonRagUrl) {
      const target = pythonRagUrl.endsWith('/health') ? pythonRagUrl : `${pythonRagUrl.replace(/\/$/, '')}/health`;
      pingUrl(target, 'Python RAG');
    }
  };

  // Run first ping after 30 seconds to let servers stabilize
  setTimeout(runPings, 30 * 1000);

  // Then run every 10 minutes
  const intervalId = setInterval(runPings, INTERVAL_MS);

  console.log(`💓 [KeepAlive] Service scheduled every 10 minutes (External: ${externalUrl || 'not set'}, Python: ${pythonRagUrl || 'not set'})`);

  return () => clearInterval(intervalId);
}

module.exports = { startKeepAlive };

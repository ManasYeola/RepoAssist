const crypto = require('crypto');

const getSecret = () => process.env.SESSION_SECRET || 'repoassist-secret-key-change-in-prod';

/**
 * Sign a lightweight, tamper-proof token using HMAC SHA-256.
 * Zero external dependencies (uses Node.js native crypto).
 */
const signToken = (payload, expiresInMs = 7 * 24 * 60 * 60 * 1000) => {
  const data = Buffer.from(
    JSON.stringify({
      ...payload,
      exp: Date.now() + expiresInMs,
    })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', getSecret())
    .update(data)
    .digest('base64url');

  return `${data}.${signature}`;
};

/**
 * Verify a token and return the payload, or null if invalid or expired.
 */
const verifyToken = (token) => {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [data, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSecret())
    .update(data)
    .digest('base64url');

  if (signature !== expectedSig) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
};

module.exports = { signToken, verifyToken };

const prisma = require('../utils/prisma');
const { verifyToken } = require('../utils/token');

/**
 * Authentication middleware — guards protected routes.
 * Supports both traditional session cookies and cross-domain Bearer tokens.
 */
const authMiddleware = async (req, res, next) => {
  // 1. Session-based authentication
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  // 2. Token-based authentication (bypasses browser 3rd-party cookie blocking)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const payload = verifyToken(token);

    if (payload && payload.userId) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: payload.userId },
          include: { githubAccount: true },
        });

        if (user) {
          req.user = user;
          return next();
        }
      } catch (err) {
        console.error('Error fetching user from token:', err.message);
      }
    }
  }

  return res.status(401).json({ error: { message: 'Unauthorized. Please log in.' } });
};

module.exports = authMiddleware;

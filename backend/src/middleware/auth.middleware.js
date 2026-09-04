/**
 * Authentication middleware — guards protected routes
 */
const authMiddleware = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({ error: { message: 'Unauthorized. Please log in.' } });
};

module.exports = authMiddleware;

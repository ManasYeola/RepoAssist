const express = require('express');
const passport = require('passport');
const { getMe, logout } = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');

const { signToken } = require('../utils/token');

const router = express.Router();

// Redirect to GitHub OAuth
router.get('/github', passport.authenticate('github', {
  scope: ['read:user', 'user:email', 'repo'],
}));

// GitHub OAuth callback
router.get(
  '/github/callback',
  passport.authenticate('github', {
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:5173'}?error=auth_failed`,
  }),
  (req, res) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    if (!req.user) {
      return res.redirect(`${frontendUrl}?error=no_user`);
    }

    // Generate secure token for cross-domain auth (works across Vercel <-> Render)
    const token = signToken({ userId: req.user.id });

    // Also persist session for cookie-based clients
    req.session.save((err) => {
      if (err) console.error('Session save warning:', err);
      res.redirect(`${frontendUrl}/dashboard?token=${token}`);
    });
  }
);

// Get current authenticated user
router.get('/me', authMiddleware, getMe);

// Logout
router.post('/logout', logout);

module.exports = router;

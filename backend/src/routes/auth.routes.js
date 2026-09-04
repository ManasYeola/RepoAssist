const express = require('express');
const passport = require('passport');
const { getMe, logout } = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

// Redirect to GitHub OAuth
router.get('/github', passport.authenticate('github', {
  scope: ['read:user', 'user:email', 'repo'],
}));

// GitHub OAuth callback
router.get(
  '/github/callback',
  passport.authenticate('github', {
    failureRedirect: `${process.env.FRONTEND_URL}/login?error=auth_failed`,
  }),
  (req, res) => {
    // Successful auth — redirect to dashboard
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard`);
  }
);

// Get current authenticated user
router.get('/me', authMiddleware, getMe);

// Logout
router.post('/logout', logout);

module.exports = router;

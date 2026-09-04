const express = require('express');
const { handleGithubWebhook } = require('../controllers/webhook.controller');

const router = express.Router();

/**
 * POST /api/webhooks/github
 * GitHub push webhook — triggers automatic incremental re-indexing.
 *
 * To configure in GitHub:
 *   Payload URL: https://your-domain.com/api/webhooks/github
 *   Content type: application/json
 *   Secret: value of GITHUB_WEBHOOK_SECRET env var
 *   Events: Just the push event
 */
router.post('/github', handleGithubWebhook);

module.exports = router;

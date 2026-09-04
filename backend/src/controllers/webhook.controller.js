/**
 * GitHub Webhook Controller
 *
 * Handles inbound webhook events from GitHub.
 * When a push event arrives on the repository's default branch,
 * automatically triggers an incremental re-index.
 *
 * Security: Validates X-Hub-Signature-256 HMAC signature from GitHub.
 */

const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { indexRepository } = require('../services/indexing.service');

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

/**
 * Verify GitHub's HMAC-SHA256 webhook signature.
 * Returns true if the payload matches the expected signature.
 */
const verifySignature = (rawBody, signatureHeader) => {
  if (!WEBHOOK_SECRET) {
    // If no secret configured, allow through (dev mode only)
    console.warn('[Webhook] GITHUB_WEBHOOK_SECRET not set — skipping signature verification');
    return true;
  }

  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const expectedSig = 'sha256=' + crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  // Use timingSafeEqual to prevent timing attacks
  const expected = Buffer.from(expectedSig);
  const actual = Buffer.from(signatureHeader);

  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
};

/**
 * POST /api/webhooks/github
 * Receives GitHub push events and triggers incremental re-indexing.
 */
const handleGithubWebhook = async (req, res) => {
  const event = req.headers['x-github-event'];
  const signature = req.headers['x-hub-signature-256'];

  // Verify signature against raw body
  if (!verifySignature(req.rawBody, signature)) {
    console.warn('[Webhook] Invalid signature — rejecting event');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // Only handle push events
  if (event === 'ping') {
    return res.json({ ok: true, message: 'Webhook ping received by RepoGPT' });
  }

  if (event !== 'push') {
    return res.status(200).json({ ok: true, message: `Ignored event: ${event}` });
  }

  const payload = req.body;
  const repoFullName = payload.repository?.full_name;
  const ref = payload.ref; // e.g. "refs/heads/main"

  if (!repoFullName) {
    return res.status(400).json({ error: 'Missing repository info in payload' });
  }

  try {
    // Find all users who have this repo indexed
    const repositories = await prisma.repository.findMany({
      where: {
        fullName: repoFullName,
        indexStatus: 'INDEXED',
      },
      include: {
        user: {
          include: { githubAccount: true },
        },
      },
    });

    if (repositories.length === 0) {
      return res.json({ ok: true, message: 'No indexed repositories matched this push event' });
    }

    // Check if push is to the default branch
    const triggeredRepos = repositories.filter((repo) => {
      return ref === `refs/heads/${repo.defaultBranch}`;
    });

    if (triggeredRepos.length === 0) {
      return res.json({ ok: true, message: `Push to non-default branch (${ref}) — skipped` });
    }

    // Trigger incremental re-indexing for each matched repo
    for (const repo of triggeredRepos) {
      const accessToken = repo.user?.githubAccount?.accessToken;
      if (!accessToken) continue;

      console.log(`[Webhook] Triggering incremental re-index for ${repo.fullName} (userId=${repo.userId})`);

      // Fire-and-forget in background — webhook must respond quickly
      setImmediate(() => {
        indexRepository(repo.id, accessToken, true).catch((err) => {
          console.error(`[Webhook] Re-index error for ${repo.fullName}:`, err.message);
        });
      });
    }

    res.json({
      ok: true,
      message: `Incremental re-indexing triggered for ${triggeredRepos.length} repository(ies)`,
      repositories: triggeredRepos.map((r) => r.fullName),
    });
  } catch (err) {
    console.error('[Webhook] Error processing push event:', err);
    res.status(500).json({ error: 'Internal server error processing webhook' });
  }
};

module.exports = { handleGithubWebhook };

const prisma = require('../utils/prisma');
const { indexRepository, getIndexingProgress, clearIndexingProgress } = require('../services/indexing.service');


/**
 * POST /api/repositories/:id/index
 * Start indexing a repository (async — fires and returns immediately).
 */
const startIndexing = async (req, res, next) => {
  try {
    const repoId = parseInt(req.params.id);
    const repo = await prisma.repository.findFirst({
      where: { id: repoId, userId: req.user.id },
    });
    if (!repo) return res.status(404).json({ error: { message: 'Repository not found' } });

    // Only block if DB confirms it is currently INDEXING
    if (repo.indexStatus === 'INDEXING') {
      const progress = getIndexingProgress(repoId);
      if (progress.status === 'indexing') {
        return res.status(409).json({ error: { message: 'Repository is already being indexed' } });
      }
    } else {
      clearIndexingProgress(repoId);
    }

    const accessToken = req.user.githubAccount.accessToken;


    // Fire indexing in background (non-blocking)
    setImmediate(() => {
      indexRepository(repoId, accessToken, false).catch((err) => {
        console.error('[Indexing] Background error:', err.message);
      });
    });

    res.json({ message: 'Indexing started', repositoryId: repoId });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/repositories/:id/index/status
 * Poll current indexing progress.
 */
const getIndexStatus = async (req, res, next) => {
  try {
    const repoId = parseInt(req.params.id);
    const repo = await prisma.repository.findFirst({
      where: { id: repoId, userId: req.user.id },
    });
    if (!repo) return res.status(404).json({ error: { message: 'Repository not found' } });

    const progress = getIndexingProgress(repoId);

    res.json({
      repositoryId: repoId,
      indexStatus: repo.indexStatus,
      indexedAt: repo.indexedAt,
      totalFiles: repo.totalFiles,
      totalChunks: repo.totalChunks,
      progress,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/repositories/:id/reindex
 * Re-index a repository.
 * ?incremental=true  — only re-embed files changed since last commit
 * (default)          — full wipe + re-index
 */
const startReindex = async (req, res, next) => {
  try {
    const repoId = parseInt(req.params.id);
    const incremental = req.query.incremental === 'true';

    const repo = await prisma.repository.findFirst({
      where: { id: repoId, userId: req.user.id },
    });
    // Only block if DB confirms it is currently INDEXING
    if (repo.indexStatus === 'INDEXING') {
      const progress = getIndexingProgress(repoId);
      if (progress.status === 'indexing') {
        return res.status(409).json({ error: { message: 'Repository is already being indexed' } });
      }
    } else {
      clearIndexingProgress(repoId);
    }

    const accessToken = req.user.githubAccount.accessToken;


    setImmediate(() => {
      indexRepository(repoId, accessToken, incremental).catch((err) => {
        console.error('[Reindex] Background error:', err.message);
      });
    });

    res.json({
      message: incremental ? 'Incremental re-indexing started' : 'Full re-indexing started',
      repositoryId: repoId,
      mode: incremental ? 'incremental' : 'full',
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { startIndexing, getIndexStatus, startReindex };


const prisma = require('../utils/prisma');
const { getUserRepositories } = require('../services/github.service');
const { getRepositorySummary } = require('../services/rag.service');

/**
 * GET /api/repositories
 * Return all repositories synced for the authenticated user.
 */
const listRepositories = async (req, res, next) => {
  try {
    const repos = await prisma.repository.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(repos);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/repositories/sync
 * Fetch repositories from GitHub and upsert them in the database.
 * Uses individual upserts (not a transaction) to avoid timeout on large repo counts.
 */
const syncRepositories = async (req, res, next) => {
  try {
    const accessToken = req.user.githubAccount.accessToken;
    const githubRepos = await getUserRepositories(accessToken);

    // Run upserts concurrently but NOT inside a single transaction
    // (transactions time out at 5s for users with many repos)
    const results = await Promise.all(
      githubRepos.map((repo) =>
        prisma.repository.upsert({
          where: {
            userId_githubRepoId: {
              userId: req.user.id,
              githubRepoId: repo.id.toString(),
            },
          },
          update: {
            name: repo.name,
            fullName: repo.full_name,
            owner: repo.owner.login,
            description: repo.description,
            language: repo.language,
            isPrivate: repo.private,
            defaultBranch: repo.default_branch,
            url: repo.html_url,
            updatedAt: new Date(),
          },
          create: {
            userId: req.user.id,
            githubRepoId: repo.id.toString(),
            name: repo.name,
            fullName: repo.full_name,
            owner: repo.owner.login,
            description: repo.description,
            language: repo.language,
            isPrivate: repo.private,
            defaultBranch: repo.default_branch,
            url: repo.html_url,
          },
        })
      )
    );

    res.json({ synced: results.length, repositories: results });
  } catch (err) {
    next(err);
  }
};


/**
 * GET /api/repositories/:id
 * Return a single repository with chunk/file counts.
 */
const getRepository = async (req, res, next) => {
  try {
    const repo = await prisma.repository.findFirst({
      where: {
        id: parseInt(req.params.id),
        userId: req.user.id,
      },
    });
    if (!repo) return res.status(404).json({ error: { message: 'Repository not found' } });
    res.json(repo);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/repositories/:id/summary
 * Return the cached summary, or generate and cache it on-demand if null.
 */
const getSummary = async (req, res, next) => {
  try {
    const repoId = parseInt(req.params.id);
    const repo = await prisma.repository.findFirst({
      where: {
        id: repoId,
        userId: req.user.id,
      },
    });

    if (!repo) {
      return res.status(404).json({ error: { message: 'Repository not found' } });
    }

    if (repo.indexStatus !== 'INDEXED') {
      return res.status(400).json({
        error: { message: 'Repository must be indexed to view or generate its summary.' },
      });
    }

    // Return cached summary if available
    if (repo.summary && repo.summary.trim()) {
      return res.json({ repositoryId: repoId, summary: repo.summary, cached: true });
    }

    // Otherwise generate on-demand, cache it in the DB, and return
    const summaryResult = await getRepositorySummary(repoId);
    const summary = summaryResult?.summary || '';

    if (summary) {
      await prisma.repository.update({
        where: { id: repoId },
        data: { summary },
      });
    }

    res.json({ repositoryId: repoId, summary, cached: false });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/repositories/:id/summary/regenerate
 * Force regeneration of repository summary and update DB.
 */
const regenerateSummary = async (req, res, next) => {
  try {
    const repoId = parseInt(req.params.id);
    const repo = await prisma.repository.findFirst({
      where: {
        id: repoId,
        userId: req.user.id,
      },
    });

    if (!repo) {
      return res.status(404).json({ error: { message: 'Repository not found' } });
    }

    if (repo.indexStatus !== 'INDEXED') {
      return res.status(400).json({
        error: { message: 'Repository must be indexed to generate summary.' },
      });
    }

    const summaryResult = await getRepositorySummary(repoId);
    const summary = summaryResult?.summary || '';

    if (summary) {
      await prisma.repository.update({
        where: { id: repoId },
        data: { summary },
      });
    }

    res.json({ repositoryId: repoId, summary, regenerated: true });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listRepositories,
  syncRepositories,
  getRepository,
  getSummary,
  regenerateSummary,
};


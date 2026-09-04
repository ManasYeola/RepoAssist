const express = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const {
  listRepositories,
  syncRepositories,
  getRepository,
  getSummary,
  regenerateSummary,
} = require('../controllers/repository.controller');

const router = express.Router();

router.use(authMiddleware);

// GET /api/repositories — list repos synced for this user
router.get('/', listRepositories);

// POST /api/repositories/sync — sync from GitHub
router.post('/sync', syncRepositories);

// GET /api/repositories/:id — single repo details
router.get('/:id', getRepository);

// GET /api/repositories/:id/summary — get or auto-generate summary
router.get('/:id/summary', getSummary);

// POST /api/repositories/:id/summary/regenerate — force regenerate summary
router.post('/:id/summary/regenerate', regenerateSummary);

module.exports = router;


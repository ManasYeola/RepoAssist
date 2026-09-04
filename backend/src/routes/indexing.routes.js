const express = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const {
  startIndexing,
  getIndexStatus,
  startReindex,
} = require('../controllers/indexing.controller');

const router = express.Router();

router.use(authMiddleware);

// POST /api/repositories/:id/index — start indexing
router.post('/:id/index', startIndexing);

// GET /api/repositories/:id/index/status — poll indexing progress
router.get('/:id/index/status', getIndexStatus);

// POST /api/repositories/:id/reindex — force full re-index
router.post('/:id/reindex', startReindex);

module.exports = router;

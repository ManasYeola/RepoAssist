const express = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const {
  createChatMessage,
  createChatMessageStream,
  getChatSessions,
  getChatMessages,
  getRepositoryArchitecture,
  getRepositoryDocumentation,
} = require('../controllers/chat.controller');

const router = express.Router();

router.use(authMiddleware);

// POST /api/repositories/:id/chat — send a message, get full RAG answer
router.post('/repositories/:id/chat', createChatMessage);

// POST /api/repositories/:id/chat/stream — stream RAG response tokens via SSE
router.post('/repositories/:id/chat/stream', createChatMessageStream);

// GET or POST /api/repositories/:id/architecture — generate Mermaid architecture diagram
router.get('/repositories/:id/architecture', getRepositoryArchitecture);
router.post('/repositories/:id/architecture', getRepositoryArchitecture);

// GET or POST /api/repositories/:id/docs — generate comprehensive Markdown documentation
router.get('/repositories/:id/docs', getRepositoryDocumentation);
router.post('/repositories/:id/docs', getRepositoryDocumentation);



// GET /api/repositories/:id/chats — list chat sessions for a repo
router.get('/repositories/:id/chats', getChatSessions);

// GET /api/chats/:chatId/messages — get all messages in a session
router.get('/chats/:chatId/messages', getChatMessages);

module.exports = router;

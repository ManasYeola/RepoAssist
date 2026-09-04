const prisma = require('../utils/prisma');
const { ragQuery, ragStream, getArchitectureDiagram, getRepositoryDocs } = require('../services/rag.service');


/**
 * POST /api/repositories/:id/chat
 * Accept a question, run RAG pipeline, save messages, return answer.
 */
const createChatMessage = async (req, res, next) => {
  try {
    const repoId = parseInt(req.params.id);
    const { question, sessionId, mode = 'default' } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ error: { message: 'Question is required' } });
    }

    // Verify repo access
    const repo = await prisma.repository.findFirst({
      where: { id: repoId, userId: req.user.id },
    });
    if (!repo) return res.status(404).json({ error: { message: 'Repository not found' } });

    if (repo.indexStatus !== 'INDEXED') {
      return res.status(400).json({
        error: { message: 'Repository must be indexed before chatting. Please index it first.' },
      });
    }

    // Get or create chat session
    let session;
    if (sessionId) {
      session = await prisma.chatSession.findFirst({
        where: { id: parseInt(sessionId), userId: req.user.id, repositoryId: repoId },
      });
    }

    if (!session) {
      // Create a new session with the question as title
      session = await prisma.chatSession.create({
        data: {
          userId: req.user.id,
          repositoryId: repoId,
          title: question.slice(0, 80),
        },
      });
    }

    // Fetch previous messages for context
    const history = await prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });

    // Save user message
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'USER',
        content: question,
      },
    });

    // Run RAG pipeline with optional mode
    const { answer, sources } = await ragQuery(question, repoId, history, mode);

    // Save assistant message
    const assistantMessage = await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'ASSISTANT',
        content: answer,
        sources: sources,
      },
    });

    res.json({
      sessionId: session.id,
      answer,
      sources,
      messageId: assistantMessage.id,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/repositories/:id/chats
 * List all chat sessions for a repository.
 */
const getChatSessions = async (req, res, next) => {
  try {
    const repoId = parseInt(req.params.id);
    const sessions = await prisma.chatSession.findMany({
      where: { repositoryId: repoId, userId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { messages: true } },
      },
    });
    res.json(sessions);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/chats/:chatId/messages
 * Get all messages in a chat session.
 */
const getChatMessages = async (req, res, next) => {
  try {
    const chatId = parseInt(req.params.chatId);
    const session = await prisma.chatSession.findFirst({
      where: { id: chatId, userId: req.user.id },
    });
    if (!session) return res.status(404).json({ error: { message: 'Chat session not found' } });

    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: chatId },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ session, messages });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/repositories/:id/chat/stream
 * Streams RAG response tokens via Server-Sent Events (SSE).
 */
const createChatMessageStream = async (req, res, next) => {
  try {
    const repoId = parseInt(req.params.id);
    const { question, sessionId, mode = 'default' } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ error: { message: 'Question is required' } });
    }

    // Verify repo access
    const repo = await prisma.repository.findFirst({
      where: { id: repoId, userId: req.user.id },
    });
    if (!repo) return res.status(404).json({ error: { message: 'Repository not found' } });

    if (repo.indexStatus !== 'INDEXED') {
      return res.status(400).json({
        error: { message: 'Repository must be indexed before chatting. Please index it first.' },
      });
    }

    // Get or create chat session
    let session;
    if (sessionId) {
      session = await prisma.chatSession.findFirst({
        where: { id: parseInt(sessionId), userId: req.user.id, repositoryId: repoId },
      });
    }

    if (!session) {
      session = await prisma.chatSession.create({
        data: {
          userId: req.user.id,
          repositoryId: repoId,
          title: question.slice(0, 80),
        },
      });
    }

    // Fetch previous messages for context
    const history = await prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });

    // Save user message
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'USER',
        content: question,
      },
    });

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (res.flushHeaders) res.flushHeaders();

    // Immediately send session info
    res.write(`data: ${JSON.stringify({ type: 'session', sessionId: session.id })}\n\n`);

    // Stream from Python RAG service (with optional mode)
    const stream = await ragStream(question, repoId, history, mode);

    let fullAnswer = '';
    let sources = [];
    let buffer = '';

    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const parts = buffer.split('\n\n');
      buffer = parts.pop(); // keep trailing partial

      for (const part of parts) {
        if (!part.trim()) continue;
        const lines = part.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'token' && data.token) {
                fullAnswer += data.token;
              } else if (data.type === 'sources') {
                sources = (data.sources || []).map((s) => ({
                  filePath: s.filePath || s.file_path || '',
                  startLine: s.startLine ?? s.start_line ?? 0,
                  endLine: s.endLine ?? s.end_line ?? 0,
                  symbolName: s.symbolName || s.symbol_name || null,
                  symbolType: s.symbolType || s.symbol_type || null,
                  language: s.language || '',
                }));
              } else if (data.type === 'done' && data.answer) {
                if (!fullAnswer) fullAnswer = data.answer;
              }
            } catch (e) {}
          }
        }
        res.write(`${part}\n\n`);
      }
    });

    stream.on('end', async () => {
      if (buffer.trim()) {
        res.write(`${buffer}\n\n`);
      }

      try {
        const assistantMessage = await prisma.chatMessage.create({
          data: {
            sessionId: session.id,
            role: 'ASSISTANT',
            content: fullAnswer,
            sources: sources,
          },
        });
        res.write(`data: ${JSON.stringify({ type: 'saved', messageId: assistantMessage.id })}\n\n`);
      } catch (saveErr) {
        console.error('[Stream] Failed to save assistant message:', saveErr);
      } finally {
        res.end();
      }
    });

    stream.on('error', (err) => {
      console.error('[Stream] Error from Python RAG stream:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.end();
    });

  } catch (err) {
    if (!res.headersSent) {
      next(err);
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.end();
    }
  }
};

/**
 * GET /api/repositories/:id/architecture
 * Generate an AI architecture diagram (Mermaid syntax) for a repository.
 */
const getRepositoryArchitecture = async (req, res, next) => {
  try {
    const repoId = parseInt(req.params.id);
    const repo = await prisma.repository.findFirst({
      where: { id: repoId, userId: req.user.id },
    });
    if (!repo) return res.status(404).json({ error: { message: 'Repository not found' } });

    if (repo.indexStatus !== 'INDEXED') {
      return res.status(400).json({
        error: { message: 'Repository must be indexed before generating architecture diagram.' },
      });
    }

    const prompt = req.body?.prompt || req.query?.prompt || null;
    const result = await getArchitectureDiagram(repoId, prompt);
    res.json({
      repositoryId: repoId,
      repositoryName: repo.name,
      diagram: result.diagram,
      sources: result.sources || [],
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET or POST /api/repositories/:id/docs
 * Generate comprehensive AI Markdown technical documentation for a repository.
 * Supports optional custom user prompt / requirements.
 */
const getRepositoryDocumentation = async (req, res, next) => {
  try {
    const repoId = parseInt(req.params.id);
    const repo = await prisma.repository.findFirst({
      where: { id: repoId, userId: req.user.id },
    });
    if (!repo) return res.status(404).json({ error: { message: 'Repository not found' } });

    if (repo.indexStatus !== 'INDEXED') {
      return res.status(400).json({
        error: { message: 'Repository must be indexed before generating documentation.' },
      });
    }

    const prompt = req.body?.prompt || req.query?.prompt || null;
    const result = await getRepositoryDocs(repoId, prompt);
    res.json({
      repositoryId: repoId,
      repositoryName: repo.name,
      documentation: result.documentation,
      sources: result.sources || [],
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createChatMessage,
  createChatMessageStream,
  getChatSessions,
  getChatMessages,
  getRepositoryArchitecture,
  getRepositoryDocumentation,
};


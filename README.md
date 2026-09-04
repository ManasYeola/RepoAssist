# RepoGPT — AI-Powered GitHub Code Intelligence Platform

> Built with Node.js + Express, Python FastAPI + LangChain, PostgreSQL/PGVector, Google Gemini, and React/Vite.

## Architecture

```
React Frontend
      ↓ (HTTP, cookies)
Node.js Express :3000        ← Auth, Repo Sync, AST Chunking, Session
      ↓ (internal HTTP)
Python FastAPI :8000         ← LangChain RAG, Embeddings, PGVector
      ↓
Neon PostgreSQL + PGVector   ← Vector store
      ↓
Google Gemini API            ← text-embedding-004 + gemini-1.5-flash
```

## Quick Start

### 1. Prerequisites

- Node.js 18+
- Neon PostgreSQL account (free at neon.tech) with pgvector enabled
- Google Gemini API key (from Google AI Studio)
- GitHub OAuth App (from github.com/settings/developers)

### 2. Backend Setup

```bash
cd backend
cp .env.example .env
# Fill in .env with your credentials
npm install
npm run db:push       # Push schema to Neon
npm run db:generate   # Generate Prisma client
npm run dev           # Start dev server on :3000
```

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run dev           # Start Vite on :5173
```

### 4. GitHub OAuth App Settings

In your GitHub OAuth App:
- **Homepage URL:** `http://localhost:5173`
- **Authorization callback URL:** `http://localhost:3000/api/auth/github/callback`

## Environment Variables

```
PORT=3000
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_CALLBACK_URL=http://localhost:3000/api/auth/github/callback
SESSION_SECRET=...
DATABASE_URL=postgresql://...@...neon.tech/repogpt?sslmode=require
GEMINI_API_KEY=...
FRONTEND_URL=http://localhost:5173
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/github` | Initiate GitHub OAuth |
| GET | `/api/auth/me` | Get current user |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/repositories` | List synced repos |
| POST | `/api/repositories/sync` | Sync from GitHub |
| POST | `/api/repositories/:id/index` | Start indexing |
| GET | `/api/repositories/:id/index/status` | Poll index status |
| POST | `/api/repositories/:id/reindex` | Force re-index |
| POST | `/api/repositories/:id/chat` | Send chat message (RAG) |
| GET | `/api/repositories/:id/chats` | List chat sessions |
| GET | `/api/chats/:chatId/messages` | Get session messages |

## Features

- **Code-Aware Chunking:** AST-based for JS/TS (Babel), Python (regex+indent), Java (regex+brace tracking)
- **Hybrid Retrieval:** Vector similarity (PGVector) + Full-text search (tsvector) fused with RRF
- **Gemini Integration:** `text-embedding-004` (768-dim) for embeddings, `gemini-1.5-flash` for answers
- **Incremental Indexing:** SHA comparison skips unchanged files
- **Source Citations:** Every answer includes file paths and line ranges
- **Chat History:** Persistent sessions with multi-turn context

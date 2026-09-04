# Product Requirements Document (PRD)
# AI-Powered GitHub Code Intelligence Platform

**Project Name:** RepoGPT / CodePilot  
**Category:** AI Developer Tool / Code Intelligence / RAG  
**Target Role:** AI Engineer  
**Backend:** Node.js + Express.js

---

## 1. Product Overview

Build an AI-powered platform that allows developers to connect their GitHub account, index repositories, and ask natural-language questions about their codebase.

The key differentiator is **code-aware chunking**. Instead of splitting source code arbitrarily by character or token count, the system understands programming-language structures such as classes, functions, methods, interfaces, imports, and modules and creates semantically meaningful chunks.

### Core Flow

GitHub OAuth → Repository Synchronization → Code Ingestion → Code-Aware Chunking → Embeddings → PGVector → Retrieval → RAG → LLM → Answer + Source Citations

---

## 2. Problem Statement

Developers working with unfamiliar or large codebases spend significant time:

- Finding where functionality is implemented
- Understanding unfamiliar classes and functions
- Tracing dependencies
- Understanding authentication and API flows
- Locating relevant files
- Understanding relationships between modules
- Onboarding new developers

Traditional keyword search is insufficient because users may ask questions without knowing the names of relevant files or functions.

A generic LLM also cannot reliably answer questions about a private repository unless relevant repository context is supplied.

The platform therefore needs to:

1. Ingest a user's GitHub repository.
2. Understand its source-code structure.
3. Create meaningful code chunks.
4. Generate embeddings.
5. Store embeddings in a vector database.
6. Retrieve relevant code for a question.
7. Generate an answer grounded in the repository.
8. Provide source files and line-level citations.

---

## 3. Goals

### Primary Goals

- Authenticate users through GitHub OAuth.
- Fetch repositories authorized by the user.
- Allow users to select repositories for indexing.
- Build a code-aware indexing pipeline.
- Generate embeddings for code chunks.
- Store embeddings in PostgreSQL + PGVector.
- Implement repository-isolated RAG.
- Allow users to chat with individual repositories.
- Provide source-code citations.
- Support incremental repository re-indexing.

### AI Engineering Goals

Demonstrate:

- Code-aware preprocessing
- AST-based parsing
- Embedding generation
- Vector search
- Semantic retrieval
- Hybrid retrieval
- Reranking
- Retrieval-Augmented Generation
- Context construction
- LLM integration
- RAG evaluation
- Incremental indexing

---

## 4. Non-Goals

The first version will not attempt to:

- Automatically modify or commit code.
- Automatically deploy repositories.
- Replace GitHub.
- Train an LLM from scratch.
- Execute arbitrary repository code.
- Guarantee that AI-generated answers are always correct.

---

## 5. Target User Flow

```text
                         USER
                           |
                           v
                    GitHub OAuth
                           |
                           v
                      Dashboard
                           |
                           v
                 Fetch Repositories
                           |
                           v
                  Select Repository
                           |
                           v
                 "Index Repository"
                           |
                           v
                Repository Ingestion
                           |
                           v
                Code-Aware Chunking
                           |
                           v
                 Generate Embeddings
                           |
                           v
                       PGVector
                           |
                           v
                    Index Complete
                           |
                           v
                  "Chat with Repo"
                           |
                           v
                    User Question
                           |
                           v
                  Query Embedding
                           |
                           v
                 Hybrid / Vector Search
                           |
                           v
                  Relevant Code Chunks
                           |
                           v
                  Context Construction
                           |
                           v
                         LLM
                           |
                           v
                 Answer + Citations
```

---

# 6. Functional Requirements

## FR-1: GitHub Authentication

Users must be able to authenticate using GitHub OAuth.

### Requirements

- Login with GitHub
- Request required repository permissions
- Receive OAuth authorization code
- Exchange code for access token
- Retrieve GitHub profile
- Create/update local user
- Create authenticated application session
- Store GitHub token securely

### APIs

```http
GET  /api/auth/github
GET  /api/auth/github/callback
GET  /api/auth/me
POST /api/auth/logout
```

---

## FR-2: Repository Synchronization

After authentication, the backend retrieves repositories accessible to the user.

### Repository Metadata

```text
repositoryId
githubRepositoryId
name
owner
description
language
private
defaultBranch
url
lastUpdated
latestCommitSha
indexStatus
```

### APIs

```http
GET  /api/repositories
POST /api/repositories/sync
GET  /api/repositories/:id
```

---

## FR-3: Repository Indexing

Users can select a repository and click **Index Repository**.

### Status Flow

```text
NOT_INDEXED
     |
     v
INDEXING
     |
     +------> ERROR
     |
     v
INDEXED
```

### UI Example

```text
Repository: AyuTrace

Language: Java
Files: 247

Status: Not Indexed

[ INDEX REPOSITORY ]
```

After completion:

```text
Status: Indexed ✓
Last indexed: 22 Aug 2026

[ CHAT ] [ RE-INDEX ]
```

---

# 7. Code-Aware Chunking

## 7.1 Why Code-Aware Chunking?

Naive RAG often uses fixed-size chunks:

```text
Source File
    |
    +-- 500 tokens
    +-- 500 tokens
    +-- 500 tokens
```

This can split a function or class in the middle, resulting in incomplete context.

### Example

Bad:

```text
Chunk 1:
function authenticateUser(...) {
    ...
    if (...) {
        ...

Chunk 2:
    }
    generateToken(...)
}
```

The second chunk may not be meaningful on its own.

---

## 7.2 Code-Aware Approach

```text
Source File
     |
     v
Language Detection
     |
     v
AST / Language Parser
     |
     v
Extract Code Structures
     |
     +-- Imports
     +-- Classes
     +-- Interfaces
     +-- Functions
     +-- Methods
     +-- Constants
     +-- Declarations
     |
     v
Semantic Chunk Builder
     |
     v
Code Chunks
```

Each chunk should represent a meaningful programming construct.

---

## 7.3 Example

Given:

```javascript
class AuthService {

    async login(email, password) {
        const user = await User.findOne({ email });

        if (!user) {
            throw new Error("User not found");
        }

        return generateToken(user);
    }

    async logout(userId) {
        await Session.deleteOne({ userId });
    }
}
```

Instead of arbitrary chunks, produce semantic chunks such as:

```text
Chunk 1:
Class: AuthService

Chunk 2:
AuthService.login()

Chunk 3:
AuthService.logout()
```

---

## 7.4 Chunk Metadata

Each code chunk should store:

```json
{
  "repositoryId": 42,
  "filePath": "services/authService.js",
  "language": "javascript",
  "symbolName": "AuthService.login",
  "symbolType": "method",
  "parentSymbol": "AuthService",
  "startLine": 3,
  "endLine": 11,
  "content": "..."
}
```

This metadata improves retrieval and source citation.

---

# 8. Language Support

### Initial languages

| Language | Strategy |
|---|---|
| JavaScript | AST |
| TypeScript | AST |
| Python | AST |
| Java | AST/parser |
| C++ | AST/parser |
| Go | AST/parser |

For unsupported languages:

```text
Unsupported Language
        |
        v
Fallback Token-Based Chunking
```

The system should degrade gracefully rather than failing completely.

---

# 9. Hierarchical Code Context

The system should preserve relationships such as:

```text
Repository
   |
   +-- src
       |
       +-- services
           |
           +-- AuthService
               |
               +-- login()
               +-- logout()
               +-- refreshToken()
```

For a question such as:

> How does login work?

retrieval can return:

```text
AuthService.login()
AuthService
UserRepository
TokenService
```

when additional surrounding context is useful.

---

# 10. Embedding Pipeline

```text
Code Chunk
    |
    v
Normalize / Clean
    |
    v
Embedding Model
    |
    v
Vector
    |
    v
PGVector
```

Each chunk receives a vector representation that captures its semantic meaning.

---

# 11. Database Design

Use:

**PostgreSQL + PGVector**

### Main tables

```text
users
github_accounts
repositories
files
code_chunks
chat_sessions
chat_messages
```

Conceptual relationship:

```text
User
 |
 +---- GitHub Account
 |
 +---- Repository
          |
          +---- Files
                  |
                  +---- Code Chunks
                           |
                           +---- Embedding
```

### Code Chunk Fields

```text
chunkId
repositoryId
fileId
filePath
language
symbolName
symbolType
parentSymbol
startLine
endLine
content
embedding
```

---

# 12. Repository-Isolated Retrieval

This is a critical security and correctness requirement.

If the user is chatting with Repository A, the vector search must not return chunks from Repository B.

Conceptually:

```sql
WHERE repository_id = selectedRepositoryId
```

Retrieval flow:

```text
User Question
      |
      v
Question Embedding
      |
      v
PGVector
      |
      v
Filter by Repository ID
      |
      v
Similarity Search
      |
      v
Top-K Chunks
```

---

# 13. Hybrid Retrieval

Recommended retrieval architecture:

```text
                  User Query
                      |
             +--------+--------+
             |                 |
             v                 v
       Vector Search      Keyword Search
             |                 |
             +--------+--------+
                      |
                      v
                  Reranking
                      |
                      v
                  Top-K Chunks
```

### Why hybrid retrieval?

Semantic search is useful for:

> "How does user authentication work?"

Keyword search is useful for:

> "Where is getUserById implemented?"

Combining both provides stronger code retrieval.

---

# 14. RAG Pipeline

```text
User Question
      |
      v
Question Embedding
      |
      v
Vector / Hybrid Search
      |
      v
Top-K Code Chunks
      |
      v
Reranking
      |
      v
Context Builder
      |
      v
LLM Prompt
      |
      v
LLM
      |
      v
Answer + Source Citations
```

The LLM should be instructed to answer using repository context and avoid inventing unsupported implementation details.

---

# 15. Source Citations

Every AI answer should ideally provide:

```text
Sources

src/controllers/AuthController.java
Lines 24-58

src/services/AuthService.java
Lines 61-94
```

The frontend should make these sources clickable where practical.

Benefits:

- Trust
- Debuggability
- Hallucination detection
- Better developer experience

---

# 16. Incremental Indexing

Avoid re-indexing the entire repository every time.

```text
GitHub Repository
       |
       v
Latest Commit SHA
       |
       v
Compare with Stored SHA
       |
       +------ No Change ------> Skip
       |
       v
Changed Files
       |
       v
Re-chunk Changed Files
       |
       v
Re-embed Changed Chunks
       |
       v
Update PGVector
```

This reduces:

- Processing time
- Embedding API usage
- Database writes
- Infrastructure cost

---

# 17. AI Chat

### Example UI

```text
+------------------------------------------------+
| RepoGPT                                        |
| Repository: AyuTrace                           |
+------------------------------------------------+
|                                                |
| You:                                           |
| How does farmer registration work?             |
|                                                |
| AI:                                            |
| Farmer registration starts in                  |
| FarmerController.java and delegates validation |
| and persistence to FarmerService...            |
|                                                |
| Sources:                                       |
| - FarmerController.java                        |
| - FarmerService.java                           |
| - FarmerRepository.java                        |
|                                                |
+------------------------------------------------+
| Ask about your repository...             [ > ] |
+------------------------------------------------+
```

### API

```http
POST /api/repositories/:id/chat
GET  /api/repositories/:id/chats
GET  /api/chats/:chatId/messages
```

---

# 18. Backend Architecture

Recommended Node.js + Express structure:

```text
backend/
|
+-- src/
|   |
|   +-- controllers/
|   |   +-- auth.controller.js
|   |   +-- repository.controller.js
|   |   +-- indexing.controller.js
|   |   +-- chat.controller.js
|   |
|   +-- services/
|   |   +-- github.service.js
|   |   +-- repository.service.js
|   |   +-- indexing.service.js
|   |   +-- chunking.service.js
|   |   +-- embedding.service.js
|   |   +-- retrieval.service.js
|   |   +-- rag.service.js
|   |
|   +-- parsers/
|   |   +-- javascript.parser.js
|   |   +-- typescript.parser.js
|   |   +-- python.parser.js
|   |   +-- java.parser.js
|   |
|   +-- routes/
|   |   +-- auth.routes.js
|   |   +-- repository.routes.js
|   |   +-- indexing.routes.js
|   |   +-- chat.routes.js
|   |
|   +-- middleware/
|   |   +-- auth.middleware.js
|   |   +-- error.middleware.js
|   |
|   +-- utils/
|   |
|   +-- app.js
|   +-- server.js
|
+-- prisma/
|   +-- schema.prisma
|
+-- package.json
+-- .env
```

---

# 19. API Requirements

## Authentication

```http
GET  /api/auth/github
GET  /api/auth/github/callback
GET  /api/auth/me
POST /api/auth/logout
```

## Repositories

```http
GET  /api/repositories
POST /api/repositories/sync
GET  /api/repositories/:id
```

## Indexing

```http
POST /api/repositories/:id/index
GET  /api/repositories/:id/index/status
POST /api/repositories/:id/reindex
```

## Chat

```http
POST /api/repositories/:id/chat
GET  /api/repositories/:id/chats
GET  /api/chats/:chatId/messages
```

---

# 20. AI Service Abstraction

Do not scatter provider-specific AI calls throughout the Express controllers.

Create an abstraction:

```text
AIService
   |
   +-- generateEmbedding()
   |
   +-- generateAnswer()
```

Possible providers:

```text
OpenAIProvider
GeminiProvider
OllamaProvider
```

This allows the application to switch AI providers without rewriting the RAG pipeline.

---

# 21. RAG Evaluation

This is especially important for positioning the project as an AI Engineering project.

Create a benchmark dataset:

```text
Question                    Expected Source

Where is JWT generated?     jwt.service.ts
How is login handled?      auth.service.ts
Where is DB configured?    database.config.ts
```

### Retrieval Metrics

- Precision@K
- Recall@K
- MRR

### Generation Metrics

- Faithfulness
- Context relevance
- Answer relevance

### Important Experiment

Compare:

```text
Naive Fixed-Size Chunking
            VS
Code-Aware Chunking
```

Example format:

```text
Metric                 Naive      Code-Aware

Recall@5                XX%          XX%
MRR                     XX           XX
Context Relevance       XX%          XX%
```

Only report numbers after actually running the evaluation.

---

# 22. Security Requirements

The system must:

- Never expose GitHub access tokens to the frontend.
- Never expose AI API keys.
- Store sensitive credentials securely.
- Validate OAuth state.
- Authenticate repository API requests.
- Verify repository access before indexing.
- Prevent cross-repository retrieval.
- Validate user input.
- Rate-limit AI requests.
- Limit repository indexing workloads.
- Never execute repository code during indexing.

---

# 23. Performance Requirements

Initial targets:

- Repository metadata synchronization: under 5 seconds for normal repositories.
- Indexing should expose progress.
- Retrieval should return only relevant top-K chunks.
- Chat retrieval should ideally complete within 2 seconds excluding LLM generation.
- Chat response target: under 8 seconds.
- Incremental indexing should process only changed files.

These are engineering targets, not guarantees.

---

# 24. MVP Scope

### Phase 1 — Core

- GitHub OAuth
- Repository synchronization
- Repository dashboard
- Repository indexing
- JavaScript/TypeScript code-aware chunking
- Embeddings
- PostgreSQL + PGVector
- Semantic retrieval
- RAG chat
- Source citations

### Phase 2 — AI Engineering

- Python/Java parsers
- Hybrid retrieval
- Reranking
- Incremental indexing
- Chat history
- Evaluation framework
- Chunking comparison

### Phase 3 — Advanced

- Automatic architecture diagrams
- AI-generated repository documentation
- Bug detection
- Dependency analysis
- Code quality insights
- GitHub webhook-based automatic re-indexing

---

# 25. Final System Architecture

```text
                         GITHUB
                           |
                           v
                    GitHub OAuth/API
                           |
                           v
                  +----------------+
                  |    Express     |
                  |    Backend     |
                  +-------+--------+
                          |
             +------------+-------------+
             |                          |
             v                          v
      Repository Sync             PostgreSQL
             |                          |
             v                          |
        Source Files                    |
             |                          |
             v                          |
      Language Detection                |
             |                          |
             v                          |
          AST Parser                   |
             |                          |
             v                          |
     Code-Aware Chunking               |
             |                          |
             v                          |
        Embeddings                     |
             |                          |
             +------------+-------------+
                          |
                          v
                    +-----------+
                    |  PGVector |
                    +-----+-----+
                          |
                    User Question
                          |
                          v
                   Query Embedding
                          |
                          v
                  Hybrid Retrieval
                          |
                          v
                      Reranking
                          |
                          v
                   Relevant Code
                          |
                          v
                  Context Builder
                          |
                          v
                         LLM
                          |
                          v
                 Answer + Citations
```

---

# 26. Final Product Differentiator

### Basic version

> Chat with your GitHub repository using RAG.

### Final version

> **An AI code-intelligence platform that uses AST-based code-aware chunking, embeddings, hybrid retrieval, reranking, and RAG to understand GitHub codebases and answer developer questions with source-level citations.**

The most important AI engineering experiment is:

```text
               Codebase
                  |
        +---------+---------+
        |                   |
        v                   v
 Naive Chunking      Code-Aware Chunking
        |                   |
        v                   v
   Embeddings          Embeddings
        |                   |
        v                   v
     Retrieval           Retrieval
        |                   |
        +---------+---------+
                  |
                  v
             Evaluation
                  |
                  v
      Compare Recall / MRR /
      Context Relevance /
      Faithfulness
```

This makes the project more than an LLM wrapper: it becomes an **end-to-end AI retrieval system with an experimentally measurable improvement in how source code is represented and retrieved.**

---

## Suggested Resume Title

**AI-Powered GitHub Code Intelligence Platform**

### Resume description

> Built an AI-powered GitHub code intelligence platform using Node.js, Express, PostgreSQL/PGVector and RAG, implementing AST-based code-aware chunking, semantic/hybrid retrieval and source-grounded LLM responses for repository-level code understanding.


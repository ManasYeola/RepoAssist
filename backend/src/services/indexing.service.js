/**
 * Indexing Service — orchestrates the full repository indexing pipeline.
 *
 * Flow:
 *  1. Fetch latest commit SHA from GitHub
 *  2. Compare with stored SHA (incremental mode)
 *  3. Fetch file tree
 *  4. For each file: fetch content → AST chunk (Node.js parsers)
 *  5. Batch-send chunks to Python RAG service for embedding + PGVector storage
 *  6. Update repository record with status + stats
 */

const axios = require('axios');
const { getLatestCommitSha, getRepositoryTree, getFileContent, getCommitDiff } = require('./github.service');
const { chunkFile, shouldSkipFile } = require('./chunking.service');
const { getRepositorySummary } = require('./rag.service');
const prisma = require('../utils/prisma');

const PYTHON_RAG_URL = process.env.PYTHON_RAG_URL || 'http://localhost:8000';

const ragClient = axios.create({
  baseURL: PYTHON_RAG_URL,
  timeout: 120000, // 2 min for large embedding batches
});

// Track indexing progress in memory
const indexingProgress = new Map();

/**
 * Get the current indexing progress for a repository.
 */
const getIndexingProgress = (repositoryId) => {
  return indexingProgress.get(repositoryId) || { status: 'idle', progress: 0, message: '' };
};

/**
 * Supported file extensions to index
 */
const INDEXABLE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.java', '.go', '.cpp', '.cc', '.c',
  '.cs', '.rb', '.rs', '.php', '.swift', '.kt',
  '.md', '.txt',
]);

const isIndexable = (path) => {
  const ext = '.' + path.split('.').pop().toLowerCase();
  return INDEXABLE_EXTENSIONS.has(ext) && !shouldSkipFile(path);
};

/**
 * Delete vectors for a specific file from Python RAG service.
 * Called during incremental re-indexing before re-embedding a modified file.
 */
const deleteFileVectorsFromPython = async (repositoryId, filePath) => {
  try {
    await ragClient.post('/embed/delete-file', {
      repository_id: repositoryId,
      file_path: filePath,
    });
  } catch (err) {
    console.warn(`[Indexing] Could not delete vectors for ${filePath}:`, err.message);
  }
};

/**
 * Send a batch of chunks to the Python RAG service for embedding + storage.
 * Python handles: sentence-transformers embeddings → LangChain PGVector upsert.
 */
const sendChunksToPython = async (repositoryId, chunks) => {
  if (chunks.length === 0) return 0;

  // Rename camelCase keys to snake_case for Python Pydantic models
  const pythonChunks = chunks.map((c) => ({
    file_path: c.filePath,
    language: c.language,
    symbol_name: c.symbolName || null,
    symbol_type: c.symbolType || null,
    parent_symbol: c.parentSymbol || null,
    start_line: c.startLine,
    end_line: c.endLine,
    content: c.content,
  }));

  const response = await ragClient.post('/embed', {
    repository_id: repositoryId,
    chunks: pythonChunks,
  });

  return response.data.chunks_embedded;
};

/**
 * Full indexing pipeline for a repository.
 *
 * @param {number} repositoryId
 * @param {string} accessToken - GitHub access token
 * @param {boolean} incremental - If true, only re-index changed files
 */
const indexRepository = async (repositoryId, accessToken, incremental = false) => {
  const repo = await prisma.repository.findUnique({ where: { id: repositoryId } });
  if (!repo) throw new Error(`Repository ${repositoryId} not found`);

  const setProgress = (progress, message) => {
    indexingProgress.set(repositoryId, { status: 'indexing', progress, message });
    console.log(`[Indexing] [${repo.fullName}] ${progress}% — ${message}`);
  };

  try {
    await prisma.repository.update({
      where: { id: repositoryId },
      data: { indexStatus: 'INDEXING' },
    });

    setProgress(5, 'Fetching latest commit...');
    const latestSha = await getLatestCommitSha(accessToken, repo.owner, repo.name, repo.defaultBranch);

    // Incremental: skip if no changes
    if (incremental && repo.latestCommitSha === latestSha) {
      await prisma.repository.update({
        where: { id: repositoryId },
        data: { indexStatus: 'INDEXED' },
      });
      indexingProgress.set(repositoryId, { status: 'complete', progress: 100, message: 'Already up to date' });
      return { skipped: true, reason: 'No changes detected' };
    }

    setProgress(10, 'Fetching repository file tree...');
    const tree = await getRepositoryTree(accessToken, repo.owner, repo.name, latestSha);

    const indexableFiles = tree.filter(
      (item) => item.type === 'blob' && isIndexable(item.path)
    );

    setProgress(15, `Found ${indexableFiles.length} indexable files`);

    if (!incremental) {
      setProgress(18, 'Clearing existing index in Python RAG service...');
      // Tell Python to delete all vectors for this repo
      try {
        await ragClient.delete(`/repo/${repositoryId}`);
      } catch (err) {
        console.warn('[Indexing] Could not clear Python vectors:', err.message);
      }
      try {
        await prisma.codeChunk.deleteMany({ where: { repositoryId } });
      } catch (chunkErr) {
        console.warn('[Indexing] Could not clear code chunks:', chunkErr.message);
      }
      await prisma.file.deleteMany({ where: { repositoryId } });
    }

    // ── INCREMENTAL: use GitHub Commit Diff to find only changed files ─────
    let filesToIndex = indexableFiles; // default: all files
    const removedFilePaths = new Set();

    if (incremental && repo.latestCommitSha) {
      setProgress(20, 'Fetching commit diff to find changed files...');
      try {
        const diffFiles = await getCommitDiff(
          accessToken, repo.owner, repo.name, repo.latestCommitSha, latestSha
        );

        const addedOrModified = new Set(
          diffFiles
            .filter((f) => ['added', 'modified', 'renamed', 'copied'].includes(f.status))
            .map((f) => f.filename)
        );

        const removed = diffFiles
          .filter((f) => f.status === 'removed')
          .map((f) => f.filename);

        removed.forEach((p) => removedFilePaths.add(p));

        // Filter indexable file tree to only the changed+added files
        filesToIndex = indexableFiles.filter((item) => addedOrModified.has(item.path));

        setProgress(22, `Incremental: ${filesToIndex.length} changed files, ${removed.length} removed`);
        console.log(`[Indexing] Incremental: ${filesToIndex.length} changed, ${removed.length} removed out of ${indexableFiles.length} total`);

        // Delete vectors for removed files from Python
        for (const removedPath of removed) {
          await deleteFileVectorsFromPython(repositoryId, removedPath);
        }

        // Delete DB records for removed files
        if (removed.length > 0) {
          await prisma.file.deleteMany({
            where: { repositoryId, path: { in: removed } },
          });
        }

        // Delete vectors for modified files (will be re-embedded below)
        for (const changedPath of addedOrModified) {
          await deleteFileVectorsFromPython(repositoryId, changedPath);
        }

      } catch (diffErr) {
        console.warn('[Indexing] Commit diff failed, falling back to full index:', diffErr.message);
        filesToIndex = indexableFiles;
      }
    }

    // If nothing changed in incremental mode, skip
    if (incremental && filesToIndex.length === 0 && removedFilePaths.size === 0) {
      await prisma.repository.update({
        where: { id: repositoryId },
        data: { indexStatus: 'INDEXED', latestCommitSha: latestSha },
      });
      indexingProgress.set(repositoryId, { status: 'complete', progress: 100, message: 'Already up to date' });
      return { skipped: true, reason: 'No changed files detected' };
    }

    let processedFiles = 0;
    let totalChunks = 0;
    const CHUNK_SEND_BATCH = 100;
    let pendingChunks = [];
    const filesToCreate = [];

    // Chain chunk flushes to Python so requests are pipelined safely
    let flushPromise = Promise.resolve();

    const enqueueChunks = (chunks) => {
      pendingChunks.push(...chunks);
      if (pendingChunks.length >= CHUNK_SEND_BATCH) {
        const batchToSend = pendingChunks.splice(0, pendingChunks.length);
        flushPromise = flushPromise.then(async () => {
          try {
            const count = await sendChunksToPython(repositoryId, batchToSend);
            totalChunks += count;
          } catch (embedErr) {
            console.error('[Indexing] Error embedding batch:', embedErr.message);
          }
        });
      }
    };

    // ── CONCURRENT PARALLEL WORKER POOL (12 Parallel Workers) ───────────────
    const CONCURRENCY = 12;
    let fileCursor = 0;

    const worker = async () => {
      while (fileCursor < filesToIndex.length) {
        const i = fileCursor++;
        const item = filesToIndex[i];

        try {
          // 1. Fetch file content from GitHub (runs up to 12 in parallel!)
          const content = await getFileContent(accessToken, repo.owner, repo.name, item.path, latestSha);

          // 2. Code-aware AST chunking in memory
          const rawChunks = chunkFile(content, item.path);
          if (rawChunks.length > 0) {
            enqueueChunks(rawChunks);
          }

          // 3. Collect file metadata for bulk database write
          filesToCreate.push({
            repositoryId,
            path: item.path,
            name: item.path.split('/').pop(),
            sha: item.sha,
          });

          processedFiles++;

          // Report progress periodically without spamming console
          if (processedFiles % 4 === 0 || processedFiles === indexableFiles.length) {
            const progressPct = Math.min(88, Math.floor(20 + (processedFiles / indexableFiles.length) * 68));
            setProgress(progressPct, `Parsed ${processedFiles}/${indexableFiles.length} files (${totalChunks} chunks embedded)`);
          }
        } catch (fileErr) {
          console.warn(`[Indexing] Skipping ${item.path}:`, fileErr.message);
        }
      }
    };

    // Run 12 workers in parallel
    const activeWorkers = Math.min(CONCURRENCY, filesToIndex.length);
    console.log(`[Indexing] Starting ${activeWorkers} parallel download/parse workers for ${filesToIndex.length} files...`);
    await Promise.all(Array.from({ length: activeWorkers }, () => worker()));

    // Wait for in-flight Python flushes to complete
    await flushPromise;

    // Flush any remaining trailing chunks
    if (pendingChunks.length > 0) {
      setProgress(90, `Embedding final batch (${pendingChunks.length} chunks)...`);
      const count = await sendChunksToPython(repositoryId, pendingChunks);
      totalChunks += count;
      pendingChunks = [];
    }

    // ── BATCH DATABASE WRITE (1 Bulk SQL query instead of 100+ roundtrips) ──
    if (filesToCreate.length > 0) {
      setProgress(94, `Bulk saving metadata for ${filesToCreate.length} files...`);
      await prisma.file.createMany({
        data: filesToCreate,
        skipDuplicates: true,
      });
    }

    setProgress(97, 'Finalizing repository stats...');

    await prisma.repository.update({
      where: { id: repositoryId },
      data: {
        indexStatus: 'INDEXED',
        indexedAt: new Date(),
        latestCommitSha: latestSha,
        totalFiles: processedFiles,
        totalChunks,
      },
    });

    indexingProgress.set(repositoryId, {
      status: 'complete',
      progress: 100,
      message: `Indexed ${processedFiles} files, ${totalChunks} chunks`,
    });

    console.log(`[Indexing] ✓ ${repo.fullName}: ${processedFiles} files, ${totalChunks} chunks in record time`);

    // Pre-compute repository summary in the background so it's ready when user opens repo
    try {
      const summaryResult = await getRepositorySummary(repositoryId);
      if (summaryResult && summaryResult.summary) {
        await prisma.repository.update({
          where: { id: repositoryId },
          data: { summary: summaryResult.summary },
        });
        console.log(`[Indexing] ✓ Generated summary for ${repo.fullName}`);
      }
    } catch (summaryErr) {
      console.warn(`[Indexing] Could not pre-generate summary for ${repo.fullName}:`, summaryErr.message);
    }

    return { processedFiles, totalChunks };

  } catch (err) {
    console.error(`[Indexing] Error for ${repo.fullName}:`, err);

    await prisma.repository.update({
      where: { id: repositoryId },
      data: { indexStatus: 'ERROR' },
    });

    indexingProgress.set(repositoryId, {
      status: 'error',
      progress: 0,
      message: err.message,
    });

    throw err;
  }
};

module.exports = { indexRepository, getIndexingProgress };

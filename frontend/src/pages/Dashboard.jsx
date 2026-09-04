import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listRepositories, syncRepositories, startIndexing, startReindex, getIndexStatus } from '../api';

const LANGUAGE_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5',
  Java: '#b07219', 'C++': '#f34b7d', Go: '#00ADD8', Rust: '#dea584',
  Ruby: '#701516', PHP: '#4F5D95', Swift: '#ffac45', Kotlin: '#A97BFF',
  default: '#6366f1',
};

const StatusBadge = ({ status }) => {
  const configs = {
    INDEXED: { cls: 'badge-success', label: '✓ Indexed' },
    INDEXING: { cls: 'badge-indexing', label: '⟳ Indexing' },
    ERROR: { cls: 'badge-error', label: '✗ Error' },
    NOT_INDEXED: { cls: 'badge-default', label: 'Not Indexed' },
  };
  const config = configs[status] || configs.NOT_INDEXED;
  return <span className={`badge ${config.cls}`}>{config.label}</span>;
};

const RepoCard = ({
  repo,
  onIndex,
  onRequestReindex,
  onIncrementalReindex,
  onChat,
  indexingState,
  activeMode,
}) => {
  const langColor = LANGUAGE_COLORS[repo.language] || LANGUAGE_COLORS.default;
  const isIndexing = repo.indexStatus === 'INDEXING' || indexingState?.status === 'indexing';
  const progress = indexingState?.progress || 0;

  const isFullReindexing = isIndexing && activeMode === 'full';
  const isIncrementalSyncing = isIndexing && activeMode === 'incremental';
  const isInitialIndexing = isIndexing && (!activeMode || activeMode === 'initial');

  return (
    <div className="card repo-card">
      <div className="repo-card-header">
        <div>
          <div className="repo-name">{repo.name}</div>
          <div className="repo-owner">{repo.owner}</div>
        </div>
        <StatusBadge status={isIndexing ? 'INDEXING' : repo.indexStatus} />
      </div>

      <p className="repo-description">
        {repo.description || <span style={{ color: 'var(--text-muted)' }}>No description</span>}
      </p>

      <div className="repo-meta">
        {repo.language && (
          <div className="repo-meta-item">
            <div className="lang-dot" style={{ background: langColor }} />
            {repo.language}
          </div>
        )}
        {repo.isPrivate && (
          <div className="repo-meta-item">
            <span>🔒</span> Private
          </div>
        )}
        {repo.totalFiles != null && (
          <div className="repo-meta-item">
            <span>📁</span> {repo.totalFiles} files
          </div>
        )}
        {repo.totalChunks != null && (
          <div className="repo-meta-item">
            <span>🧩</span> {repo.totalChunks} chunks
          </div>
        )}
      </div>

      {isIndexing && (
        <div style={{ marginBottom: 16 }}>
          <div className="progress-bar-wrap">
            <div className="progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <div className="progress-label">{indexingState?.message || 'Indexing...'}</div>
        </div>
      )}

      <div className="repo-actions">
        {repo.indexStatus === 'NOT_INDEXED' || repo.indexStatus === 'ERROR' ? (
          <button
            id={`index-btn-${repo.id}`}
            className="btn btn-primary btn-sm"
            onClick={() => onIndex(repo.id)}
            disabled={isIndexing}
          >
            {isInitialIndexing ? (
              <>
                <div className="loading-spinner" style={{ width: 14, height: 14 }} />
                Indexing...
              </>
            ) : (
              '⚡ Index Repository'
            )}
          </button>
        ) : (
          <>
            <button
              id={`chat-btn-${repo.id}`}
              className="btn btn-primary btn-sm"
              onClick={() => onChat(repo.id)}
              disabled={isIndexing}
            >
              💬 Chat
            </button>
            <button
              id={`incremental-reindex-btn-${repo.id}`}
              className="btn btn-secondary btn-sm"
              onClick={() => onIncrementalReindex(repo.id)}
              disabled={isIndexing}
              title="Only re-index files changed since last commit (fast)"
            >
              {isIncrementalSyncing ? (
                <>
                  <div className="loading-spinner" style={{ width: 12, height: 12 }} />
                  Syncing...
                </>
              ) : (
                '⚡ Sync Changes'
              )}
            </button>
            <button
              id={`reindex-btn-${repo.id}`}
              className="btn btn-ghost btn-reindex btn-sm"
              onClick={() => onRequestReindex(repo)}
              disabled={isIndexing}
              title="Full re-index — clears embeddings and re-indexes everything"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={isFullReindexing ? 'spin-icon' : ''}
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              {isFullReindexing ? 'Re-indexing...' : 'Full Re-index'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const Dashboard = ({ user }) => {
  const navigate = useNavigate();
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [indexingStates, setIndexingStates] = useState({});
  const [activeModes, setActiveModes] = useState({});
  const [confirmRepo, setConfirmRepo] = useState(null);
  const [error, setError] = useState(null);

  const fetchRepos = useCallback(async () => {
    try {
      const res = await listRepositories();
      setRepos(res.data);
    } catch (err) {
      setError('Failed to load repositories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRepos(); }, [fetchRepos]);

  // Poll indexing status for repos that are actively indexing
  useEffect(() => {
    const indexingRepos = repos.filter(
      (r) => r.indexStatus === 'INDEXING' || indexingStates[r.id]?.status === 'indexing'
    );
    if (indexingRepos.length === 0) return;

    const interval = setInterval(async () => {
      for (const repo of indexingRepos) {
        try {
          const res = await getIndexStatus(repo.id);
          const { progress, indexStatus } = res.data;

          setIndexingStates((prev) => ({ ...prev, [repo.id]: progress }));

          if (progress.status === 'complete' || indexStatus === 'INDEXED' || indexStatus === 'ERROR') {
            setActiveModes((prev) => {
              const next = { ...prev };
              delete next[repo.id];
              return next;
            });
            // Refresh repo list
            fetchRepos();
          }
        } catch (err) {
          console.warn('Status poll failed:', err.message);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [repos, indexingStates, fetchRepos]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await syncRepositories();
      setRepos(res.data.repositories);
    } catch (err) {
      setError('Sync failed. Please try again.');
    } finally {
      setSyncing(false);
    }
  };

  const handleIndex = async (repoId) => {
    try {
      setActiveModes((prev) => ({ ...prev, [repoId]: 'initial' }));
      await startIndexing(repoId);
      setIndexingStates((prev) => ({ ...prev, [repoId]: { status: 'indexing', progress: 5, message: 'Starting...' } }));
      setRepos((prev) => prev.map((r) => r.id === repoId ? { ...r, indexStatus: 'INDEXING' } : r));
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to start indexing');
      setActiveModes((prev) => {
        const next = { ...prev };
        delete next[repoId];
        return next;
      });
    }
  };

  const handleReindex = async (repoId) => {
    try {
      setActiveModes((prev) => ({ ...prev, [repoId]: 'full' }));
      await startReindex(repoId, false); // Full re-index
      setIndexingStates((prev) => ({ ...prev, [repoId]: { status: 'indexing', progress: 5, message: 'Starting full re-index...' } }));
      setRepos((prev) => prev.map((r) => r.id === repoId ? { ...r, indexStatus: 'INDEXING' } : r));
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to start re-indexing');
      setActiveModes((prev) => {
        const next = { ...prev };
        delete next[repoId];
        return next;
      });
    }
  };

  const handleIncrementalReindex = async (repoId) => {
    try {
      setActiveModes((prev) => ({ ...prev, [repoId]: 'incremental' }));
      await startReindex(repoId, true); // Incremental diff-based re-index
      setIndexingStates((prev) => ({ ...prev, [repoId]: { status: 'indexing', progress: 5, message: 'Syncing changed files...' } }));
      setRepos((prev) => prev.map((r) => r.id === repoId ? { ...r, indexStatus: 'INDEXING' } : r));
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to start incremental sync');
      setActiveModes((prev) => {
        const next = { ...prev };
        delete next[repoId];
        return next;
      });
    }
  };

  return (
    <div className="page">
      <div className="container">
        <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1>Repositories</h1>
            <p>Select a repository to index and chat with your codebase</p>
          </div>
          <button
            id="sync-repos-btn"
            className="btn btn-secondary"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? <><div className="loading-spinner" style={{ width: 16, height: 16 }} /> Syncing...</> : '⟳ Sync from GitHub'}
          </button>
        </div>

        {error && (
          <div style={{ padding: '12px 16px', background: 'var(--error-bg)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-md)', color: 'var(--error)', marginBottom: 24, fontSize: 14 }}>
            {error}
            <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {loading ? (
          <div className="empty-state">
            <div className="loading-dots">
              <span /><span /><span />
            </div>
          </div>
        ) : repos.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📂</div>
            <h3>No repositories yet</h3>
            <p>Sync your GitHub repositories to get started.</p>
            <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
              Sync Repositories
            </button>
          </div>
        ) : (
          <div className="repo-grid">
            {repos.map((repo) => (
              <RepoCard
                key={repo.id}
                repo={repo}
                onIndex={handleIndex}
                onRequestReindex={setConfirmRepo}
                onIncrementalReindex={handleIncrementalReindex}
                onChat={(id) => navigate(`/chat/${id}`)}
                indexingState={indexingStates[repo.id]}
                activeMode={activeModes[repo.id]}
              />
            ))}
          </div>
        )}

        {/* Confirmation Modal for Full Re-index */}
        {confirmRepo && (
          <div className="modal-backdrop" onClick={() => setConfirmRepo(null)}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">
                <span style={{ color: '#c084fc' }}>🔄</span> Full Re-index Confirmation
              </div>
              <div className="modal-desc">
                Are you sure you want to perform a full re-index of{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{confirmRepo.fullName || confirmRepo.name}</strong>?
                <br /><br />
                This will clear all existing vector embeddings for this repository and re-parse all files from the latest GitHub commit.
              </div>
              <div className="modal-actions">
                <button
                  id="cancel-reindex-btn"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setConfirmRepo(null)}
                >
                  Cancel
                </button>
                <button
                  id="confirm-reindex-btn"
                  className="btn btn-primary btn-sm"
                  style={{ background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)' }}
                  onClick={() => {
                    const repoId = confirmRepo.id;
                    setConfirmRepo(null);
                    handleReindex(repoId);
                  }}
                >
                  Yes, Full Re-index
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;

import { API_BASE_URL } from '../api';

const LandingPage = () => {
  const handleLogin = () => {
    window.location.href = `${API_BASE_URL}/api/auth/github`;
  };

  return (
    <div className="hero">
      <div className="hero-bg" />

      <div className="hero-badge">
        <span>✦</span>
        AST-Powered Code Intelligence
      </div>

      <h1 className="hero-title">
        Chat with your{' '}
        <span className="gradient-text">GitHub repo</span>
        <br />
        using AI
      </h1>

      <p className="hero-subtitle">
        RepoAssist uses AST-based code-aware chunking, semantic embeddings, and hybrid retrieval
        to understand your codebase and answer developer questions with source-level citations.
      </p>

      <div className="hero-cta">
        <button className="github-btn" onClick={handleLogin} id="github-login-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          Continue with GitHub
        </button>
      </div>

      <div className="hero-features">
        {[
          'AST-based Code Chunking',
          'Hybrid Retrieval + RRF',
          'Source Citations',
          'Multi-language Support',
          'Incremental Indexing',
          'Gemini 1.5 Flash',
        ].map((feat) => (
          <div className="hero-feature" key={feat}>
            <div className="dot" />
            {feat}
          </div>
        ))}
      </div>

      {/* Architecture diagram preview */}
      <div style={{
        marginTop: 80,
        padding: '32px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)',
        maxWidth: 700,
        width: '100%',
        animation: 'fadeInUp 1.1s ease',
      }}>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 20 }}>
          How it works
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {['GitHub OAuth', '→', 'Repository Sync', '→', 'AST Chunking', '→', 'Embeddings', '→', 'PGVector', '→', 'RAG', '→', 'Answer + Citations'].map((step, i) => (
            step === '→'
              ? <span key={i} style={{ color: 'var(--text-muted)', fontSize: 16 }}>→</span>
              : (
                <span key={i} style={{
                  padding: '6px 14px',
                  background: 'rgba(99,102,241,0.08)',
                  border: '1px solid rgba(99,102,241,0.2)',
                  borderRadius: 20,
                  fontSize: 13,
                  color: 'var(--text-accent)',
                }}>
                  {step}
                </span>
              )
          ))}
        </div>
      </div>
    </div>
  );
};

export default LandingPage;

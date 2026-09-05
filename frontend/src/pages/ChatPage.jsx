import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  getRepository,
  sendChatMessage,
  getChatSessions,
  getChatMessages,
  getArchitectureDiagram,
  getRepositoryDocs,
  getRepositorySummary,
  regenerateRepositorySummary,
  API_BASE_URL,
} from '../api';

// ─── Source Citation Component ────────────────────────────────────────────────

const SourceCitation = ({ sources }) => {
  const [expanded, setExpanded] = useState(false);
  if (!sources || !Array.isArray(sources) || sources.length === 0) return null;

  const uniqueSources = sources.reduce((acc, src) => {
    const path = src.filePath || src.file_path || 'Unknown file';
    const start = src.startLine ?? src.start_line;
    const end = src.endLine ?? src.end_line;
    const key = `${path}:${start}-${end}`;
    if (!acc.map.has(key)) {
      acc.map.set(key, true);
      acc.list.push({ ...src, path, start, end });
    }
    return acc;
  }, { map: new Map(), list: [] }).list;

  const fileName = (p) => p.split('/').pop();

  return (
    <div className="sources-container">
      <button
        className="sources-toggle-btn"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className="sources-toggle-icon">📎</span>
        <span className="sources-toggle-text">
          {uniqueSources.length} {uniqueSources.length === 1 ? 'source' : 'sources'} referenced
        </span>
        <span className="sources-toggle-chevron">{expanded ? '▲' : '▼'}</span>
      </button>

      {!expanded && (
        <div className="sources-pills-row">
          {uniqueSources.slice(0, 4).map((src, i) => (
            <span
              className="source-pill"
              key={i}
              title={`${src.path}${src.start != null ? ` (L${src.start}-${src.end})` : ''}`}
              onClick={() => setExpanded(true)}
            >
              <span className="source-pill-file">{fileName(src.path)}</span>
              {src.start != null && (
                <span className="source-pill-line">:L{src.start}</span>
              )}
            </span>
          ))}
          {uniqueSources.length > 4 && (
            <span className="source-pill-more" onClick={() => setExpanded(true)}>
              +{uniqueSources.length - 4} more
            </span>
          )}
        </div>
      )}

      {expanded && (
        <div className="sources-expanded-panel">
          {uniqueSources.map((src, i) => (
            <div className="source-expanded-card" key={i}>
              <div className="source-card-header">
                <span className="source-badge">{src.symbolType || src.symbol_type || 'code'}</span>
                <span className="source-file-title" title={src.path}>
                  {src.path}
                </span>
                {src.start != null && src.end != null && (
                  <span className="source-lines">L{src.start}–{src.end}</span>
                )}
              </div>
              {(src.symbolName || src.symbol_name) && (
                <div className="source-symbol-name">
                  Symbol: <code>{src.symbolName || src.symbol_name}</code>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Message Component ────────────────────────────────────────────────────────

const Message = ({ msg }) => {
  const isUser = msg.role === 'USER';
  return (
    <div className="message">
      <div className={`message-avatar ${isUser ? 'user' : 'ai'}`}>
        {isUser ? '👤' : '🤖'}
      </div>
      <div className="message-content">
        <div className="message-role">
          {isUser ? 'You' : 'RepoAssist'}
          {msg.isStreaming && <span className="streaming-badge">typing...</span>}
          {msg.mode && msg.mode !== 'default' && (
            <span className={`mode-badge mode-badge--${msg.mode}`}>{MODE_LABELS[msg.mode] || msg.mode}</span>
          )}
        </div>
        <div className="message-body">
          {isUser ? (
            <p>{msg.content}</p>
          ) : (
            <>
              {msg.content ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content}
                </ReactMarkdown>
              ) : null}
              {msg.isStreaming && <span className="streaming-cursor">▍</span>}
              {Array.isArray(msg.sources) && msg.sources.length > 0 && (
                <SourceCitation sources={msg.sources} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const TypingIndicator = () => (
  <div className="message">
    <div className="message-avatar ai">🤖</div>
    <div className="message-content">
      <div className="message-role">RepoAssist</div>
      <div className="typing-indicator">
        <div className="loading-dots">
          <span /><span /><span />
        </div>
        <span>Searching your codebase...</span>
      </div>
    </div>
  </div>
);

// ─── Architecture View Component ──────────────────────────────────────────────

const ARCHITECTURE_PRESETS = [
  {
    label: '🌐 Full Architecture',
    prompt: 'Show me the complete architecture: API routes, controllers, services, database models, authentication flow, and external integrations.',
  },
  {
    label: '🔐 Auth & OAuth Flow',
    prompt: 'Diagram the authentication flow: GitHub OAuth callback, token generation, user verification, session cookie handling, and auth middleware validation.',
  },
  {
    label: '📊 Database & Models (ER)',
    prompt: 'Create a database entity-relationship diagram showing all models, primary keys, foreign keys, and relations in the schema.',
  },
  {
    label: '⚡ Indexing & RAG Pipeline',
    prompt: 'Diagram the repository indexing and RAG pipeline: GitHub file fetching, parallel workers, AST chunking, vector embeddings, PGVector storage, and hybrid retrieval flow.',
  },
  {
    label: '🔌 External APIs & Webhooks',
    prompt: 'Show external integrations and webhook listeners: GitHub Webhook handler, HMAC verification, AI provider APIs (Gemini/OpenAI), and database connection pool.',
  },
];

const ArchitectureView = ({ repoId }) => {
  const [diagram, setDiagram] = useState(null);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [prompt, setPrompt] = useState(ARCHITECTURE_PRESETS[0].prompt);
  const [activePreset, setActivePreset] = useState(0);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef(null);

  const fetchDiagram = async (customPrompt) => {
    setLoading(true);
    setError(null);
    const p = typeof customPrompt === 'string' ? customPrompt : prompt;
    try {
      const res = await getArchitectureDiagram(repoId, p);
      setDiagram(res.data.diagram);
      setSources(res.data.sources || []);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePresetSelect = (preset, idx) => {
    setActivePreset(idx);
    setPrompt(preset.prompt);
  };

  const handleCopyCode = () => {
    if (!diagram) return;
    navigator.clipboard.writeText(diagram);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    if (!diagram || !containerRef.current) return;

    // Dynamically import mermaid to avoid SSR issues
    import('mermaid').then((m) => {
      const mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          primaryColor: '#6366f1',
          primaryTextColor: '#e2e8f0',
          primaryBorderColor: '#4f46e5',
          lineColor: '#94a3b8',
          secondaryColor: '#1e293b',
          tertiaryColor: '#0f172a',
          background: '#0f172a',
          mainBkg: '#1e293b',
          nodeBorder: '#4f46e5',
          clusterBkg: '#1e293b',
          titleColor: '#e2e8f0',
          edgeLabelBackground: '#1e293b',
        },
      });

      const id = 'arch-diagram-' + Date.now();
      containerRef.current.innerHTML = `<div class="mermaid" id="${id}">${diagram}</div>`;

      mermaid.run({ nodes: [containerRef.current.querySelector(`#${id}`)] }).catch((e) => {
        console.error('Mermaid render error:', e);
        containerRef.current.innerHTML = `<pre style="color:var(--text-muted);font-size:12px;overflow:auto">${diagram}</pre>`;
      });
    });
  }, [diagram]);

  return (
    <div className="architecture-view">
      {/* Custom Prompt Bar */}
      <div className="prompt-customizer">
        <div className="prompt-customizer-header">
          <div className="prompt-customizer-title">
            <span>🎯 Diagram Requirements</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
              Customize the prompt or choose a preset
            </span>
          </div>
          {diagram && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleCopyCode}
              title="Copy raw Mermaid code"
            >
              {copied ? '✓ Mermaid Copied' : '📋 Copy Mermaid'}
            </button>
          )}
        </div>

        <div className="preset-chips">
          {ARCHITECTURE_PRESETS.map((p, idx) => (
            <button
              key={idx}
              className={`preset-chip ${activePreset === idx ? 'active' : ''}`}
              onClick={() => handlePresetSelect(p, idx)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="prompt-input-row">
          <textarea
            className="prompt-textarea"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setActivePreset(null);
            }}
            placeholder="Describe the exact architecture diagram you want (e.g., 'Show the user checkout sequence and stripe webhook handlers')..."
            rows={2}
          />
          <button
            id="generate-arch-btn"
            className="btn btn-primary"
            onClick={() => fetchDiagram(prompt)}
            disabled={loading || !prompt.trim()}
            style={{ minWidth: 160, height: 48 }}
          >
            {loading ? (
              <><div className="loading-spinner" style={{ width: 14, height: 14 }} /> Generating...</>
            ) : diagram ? '↻ Regenerate' : '✨ Generate Diagram'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--error-bg)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-md)', color: 'var(--error)', fontSize: 14 }}>
          {error}
        </div>
      )}

      {!diagram && !loading && !error && (
        <div className="empty-state" style={{ padding: '60px 24px' }}>
          <div style={{ fontSize: 48 }}>🏗️</div>
          <h3>Generate Custom Architecture Diagram</h3>
          <p style={{ maxWidth: 520, margin: '0 auto' }}>
            Choose a preset or type your custom requirement above to generate an interactive Mermaid flowchart, sequence diagram, or ER schema for your codebase.
          </p>
        </div>
      )}

      {loading && (
        <div className="empty-state" style={{ padding: '60px 24px' }}>
          <div className="loading-dots"><span /><span /><span /></div>
          <p style={{ marginTop: 16, color: 'var(--text-muted)' }}>Analyzing codebase structure and synthesizing Mermaid diagram...</p>
        </div>
      )}

      <div ref={containerRef} className="mermaid-container" style={{ display: diagram ? 'flex' : 'none' }} />

      {sources.length > 0 && diagram && (
        <div style={{ padding: '0 8px' }}>
          <SourceCitation sources={sources} />
        </div>
      )}
    </div>
  );
};

// ─── Documentation View Component ─────────────────────────────────────────────

const DOCS_PRESETS = [
  {
    label: '📘 Full Technical Spec',
    prompt: 'Generate comprehensive technical documentation for this codebase: system overview, architecture, API reference, data models, configuration, and workflows.',
  },
  {
    label: '📡 API Reference Only',
    prompt: 'Generate an exhaustive API Reference documentation: list every endpoint, HTTP method, route parameters, request body schemas, response formats, and authentication requirements.',
  },
  {
    label: '🚀 Setup & Deployment Guide',
    prompt: 'Generate a step-by-step developer setup and deployment guide: prerequisites, environment variables (.env), database migrations/Prisma commands, running locally, and Docker deployment.',
  },
  {
    label: '🗄️ Database & Data Models',
    prompt: 'Document the database schema and data models: explain each entity, field types, relationships, indexes, and how data flows through the application.',
  },
  {
    label: '🛡️ Security & Permissions',
    prompt: 'Generate a security documentation report: authentication mechanisms, role-based access control, session management, input validation, and security recommendations.',
  },
];

const DocumentationView = ({ repoId, repoName }) => {
  const [docs, setDocs] = useState('');
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [prompt, setPrompt] = useState(DOCS_PRESETS[0].prompt);
  const [activePreset, setActivePreset] = useState(0);
  const [copied, setCopied] = useState(false);

  const fetchDocs = async (customPrompt) => {
    setLoading(true);
    setError(null);
    const p = typeof customPrompt === 'string' ? customPrompt : prompt;
    try {
      const res = await getRepositoryDocs(repoId, p);
      setDocs(res.data.documentation);
      setSources(res.data.sources || []);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Failed to generate documentation');
    } finally {
      setLoading(false);
    }
  };

  const handlePresetSelect = (preset, idx) => {
    setActivePreset(idx);
    setPrompt(preset.prompt);
  };

  const handleCopy = () => {
    if (!docs) return;
    navigator.clipboard.writeText(docs);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!docs) return;
    const blob = new Blob([docs], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${repoName || 'repository'}-DOCUMENTATION.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="docs-view">
      {/* Custom Prompt Bar */}
      <div className="prompt-customizer">
        <div className="prompt-customizer-header">
          <div className="prompt-customizer-title">
            <span>🎯 Documentation Requirements</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
              Customize the prompt or choose a preset
            </span>
          </div>
          {docs && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                id="copy-docs-btn"
                className="btn btn-ghost btn-sm"
                onClick={handleCopy}
                title="Copy markdown to clipboard"
              >
                {copied ? '✓ Copied' : '📋 Copy Markdown'}
              </button>
              <button
                id="download-docs-btn"
                className="btn btn-secondary btn-sm"
                onClick={handleDownload}
                title="Download as .md file"
              >
                📥 Download .md
              </button>
            </div>
          )}
        </div>

        <div className="preset-chips">
          {DOCS_PRESETS.map((p, idx) => (
            <button
              key={idx}
              className={`preset-chip ${activePreset === idx ? 'active' : ''}`}
              onClick={() => handlePresetSelect(p, idx)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="prompt-input-row">
          <textarea
            className="prompt-textarea"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setActivePreset(null);
            }}
            placeholder="Specify what kind of documentation to generate (e.g., 'Write an integration guide for third-party developers with sample code')..."
            rows={2}
          />
          <button
            id="generate-docs-btn"
            className="btn btn-primary"
            onClick={() => fetchDocs(prompt)}
            disabled={loading || !prompt.trim()}
            style={{ minWidth: 160, height: 48 }}
          >
            {loading ? (
              <><div className="loading-spinner" style={{ width: 14, height: 14 }} /> Generating...</>
            ) : docs ? '↻ Regenerate' : '✨ Generate Docs'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--error-bg)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-md)', color: 'var(--error)', fontSize: 14 }}>
          {error}
        </div>
      )}

      {!docs && !loading && !error && (
        <div className="empty-state" style={{ padding: '60px 24px' }}>
          <div style={{ fontSize: 48 }}>📝</div>
          <h3>Generate Custom Documentation</h3>
          <p style={{ maxWidth: 520, margin: '0 auto' }}>
            Choose a preset or type your custom requirement above to generate comprehensive technical documentation, API guides, or architecture specs from your indexed codebase.
          </p>
        </div>
      )}

      {loading && (
        <div className="empty-state" style={{ padding: '60px 24px' }}>
          <div className="loading-dots"><span /><span /><span /></div>
          <p style={{ marginTop: 16, color: 'var(--text-muted)' }}>Synthesizing custom repository documentation from codebase...</p>
        </div>
      )}

      {docs && !loading && (
        <div className="docs-content">
          <div className="docs-markdown markdown-body">
            <ReactMarkdown>
              {docs}
            </ReactMarkdown>
          </div>
          {sources.length > 0 && (
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <SourceCitation sources={sources} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};


// ─── Overview / Summary View Component ────────────────────────────────────────

const OverviewView = ({ repo, summary, loading, onRegenerate, onSwitchToChat }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!summary) return;
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="overview-container">
      {/* Quick Stats Header */}
      <div className="overview-stats-grid">
        <div className="overview-stat-card">
          <div className="stat-label">Total Files</div>
          <div className="stat-value">{repo?.totalFiles || 0}</div>
        </div>
        <div className="overview-stat-card">
          <div className="stat-label">Code Chunks</div>
          <div className="stat-value">{repo?.totalChunks || 0}</div>
        </div>
        <div className="overview-stat-card">
          <div className="stat-label">Primary Language</div>
          <div className="stat-value">{repo?.language || 'Multi-language'}</div>
        </div>
        <div className="overview-stat-card">
          <div className="stat-label">Branch & Status</div>
          <div className="stat-value" style={{ fontSize: 15 }}>
            <span className="badge badge-success">✓ {repo?.defaultBranch || 'main'}</span>
          </div>
        </div>
      </div>

      {/* Summary Content Card */}
      <div className="overview-summary-card">
        <div className="overview-header-actions">
          <div className="overview-title-group">
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📋 Repository Executive Summary</span>
            </h3>
            <span className="overview-subtitle">AI-synthesized codebase overview & architectural highlights</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleCopy}
              disabled={!summary}
              title="Copy markdown summary"
            >
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={onRegenerate}
              disabled={loading}
              title="Regenerate repository summary"
            >
              {loading ? '↻ Generating...' : '↻ Regenerate'}
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={onSwitchToChat}
            >
              💬 Open Chat
            </button>
          </div>
        </div>

        {loading ? (
          <div className="empty-state" style={{ padding: '60px 24px' }}>
            <div className="loading-dots"><span /><span /><span /></div>
            <p style={{ marginTop: 16, color: 'var(--text-muted)' }}>
              Synthesizing repository overview from indexed code and modules...
            </p>
          </div>
        ) : summary ? (
          <div className="overview-markdown markdown-body">
            <ReactMarkdown>{summary}</ReactMarkdown>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '40px 24px' }}>
            <p style={{ color: 'var(--text-muted)' }}>No summary generated yet.</p>
            <button className="btn btn-primary btn-sm" onClick={onRegenerate}>
              ✨ Generate Summary Now
            </button>
          </div>
        )}
      </div>
    </div>
  );
};


// ─── Constants ────────────────────────────────────────────────────────────────

const MODE_LABELS = {
  security: '🛡️ Security Audit',
  blast_radius: '💥 Blast Radius',
  docs: '📝 Generate Docs',
  default: '',
};

const QUICK_ACTIONS = [
  {
    mode: 'security',
    label: '🛡️ Security Audit',
    description: 'Scan for vulnerabilities, exposed secrets, and OWASP issues',
    question: 'Perform a comprehensive security audit of this codebase. Check for exposed credentials, SQL injection risks, missing auth checks, CORS issues, and any OWASP Top 10 vulnerabilities.',
    color: '#ef4444',
  },
  {
    mode: 'blast_radius',
    label: '💥 Blast Radius',
    description: 'Analyze what breaks if you change a component',
    question: 'Analyze the blast radius and dependency impact of the core service modules. What are the most critical files that, if changed, would cause the most widespread breakage?',
    color: '#f97316',
  },
];


const EXAMPLE_QUESTIONS = [
  'How does authentication work in this repo?',
  'Where is the database connection configured?',
  'Explain the main entry point of this application',
  'What are the API endpoints available?',
];

// ─── Main ChatPage ────────────────────────────────────────────────────────────

const ChatPage = ({ user }) => {
  const { repoId } = useParams();
  const navigate = useNavigate();
  const [repo, setRepo] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'overview' | 'architecture' | 'docs'
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const fetchSummary = useCallback(async (force = false) => {
    if (!repoId) return;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = force
        ? await regenerateRepositorySummary(repoId)
        : await getRepositorySummary(repoId);
      setSummary(res.data.summary);
    } catch (err) {
      setSummaryError(err.response?.data?.error?.message || err.message);
    } finally {
      setSummaryLoading(false);
    }
  }, [repoId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => { scrollToBottom(); }, [messages, typing]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [repoRes, sessionsRes] = await Promise.all([
          getRepository(repoId),
          getChatSessions(repoId),
        ]);
        setRepo(repoRes.data);
        setSessions(sessionsRes.data);

        // Instant summary: use cached summary if present, otherwise fetch on-demand if indexed
        if (repoRes.data.summary && repoRes.data.summary.trim()) {
          setSummary(repoRes.data.summary);
        } else if (repoRes.data.indexStatus === 'INDEXED') {
          fetchSummary(false);
        }
      } catch (err) {
        setError('Failed to load repository');
      }
    };
    fetchData();
  }, [repoId, fetchSummary]);

  const loadSession = useCallback(async (sessionId) => {
    try {
      setActiveSessionId(sessionId);
      const res = await getChatMessages(sessionId);
      setMessages(res.data.messages);
    } catch (err) {
      setError('Failed to load messages');
    }
  }, []);

  const handleSend = async (questionOverride, modeOverride = 'default') => {
    const q = (typeof questionOverride === 'string' ? questionOverride : question).trim();
    if (!q || loading) return;

    const userMsgId = Date.now();
    const assistantMsgId = userMsgId + 1;

    setMessages((prev) => [...prev, { role: 'USER', content: q, id: userMsgId }]);
    setQuestion('');
    setTyping(true);
    setLoading(true);
    try {
      const token = localStorage.getItem('repoassist_token');

      const response = await fetch(`${API_BASE_URL}/api/repositories/${repoId}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          question: q,
          sessionId: activeSessionId,
          mode: modeOverride,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `Server responded with status ${response.status}`);
      }

      setMessages((prev) => [
        ...prev,
        { role: 'ASSISTANT', content: '', sources: [], id: assistantMsgId, isStreaming: true, mode: modeOverride },
      ]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const part of parts) {
          if (!part.trim()) continue;
          for (const line of part.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'session' && data.sessionId) {
                  if (!activeSessionId || activeSessionId !== data.sessionId) {
                    setActiveSessionId(data.sessionId);
                    getChatSessions(repoId).then((sessRes) => setSessions(sessRes.data)).catch(() => {});
                  }
                } else if (data.type === 'sources') {
                  setTyping(false);
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMsgId
                        ? { ...msg, sources: data.sources || [] }
                        : msg
                    )
                  );
                } else if (data.type === 'token' && data.token) {
                  setTyping(false);
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMsgId
                        ? { ...msg, content: (msg.content || '') + data.token }
                        : msg
                    )
                  );
                } else if (data.type === 'done') {
                  setTyping(false);
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMsgId
                        ? { ...msg, isStreaming: false, content: data.answer || msg.content }
                        : msg
                    )
                  );
                } else if (data.type === 'error') {
                  throw new Error(data.error || 'Stream encountered an error');
                }
              } catch (parseErr) {
                // Ignore non-JSON SSE lines
              }
            }
          }
        }
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId ? { ...msg, isStreaming: false } : msg
        )
      );

    } catch (err) {
      setError(err.message || 'Failed to get answer. Please try again.');
      setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
    } finally {
      setTyping(false);
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
  };

  const handleQuickAction = (action) => {
    setActiveTab('chat');
    handleSend(action.question, action.mode);
  };

  return (
    <div className="chat-layout">
      {/* Sidebar */}
      <div className="chat-sidebar">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Chats</h3>
          <button id="new-chat-btn" className="btn btn-secondary btn-sm" onClick={handleNewChat}>
            + New
          </button>
        </div>

        <button
          id="back-to-dashboard-btn"
          className="btn btn-ghost btn-sm"
          onClick={() => navigate('/dashboard')}
          style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 16 }}
        >
          ← Dashboard
        </button>

        {/* Quick Action Buttons */}
        <div className="quick-actions-section">
          <div className="quick-actions-label">Quick Actions</div>
          <button
            id="quick-action-overview"
            className="quick-action-btn"
            onClick={() => setActiveTab('overview')}
            title="View executive summary and codebase highlights"
            style={{ '--action-color': '#3b82f6' }}
          >
            <span>📋 Overview</span>
            <span className="quick-action-desc">Executive summary & stack overview</span>
          </button>
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.mode}
              id={`quick-action-${action.mode}`}
              className="quick-action-btn"
              onClick={() => handleQuickAction(action)}
              disabled={loading}
              title={action.description}
              style={{ '--action-color': action.color }}
            >
              <span>{action.label}</span>
              <span className="quick-action-desc">{action.description}</span>
            </button>
          ))}
          <button
            id="quick-action-docs"
            className="quick-action-btn"
            onClick={() => setActiveTab('docs')}
            title="Auto-generate and download technical documentation"
            style={{ '--action-color': '#22c55e' }}
          >
            <span>📝 Documentation</span>
            <span className="quick-action-desc">Generate and export codebase docs</span>
          </button>
          <button
            id="quick-action-architecture"
            className="quick-action-btn"
            onClick={() => setActiveTab('architecture')}
            title="View interactive architecture diagram"
            style={{ '--action-color': '#6366f1' }}
          >
            <span>🏗️ Architecture</span>
            <span className="quick-action-desc">View interactive codebase diagram</span>
          </button>
        </div>

        <div className="sidebar-divider" />

        {sessions.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
            No chats yet
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`session-item ${activeSessionId === session.id ? 'active' : ''}`}
              onClick={() => { setActiveTab('chat'); loadSession(session.id); }}
              id={`session-${session.id}`}
            >
              {session.title || 'Untitled chat'}
            </div>
          ))
        )}
      </div>

      {/* Main area */}
      <div className="chat-main">
        <div className="chat-header">
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'var(--accent-gradient)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, flexShrink: 0,
          }}>
            💻
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0 }}>{repo?.name || 'Loading...'}</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              {repo?.indexStatus === 'INDEXED'
                ? `${repo.totalFiles} files · ${repo.totalChunks} chunks · Hybrid RAG (Dense + BM25)`
                : repo?.indexStatus}
            </p>
          </div>
          {/* Tab switcher */}
          <div className="chat-tabs">
            <button
              className={`chat-tab ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
              id="tab-chat"
            >
              💬 Chat
            </button>
            <button
              className={`chat-tab ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
              id="tab-overview"
            >
              📋 Overview
            </button>
            <button
              className={`chat-tab ${activeTab === 'architecture' ? 'active' : ''}`}
              onClick={() => setActiveTab('architecture')}
              id="tab-architecture"
            >
              🏗️ Architecture
            </button>
            <button
              className={`chat-tab ${activeTab === 'docs' ? 'active' : ''}`}
              onClick={() => setActiveTab('docs')}
              id="tab-docs"
            >
              📑 Documentation
            </button>
          </div>
        </div>

        {/* Tab content */}
        {activeTab === 'overview' ? (
          <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
            <OverviewView
              repo={repo}
              summary={summary}
              loading={summaryLoading}
              onRegenerate={() => fetchSummary(true)}
              onSwitchToChat={() => setActiveTab('chat')}
            />
          </div>
        ) : activeTab === 'architecture' ? (
          <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
            <ArchitectureView repoId={repoId} />
          </div>
        ) : activeTab === 'docs' ? (
          <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
            <DocumentationView repoId={repoId} repoName={repo?.name} />
          </div>
        ) : (
          <>
            <div className="messages-area">

              {messages.length === 0 ? (
                <div className="empty-state" style={{ padding: '30px 24px', maxWidth: 860, margin: '0 auto' }}>
                  {/* Instant Repository Summary Card */}
                  {summaryLoading ? (
                    <div className="repo-summary-banner" style={{ textAlign: 'center', padding: '24px 20px' }}>
                      <div className="loading-dots"><span /><span /><span /></div>
                      <p style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 13 }}>
                        Synthesizing repository executive summary...
                      </p>
                    </div>
                  ) : summary ? (
                    <div className="repo-summary-banner">
                      <div className="repo-summary-banner-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 18 }}>⚡</span>
                          <span style={{ fontWeight: 600, fontSize: 15, color: '#fff' }}>Repository Summary</span>
                          <span className="badge badge-primary" style={{ fontSize: 11, padding: '2px 8px' }}>Auto-Synthesized</span>
                        </div>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => setActiveTab('overview')}
                          style={{ color: 'var(--accent)', fontSize: 13, textDecoration: 'none' }}
                        >
                          View Full Overview ↗
                        </button>
                      </div>
                      <div className="repo-summary-banner-body markdown-body">
                        <ReactMarkdown>{summary}</ReactMarkdown>
                      </div>
                    </div>
                  ) : null}

                  <div style={{ fontSize: 44, marginTop: summary ? 8 : 0 }}>🔍</div>
                  <h3>Ask about your codebase</h3>
                  <p>Ask questions in natural language. RepoAssist searches indexed code with hybrid vector + BM25 retrieval and streams answers with citations.</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 480 }}>
                    {EXAMPLE_QUESTIONS.map((q) => (
                      <button
                        key={q}
                        className="btn btn-secondary btn-sm"
                        style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                        onClick={() => { setQuestion(q); textareaRef.current?.focus(); }}
                      >
                        <span style={{ color: 'var(--accent)' }}>→</span> {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg) => <Message key={msg.id || msg.createdAt} msg={msg} />)
              )}

              {typing && <TypingIndicator />}

              {error && (
                <div style={{ padding: '12px 16px', background: 'var(--error-bg)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-md)', color: 'var(--error)', fontSize: 14 }}>
                  {error}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="chat-input-area">
              <div className="chat-input-wrap">
                <textarea
                  ref={textareaRef}
                  id="chat-input"
                  className="chat-textarea"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Ask about ${repo?.name || 'your repository'}...`}
                  rows={1}
                  disabled={loading}
                />
                <button
                  id="send-message-btn"
                  className="send-btn"
                  onClick={handleSend}
                  disabled={!question.trim() || loading}
                >
                  {loading ? (
                    <div className="loading-spinner" style={{ width: 18, height: 18, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white' }} />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  )}
                </button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
                Press Enter to send · Shift+Enter for new line · Use Quick Actions for specialized analysis
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ChatPage;

"""
LangChain RAG pipeline using:
  - Hybrid Retrieval: PGVector dense search + BM25 keyword search fused via RRF
  - Cross-encoder reranking (Reciprocal Rank Fusion)
  - ChatGoogleGenerativeAI (Gemini 3.5 Flash Lite)
  - create_stuff_documents_chain with ChatPromptTemplate and chat history
  - Architecture diagram generation
  - Security / Blast Radius / Documentation specialized prompts
"""

import os
import json
import asyncio
from typing import AsyncGenerator, Optional
from functools import lru_cache
from dotenv import load_dotenv

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain.chains.combine_documents import create_stuff_documents_chain
from langchain_community.retrievers import BM25Retriever
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.documents import Document

from services.vectorstore import get_retriever, get_all_documents
from services.reranker import reciprocal_rank_fusion

load_dotenv()

# ─── Lazy LLM ─────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_llm() -> ChatGoogleGenerativeAI:
    """Lazy singleton — created on first request after .env is loaded."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set in environment")
    return ChatGoogleGenerativeAI(
        model="gemini-3.5-flash-lite",
        google_api_key=api_key,
        temperature=0.2,
        max_tokens=2048,
    )

# ─── System Prompts ───────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are RepoGPT, an expert AI assistant that answers questions about codebases.

Rules:
1. Answer ONLY using the provided code context. Do not invent implementation details not present in the context.
2. When referencing code, cite the specific file and line numbers.
3. If the context does not contain enough information, say: "I could not find relevant code for this question in the indexed repository."
4. Use code blocks with language syntax when showing code snippets.
5. Be concise but complete. Explain HOW the code works, not just WHAT it does.
6. If multiple files are involved, explain their relationships.

Context:
{context}"""

SECURITY_AUDIT_PROMPT = """You are a senior security engineer performing a code security audit on a GitHub repository.

Analyze the provided code context for:
1. 🔴 CRITICAL: Exposed secrets, hardcoded credentials, API keys in source code
2. 🔴 CRITICAL: SQL injection, command injection, path traversal vulnerabilities
3. 🟠 HIGH: Missing authentication/authorization checks on sensitive routes
4. 🟠 HIGH: Improper input validation and sanitization
5. 🟡 MEDIUM: Insecure HTTP usage, missing HTTPS enforcement
6. 🟡 MEDIUM: CORS misconfiguration, overly permissive origins
7. 🟢 LOW: Outdated dependency patterns, verbose error messages exposing internals

Format your response as:
- A severity-grouped list with file:line citations
- A brief remediation suggestion for each finding
- An overall security score (1–10)

Context:
{context}"""

BLAST_RADIUS_PROMPT = """You are a senior software engineer performing impact analysis on a codebase.

Based on the code context, analyze:
1. What modules, services, or functions directly depend on the changed component
2. Which API endpoints, database models, or configuration values are affected
3. What tests would need to be updated
4. Estimate the blast radius: LOW / MEDIUM / HIGH / CRITICAL

Format your response as:
- **Directly Affected Files** (with line citations)
- **Indirectly Affected Components**
- **Recommended Actions Before Merging**
- **Blast Radius Assessment**: LOW / MEDIUM / HIGH / CRITICAL

Context:
{context}"""

ARCHITECTURE_PROMPT = """You are a senior software architect analyzing a codebase.

Based on the code context below, generate a detailed Mermaid flowchart diagram showing:
1. API routes → controllers → services → database models
2. Key data flows (authentication, indexing pipeline, chat pipeline)
3. External integrations (GitHub API, AI providers, databases)

IMPORTANT: Output ONLY valid Mermaid syntax starting with `graph TD` or `graph LR`.
Do not include markdown fences, explanation text, or anything outside the Mermaid code.
Use short, readable node labels. Quote labels with spaces or special characters.

Context:
{context}"""

DOCS_PROMPT = """You are a senior technical writer generating system documentation for a software project.

Based on the code context, produce comprehensive technical documentation including:
1. **System Overview** — What this system does and its key capabilities
2. **Architecture** — Major components and how they interact
3. **API Reference** — List of endpoints with method, path, auth requirement, and parameters
4. **Data Models** — Key entities and their fields
5. **Setup & Configuration** — Environment variables and dependencies required
6. **Key Workflows** — Step-by-step description of the main user flows

Be thorough and developer-friendly. Use proper markdown headers and code blocks.

Context:
{context}"""

SUMMARY_PROMPT = """You are a senior software architect providing an executive, developer-friendly summary of a code repository.

Based on the code context provided, produce a structured Markdown repository summary with the following sections:

## 📌 Project Overview
A crisp 2-3 sentence description of what this project does, who it is for, and its primary purpose.

## ⚡ Core Capabilities & Highlights
- Bullet points highlighting the main functional capabilities, user workflows, and features implemented in this codebase.

## 🛠️ Tech Stack & Architecture
- **Languages & Frameworks**: Core runtime, frameworks, key libraries.
- **Data & Storage**: Database engines, ORM/schema, state/caching.
- **Architecture Style**: Design patterns observed (e.g., MVC, Microservices, RAG pipeline, REST API).

## 📂 Key Modules & Entry Points
- Important directories and files (e.g. entry points, controllers, core services, models) and a one-line explanation of their roles.

Keep the summary clear, well-formatted with markdown, and grounded strictly in the provided code context.

Context:
{context}"""


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _build_chat_history(history: list[dict]) -> list:
    """Convert Node.js chat history format to LangChain message objects."""
    messages = []
    for msg in history[-6:]:  # Last 3 turns
        if msg["role"] == "USER":
            messages.append(HumanMessage(content=msg["content"]))
        else:
            messages.append(AIMessage(content=msg["content"]))
    return messages


def _docs_to_sources(docs: list[Document]) -> list[dict]:
    """Extract source citation dicts from retrieved Documents."""
    sources = []
    seen = set()
    for doc in docs:
        meta = doc.metadata
        key = (meta.get("file_path"), meta.get("start_line"))
        if key in seen:
            continue
        seen.add(key)
        sources.append({
            "file_path": meta.get("file_path", ""),
            "symbol_name": meta.get("symbol_name"),
            "symbol_type": meta.get("symbol_type"),
            "start_line": meta.get("start_line", 0),
            "end_line": meta.get("end_line", 0),
            "language": meta.get("language", ""),
            "score": meta.get("relevance_score"),
        })
    return sources


def _get_system_prompt(mode: str) -> str:
    """Return the right system prompt based on the action mode."""
    return {
        "security": SECURITY_AUDIT_PROMPT,
        "blast_radius": BLAST_RADIUS_PROMPT,
        "architecture": ARCHITECTURE_PROMPT,
        "docs": DOCS_PROMPT,
    }.get(mode, SYSTEM_PROMPT)


# ─── Hybrid Retrieval ─────────────────────────────────────────────────────────

async def _hybrid_retrieve(question: str, repository_id: int, k: int = 5) -> list[Document]:
    """
    Hybrid retrieval using Dense Vector + BM25 Keyword search fused via RRF.

    Strategy:
    1. Dense retrieval via PGVector cosine similarity (semantic understanding)
    2. Load all corpus docs & run BM25 (exact keyword/symbol matching)
    3. Fuse both ranked lists with Reciprocal Rank Fusion (RRF)
    4. Return top-k de-duplicated, fused documents

    BM25 is especially valuable for: exact function names, variable names,
    error codes, file paths, and environment variable keys.
    """
    vector_retriever = get_retriever(repository_id, k=k * 2)

    # 1. Run dense retrieval asynchronously
    dense_docs = await asyncio.to_thread(vector_retriever.invoke, question)

    if not dense_docs:
        return []

    # 2. Build BM25 retriever from the same corpus (load up to 2000 chunks)
    all_docs = await asyncio.to_thread(get_all_documents, repository_id)
    bm25_docs: list[Document] = []

    if all_docs:
        try:
            bm25_retriever = BM25Retriever.from_documents(all_docs, k=k * 2)
            bm25_docs = await asyncio.to_thread(bm25_retriever.invoke, question)
        except Exception:
            # BM25 is best-effort — fall back to dense-only if it fails
            bm25_docs = []

    # 3. Fuse both ranked lists with RRF
    fused = reciprocal_rank_fusion([dense_docs, bm25_docs], top_k=k)
    return fused


# ─── RAG Pipeline ─────────────────────────────────────────────────────────────

async def rag_query(
    question: str,
    repository_id: int,
    chat_history: list[dict] = [],
    mode: str = "default",
) -> dict:
    """
    Full hybrid RAG pipeline:
    1. Hybrid retrieval (Dense + BM25 fused via RRF)
    2. Build prompt with system instructions + chat history
    3. Run LangChain create_stuff_documents_chain with Gemini
    4. Return answer + source citations
    """
    # ── 1. Hybrid retrieval ────────────────────────────────────────────────────
    context_docs = await _hybrid_retrieve(question, repository_id, k=5)

    if not context_docs:
        return {
            "answer": (
                "I could not find relevant code for this question in the indexed repository. "
                "Try rephrasing your question or ensure the repository has been indexed."
            ),
            "sources": [],
        }

    # ── 2. Build prompt ────────────────────────────────────────────────────────
    system_prompt = _get_system_prompt(mode)
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        MessagesPlaceholder(variable_name="chat_history"),
        ("human", "{input}"),
    ])

    # ── 3. Run Gemini with relevant context ───────────────────────────────────
    question_answer_chain = create_stuff_documents_chain(get_llm(), prompt)
    lc_history = _build_chat_history(chat_history)

    answer = await asyncio.to_thread(
        question_answer_chain.invoke,
        {
            "input": question,
            "chat_history": lc_history,
            "context": context_docs,
        },
    )

    return {
        "answer": answer,
        "sources": _docs_to_sources(context_docs),
    }


async def rag_stream(
    question: str,
    repository_id: int,
    chat_history: list[dict] = [],
    mode: str = "default",
) -> AsyncGenerator[str, None]:
    """
    Streaming RAG pipeline that yields Server-Sent Events (SSE) data lines:
    1. {"type": "sources", "sources": [...]}
    2. {"type": "token", "token": "..."}
    3. {"type": "done", "answer": "..."}
    """
    # ── 1. Hybrid retrieval ────────────────────────────────────────────────────
    context_docs = await _hybrid_retrieve(question, repository_id, k=5)

    if not context_docs:
        empty_answer = (
            "I could not find relevant code for this question in the indexed repository. "
            "Try rephrasing your question or ensure the repository has been indexed."
        )
        yield f"data: {json.dumps({'type': 'sources', 'sources': []})}\\n\\n"
        yield f"data: {json.dumps({'type': 'token', 'token': empty_answer})}\\n\\n"
        yield f"data: {json.dumps({'type': 'done', 'answer': empty_answer})}\\n\\n"
        return

    # ── 2. Send sources immediately so the frontend displays them right away ──
    sources = _docs_to_sources(context_docs)
    yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\\n\\n"

    # ── 3. Build prompt and chain ─────────────────────────────────────────────
    system_prompt = _get_system_prompt(mode)
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        MessagesPlaceholder(variable_name="chat_history"),
        ("human", "{input}"),
    ])
    question_answer_chain = create_stuff_documents_chain(get_llm(), prompt)
    lc_history = _build_chat_history(chat_history)

    full_answer_parts = []

    # ── 4. Stream tokens in real-time as Gemini generates them ───────────────
    async for chunk in question_answer_chain.astream({
        "input": question,
        "chat_history": lc_history,
        "context": context_docs,
    }):
        if chunk:
            full_answer_parts.append(chunk)
            yield f"data: {json.dumps({'type': 'token', 'token': chunk})}\\n\\n"

    # ── 5. Send done event with complete answer ───────────────────────────────
    full_answer = "".join(full_answer_parts)
    yield f"data: {json.dumps({'type': 'done', 'answer': full_answer})}\\n\\n"


# ─── Architecture Diagram ──────────────────────────────────────────────────────

async def generate_architecture_diagram(
    repository_id: int,
    custom_prompt: Optional[str] = None,
) -> dict:
    """
    Generate a Mermaid architecture diagram for a repository.
    Uses hybrid retrieval with either a custom requirement or default architecture prompt.
    """
    default_question = (
        "Show me the complete architecture: API routes, controllers, services, "
        "database models, authentication flow, and external integrations."
    )
    architecture_question = custom_prompt.strip() if custom_prompt and custom_prompt.strip() else default_question
    context_docs = await _hybrid_retrieve(architecture_question, repository_id, k=10)

    if not context_docs:
        return {
            "diagram": "graph TD\n  A[No indexed code found] --> B[Please index the repository first]",
            "sources": [],
        }

    if custom_prompt and custom_prompt.strip():
        system_instruction = f"""You are a senior software architect creating a Mermaid diagram for a codebase based on the user's specific request.

USER REQUIREMENTS:
{custom_prompt}

IMPORTANT MERMAID RULES:
1. Output ONLY valid Mermaid syntax (e.g. starting with `graph TD`, `graph LR`, `sequenceDiagram`, `classDiagram`, `erDiagram`, or `flowchart TD`).
2. Do not include markdown fences (```mermaid), explanations, or text outside the diagram code.
3. Use short, readable node labels. Always quote labels with special characters or spaces (e.g. id["Label (Extra)"]).
4. Ensure all node IDs and connections are syntactically valid in Mermaid.js.

Context:
{{context}}"""
    else:
        system_instruction = ARCHITECTURE_PROMPT

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_instruction),
        ("human", "{input}"),
    ])

    chain = create_stuff_documents_chain(get_llm(), prompt)

    diagram = await asyncio.to_thread(
        chain.invoke,
        {
            "input": architecture_question,
            "context": context_docs,
        },
    )

    return {
        "diagram": diagram.strip(),
        "sources": _docs_to_sources(context_docs),
    }


# ─── Documentation Generator ──────────────────────────────────────────────────

async def generate_documentation(
    repository_id: int,
    custom_prompt: Optional[str] = None,
) -> dict:
    """
    Generate comprehensive technical documentation for a repository.
    Uses broad hybrid retrieval based on user's custom requirements or full system overview.
    """
    default_question = (
        "Generate comprehensive technical documentation for this codebase: "
        "system overview, architecture, API reference, data models, configuration, and workflows."
    )
    docs_question = custom_prompt.strip() if custom_prompt and custom_prompt.strip() else default_question
    context_docs = await _hybrid_retrieve(docs_question, repository_id, k=12)

    if not context_docs:
        return {
            "documentation": "# Documentation\n\nNo indexed code found for this repository. Please index the repository first.",
            "sources": [],
        }

    if custom_prompt and custom_prompt.strip():
        system_instruction = f"""You are a senior technical writer generating customized technical documentation for a software project based on the user's specific request.

USER REQUIREMENTS:
{custom_prompt}

GENERAL GUIDELINES:
1. Ground all explanations in the provided code context. Do not fabricate implementation details.
2. Structure your response with clear markdown headings, bullet points, and code examples.
3. Include relevant file paths, function signatures, and configuration keys where applicable.

Context:
{{context}}"""
    else:
        system_instruction = DOCS_PROMPT

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_instruction),
        ("human", "{input}"),
    ])

    chain = create_stuff_documents_chain(get_llm(), prompt)

    documentation = await asyncio.to_thread(
        chain.invoke,
        {
            "input": docs_question,
            "context": context_docs,
        },
    )

    return {
        "documentation": documentation.strip(),
        "sources": _docs_to_sources(context_docs),
    }


# ─── Repository Summary Generator ─────────────────────────────────────────────

async def generate_repository_summary(repository_id: int) -> dict:
    """
    Generate a high-level executive summary of the repository for instant viewing.
    Synthesizes project overview, tech stack, and key modules from indexed chunks.
    """
    summary_question = (
        "Project overview, main entry points, architecture, core services, "
        "frameworks, data models, routes, and key capabilities."
    )
    context_docs = await _hybrid_retrieve(summary_question, repository_id, k=12)

    if not context_docs:
        return {
            "summary": "### 📌 Repository Overview\n\nNo indexed code found for this repository yet. Please ensure indexing finishes successfully.",
            "sources": [],
        }

    prompt = ChatPromptTemplate.from_messages([
        ("system", SUMMARY_PROMPT),
        ("human", "{input}"),
    ])

    chain = create_stuff_documents_chain(get_llm(), prompt)

    summary_text = await asyncio.to_thread(
        chain.invoke,
        {
            "input": summary_question,
            "context": context_docs,
        },
    )

    return {
        "summary": summary_text.strip(),
        "sources": _docs_to_sources(context_docs),
    }




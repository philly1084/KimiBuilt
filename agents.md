# KimiBuilt — AI Agent Platform

## Project Overview

KimiBuilt is a multi-interface AI backend that provides **four distinct ways** to interact with the same underlying AI engine:

| Mode | Description | Endpoint | Transport |
|------|-------------|----------|-----------|
| **CLI** | Terminal-based chat | `POST /api/chat` | HTTP (SSE) |
| **Web Chat** | Browser-based conversational UI | `POST /api/chat` + `/ws` | HTTP (SSE) / WebSocket |
| **Canvas** | Structured content editor (code, docs, diagrams) | `POST /api/canvas` | HTTP / WebSocket |
| **Notation Helper** | Shorthand notation processor (expand/explain/validate) | `POST /api/notation` | HTTP / WebSocket |

### Architecture

```
Clients (CLI / Web Chat / Canvas / Notation)
            │
     ┌──────▼──────┐
     │  Express +   │  REST (SSE) + WebSocket
     │  Backend API │  Port 3000
     └──┬────┬────┬─┘
        │    │    │
   ┌────▼┐ ┌─▼────▼───┐
   │OpenAI│ │  Memory   │
   │ Resp │ │  Service  │
   │ API  │ └──┬─────┬──┘
   └──────┘    │     │
         ┌─────▼┐ ┌──▼─────┐
         │Ollama│ │ Qdrant │
         │embed │ │ Vector │
         └──────┘ └────────┘
```

### Stack

- **Runtime:** Node.js 20 + Express
- **AI Generation:** OpenAI Response API (configurable base URL)
- **Embeddings:** Ollama with `nomic-embed-text:latest` (768-dim vectors)
- **Vector DB:** Qdrant for contextual memory / RAG
- **Deployment:** ARM64 k3s cluster with Traefik ingress

## Research Defaults

- For routine public web research, start with Perplexity-backed `web-search`
- Keep user intake minimal; unless the user explicitly constrains the source list, the agent should choose candidate sites and domains itself
- Verify selected pages with `web-fetch` first; use `web-scrape` only for explicit extraction requests, JS-rendered pages, or structured field capture

---

## Build and Test Commands

```bash
# Install dependencies
npm install

# Development (auto-reload)
npm run dev

# Production
npm start

# Tests
npm test                  # Run all tests with coverage
npm run test:watch        # Watch mode

# Docker (ARM64)
npm run docker:build      # Build image for linux/arm64
npm run docker:push       # Build and push

# Docker Compose (local dev with Qdrant + Ollama)
docker compose up -d      # Start all services
docker compose logs -f    # Follow logs
docker compose down       # Stop all services

# k3s Deployment
kubectl apply -f k8s/     # Deploy to cluster
kubectl delete -f k8s/    # Remove from cluster
```

---

## Code Style Guidelines

- **Language:** JavaScript (CommonJS modules)
- **Formatting:** 2-space indentation, single quotes, trailing commas
- **Naming:**
  - Files: `kebab-case.js`
  - Functions/variables: `camelCase`
  - Classes: `PascalCase`
  - Constants: `UPPER_SNAKE_CASE`
- **Error handling:** Always use try/catch in async routes, pass errors to `next(err)`
- **Logging:** Use `console.log/warn/error` with `[Module]` prefix tags
- **No external linter config yet** — add ESLint if you want stricter enforcement

---

## Testing Instructions

### Unit Tests

Tests live in `__tests__/` directories alongside the code they test. Use Jest:

```bash
npm test
```

**What to test:**
- `session-store.js` — CRUD operations, `recordResponse()` updates
- `memory/embedder.js` — Mock Ollama fetch, verify embedding calls
- `memory/vector-store.js` — Mock Qdrant client, verify store/search/delete
- `memory/memory-service.js` — Integration of embed + store + recall
- `routes/*.js` — Use `supertest` to test each route handler
- `middleware/validate.js` — Schema validation edge cases

### Integration Tests

Requires running Qdrant + Ollama (use `docker compose up qdrant ollama`):

```bash
# Set env vars for local services
QDRANT_URL=http://localhost:6333 \
OLLAMA_BASE_URL=http://localhost:11434 \
npm test -- --testPathPattern=integration
```

### Manual Testing

```bash
# Health check
curl http://localhost:3000/health

# Chat (streamed)
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, who are you?"}'

# Canvas (code generation)
curl -X POST http://localhost:3000/api/canvas \
  -H "Content-Type: application/json" \
  -d '{"message": "Write a Python Fibonacci function", "canvasType": "code"}'

# Notation (expand mode)
curl -X POST http://localhost:3000/api/notation \
  -H "Content-Type: application/json" \
  -d '{"notation": "user -> auth -> dashboard", "helperMode": "expand"}'

# WebSocket (use wscat)
npx wscat -c ws://localhost:3000/ws
> {"type":"chat","payload":{"message":"Hello via WebSocket"}}
```

---

## Security Considerations

### API Key Management
- **Never commit `.env` files** — `.gitignore` excludes them
- In k3s, the OpenAI API key lives in a Kubernetes Secret (`k8s/secret.yaml`)
- Rotate keys regularly; the backend reads from env vars on each request

### Network Security
- **Helmet.js** sets security headers (XSS protection, HSTS, etc.)
- **CORS** is enabled — restrict `origin` in production
- Qdrant and Ollama use **ClusterIP** services (not exposed externally)
- Only the backend is exposed via Traefik Ingress

### Input Validation
- All routes validate request bodies via `middleware/validate.js`
- JSON body size is limited to 10MB (`express.json({ limit: '10mb' })`)

### Container Security
- Backend runs as **non-root** user (`kimibuilt:1001`)
- Multi-stage Docker build minimizes attack surface
- Production image contains only runtime dependencies

### Future Considerations
- [ ] Add API key authentication for the backend endpoints
- [ ] Rate limiting per client/session
- [ ] TLS termination at Traefik (cert-manager)
- [ ] Qdrant authentication (API key)
- [ ] Audit logging for all API calls

---

## Remote Server Operating Notes

The common remote operations target for this project is an Ubuntu Linux ARM64 server running k3s.

When agents are using SSH or remote command tools:
- Prefer `k3s-deploy` for standard deploy operations: repo sync, manifest apply, image update, and rollout checks.
- Prefer `remote-command` for kubectl inspection, logs, service status, network checks, package installs, one-off fixes, and post-deploy verification.
- Start with a short baseline command when reconnecting:

```bash
hostname && whoami && uname -m && (test -f /etc/os-release && sed -n '1,6p' /etc/os-release || true) && uptime
```

- Assume `kubectl` should point at k3s. If cluster access is unclear, prefer `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml` or `k3s kubectl`.
- On the host, do not assume `rg`, `docker-compose`, `ifconfig`, or `netstat` exist. Prefer `find` and `grep -R`, `docker compose`, `ip addr`, and `ss -tulpn`.
- For k3s triage, use a get -> describe -> logs -> rollout -> systemd/journal flow:
  - `kubectl get pods -A -o wide`
  - `kubectl describe ...`
  - `kubectl logs ... --previous`
  - `kubectl rollout status ...`
  - `systemctl status k3s` / `journalctl -u k3s --no-pager -n 200`
- Keep remote command batches small and purposeful: baseline -> inspect -> fix -> verify.
- Avoid interactive commands and editors unless the user explicitly asks for that style of access.
- See `src/agent-sdk/tool-docs/remote-command.md` for the reusable command catalog.

---

## Frontend Specifications

Below are the specifications for each of the four frontend interaction modes. These share the same backend but present different UX paradigms.

---

### 1. CLI Client

**Purpose:** Terminal-based chat for developers and power users.

**Proposed Tech:** Node.js CLI using `readline` or `commander` + `node-fetch` for SSE streaming.

**Features to build:**
- Interactive REPL with streaming response display
- Session persistence (store session ID locally in `~/.kimibuilt/session`)
- Command support: `/new` (new session), `/mode canvas|notation` (switch modes), `/history`, `/clear`
- Markdown rendering in terminal (via `marked-terminal`)
- Pipe support: `echo "explain this" | kimi`
- Config file for default model, base URL, etc.

**API Usage:**
- `POST /api/chat` with `stream: true` — parse SSE events
- `POST /api/canvas` — display structured JSON
- `POST /api/notation` — display annotated results

---

### 2. Web Chat UI

**Purpose:** Browser-based conversational interface, similar to ChatGPT.

**Proposed Tech:** Vanilla HTML/CSS/JS or lightweight framework (Lit, Preact).

**Features to build:**
- Message thread with user/assistant bubbles
- Real-time streaming via WebSocket (`/ws`)
- Session sidebar (create, switch, delete sessions)
- Markdown rendering with syntax highlighting (Prism.js or Highlight.js)
- Dark/light theme toggle
- Message input with keyboard shortcuts (Shift+Enter for newline, Enter to send)
- Connection status indicator (WS connected/disconnected)
- Mobile responsive layout

**API Usage:**
- WebSocket at `ws://host:3000/ws` — send `{ type: "chat", payload: { message } }`
- `GET /api/sessions` — populate sidebar
- `DELETE /api/sessions/:id` — delete session

---

### 3. Canvas UI

**Purpose:** Side-by-side editor + AI assistant for structured content creation.

**Proposed Tech:** HTML/CSS/JS with a code editor component (CodeMirror or Monaco).

**Features to build:**
- Split-pane layout: prompt panel (left) + canvas/editor (right)
- Canvas type selector: Code / Document / Diagram
- For **Code:** Syntax-highlighted editor with language detection
- For **Document:** Rich markdown preview
- For **Diagram:** Mermaid.js rendering
- AI suggestions panel below the canvas
- "Apply" button to update canvas with AI output
- Version history / undo stack for canvas content
- Export: copy to clipboard, download as file

**API Usage:**
- `POST /api/canvas` with `{ message, canvasType, existingContent }`
- Response: `{ content, metadata, suggestions }`

---

### 4. Notation Helper UI

**Purpose:** Shorthand notation → full output with annotations and suggestions.

**Proposed Tech:** HTML/CSS/JS with a dual-pane layout.

**Features to build:**
- Input pane: notation editor with syntax hints
- Output pane: rendered result with inline annotations
- Mode selector: Expand / Explain / Validate
- Annotation sidebar: clickable notes linked to output sections
- Suggestions panel with one-click apply
- Notation templates / examples library
- Optional context input field (extra information for the AI)
- History of notation → result pairs

**API Usage:**
- `POST /api/notation` with `{ notation, helperMode, context }`
- Response: `{ result, annotations[], suggestions[] }`

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | *(required)* | OpenAI API key |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Base URL (custom endpoint support) |
| `OPENAI_MODEL` | `gpt-4o` | Model for generation |
| `OLLAMA_BASE_URL` | `http://ollama:11434` | Ollama service URL |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text:latest` | Embedding model |
| `QDRANT_URL` | `http://qdrant:6333` | Qdrant service URL |
| `QDRANT_COLLECTION` | `conversations` | Vector collection name |
| `DOCKER_HOST` | *(optional)* | Docker daemon endpoint for `docker-exec` / `code-sandbox` when the backend is containerized or using a remote daemon |
| `PORT` | `3000` | Backend server port |
| `NODE_ENV` | `development` | Environment mode |

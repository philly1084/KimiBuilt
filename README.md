# KimiBuilt

Multi-interface AI backend with contextual memory. Four ways to interact with the same AI engine: CLI, Web Chat, Canvas, and Notation Helper.

## Quick Start

```bash
# 1. Clone and install
npm install

# 2. Configure
cp .env.example .env
# Edit .env with your OPENAI_API_KEY

# 3. Start dependencies (Qdrant + Ollama)
docker compose up -d qdrant ollama

# 4. Run the backend
npm run dev
```

The server will be available at `http://localhost:3000`. Check health at `/health`.

## Deploy to k3s

```bash
# Update the secret with your API key
echo -n 'sk-your-key' | base64
# Paste into k8s/secret.yaml

# Deploy
kubectl apply -f k8s/
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (server + Qdrant + Ollama) |
| `/api/chat` | POST | Chat with SSE streaming |
| `/api/canvas` | POST | Structured content generation |
| `/api/notation` | POST | Notation helper (expand/explain/validate) |
| `/api/sessions` | CRUD | Session management |
| `/ws` | WS | WebSocket for all modes |

See [agents.md](agents.md) for full documentation.

## License

MIT

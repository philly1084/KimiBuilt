# End-to-End Flow Review

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: FRONTENDS                                                                          │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ • CLI (Node.js)                                                                             │
│ • Web Chat (Browser)                                                                        │
│ • Canvas (Browser)                                                                          │
│ • Notes (Browser)                                                                           │
│                                                                                             │
│ Config: http://kimibuilt.local/v1 (or localhost:3000/v1 for local dev)                      │
│ Protocol: OpenAI SDK over HTTP/SSE                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           │ OpenAI SDK (HTTP/SSE)
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: KIMIBUILT BACKEND                                                                  │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ Express Server (Node.js) - Port 3000                                                        │
│                                                                                             │
│ Endpoints:                                                                                  │
│ • GET  /v1/models              → Returns available models                                   │
│ • POST /v1/chat/completions    → Chat with session/memory management                       │
│ • POST /v1/responses           → Responses API with session/memory                         │
│ • POST /v1/images/generations  → Image generation                                          │
│                                                                                             │
│ PLUS custom endpoints (for non-OpenAI features):                                            │
│ • /api/sessions, /api/health, /api/chat, etc.                                               │
│                                                                                             │
│ Services:                                                                                   │
│ • Session Store (in-memory)                                                                 │
│ • Memory Service (Qdrant + Ollama)                                                          │
│ • OpenAI Client (connects to n8n gateway)                                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           │ OpenAI SDK (HTTP)
                                           │ Config from ConfigMap/Secret
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: N8N OPENAI CLI GATEWAY                                                             │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ Fastify Server - Port 80/8080                                                               │
│ Namespace: n8n-openai-gateway                                                               │
│                                                                                             │
│ Endpoints:                                                                                  │
│ • GET  /v1/models                                                                            │
│ • POST /v1/chat/completions                                                                  │
│ • POST /v1/responses                                                                         │
│ • POST /v1/images/generations                                                                │
│ • GET  /healthz                                                                              │
│                                                                                             │
│ Auth: Authorization: Bearer <N8N_API_KEY>                                                   │
│                                                                                             │
│ Providers (configured in providers.yaml):                                                   │
│ • opencode → Gemini CLI                                                                     │
│ • codex → OpenAI Codex CLI                                                                  │
│ • antigravity → Antigravity CLI                                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           │ CLI Execution
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ LAYER 4: AI PROVIDERS                                                                       │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ • OpenAI Codex (openai.com)                                                                 │
│ • Gemini (google.com)                                                                       │
│ • Antigravity                                                                               │
│ • Ollama (local)                                                                            │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Configuration Requirements

### 1. Frontend Configuration

Each frontend needs the KimiBuilt backend URL:

| Frontend | Config Location | Default URL |
|----------|-----------------|-------------|
| CLI | `lib/config.js` | `http://localhost:3000/v1` |
| Web Chat | `js/api.js` | `http://kimibuilt.local/v1` |
| Canvas | `js/api.js` | `http://localhost:3000/v1` |
| Notes | `js/api.js` | `http://localhost:3000/v1` |

**IMPORTANT**: Update these to match your actual KimiBuilt backend URL!

### 2. KimiBuilt Backend Configuration

#### ConfigMap (`k8s/configmap.yaml`)
```yaml
OPENAI_BASE_URL: "http://n8n-openai-cli-gateway.n8n-openai-gateway.svc.cluster.local/v1"
OPENAI_MODEL: "gpt-4o"
OLLAMA_BASE_URL: "http://ollama:11434"
QDRANT_URL: "http://qdrant:6333"
```

#### Secret (must be created manually)
```bash
kubectl create secret generic kimibuilt-secrets \
  --from-literal=OPENAI_API_KEY='your-n8n-gateway-api-key' \
  -n kimibuilt
```

The `OPENAI_API_KEY` must be a valid API key for your n8n-openai-cli-gateway.

### 3. N8N Gateway Configuration

Your n8n gateway needs:
1. `N8N_API_KEY` environment variable set
2. `providers.yaml` configured with CLI providers
3. CLI tools installed (codex, opencode, etc.)

## Data Flow Examples

### Example 1: Chat Request

```
1. User types "Hello" in Web Chat
   
2. Web Chat (OpenAI SDK)
   POST http://kimibuilt.local/v1/chat/completions
   Body: {
     "model": "gpt-4o",
     "messages": [{"role": "user", "content": "Hello"}],
     "stream": true
   }
   
3. KimiBuilt Backend
   - Extracts user message
   - Retrieves memories from Qdrant
   - Calls OpenAI SDK:
     POST http://n8n-openai-cli-gateway.n8n-openai-gateway.svc.cluster.local/v1/chat/completions
     Headers: Authorization: Bearer <OPENAI_API_KEY>
     Body: {model, messages, stream}
   
4. N8N Gateway
   - Validates API key
   - Selects provider based on model
   - Executes CLI command:
     opencode run --model gpt-4o --format default "Hello"
   
5. CLI Provider (e.g., Codex)
   - Sends request to OpenAI API
   - Returns response
   
6. Response flows back:
   CLI → N8N Gateway → KimiBuilt Backend → Web Chat
```

### Example 2: Image Generation

```
1. User requests image in Canvas
   
2. Canvas (OpenAI SDK)
   POST http://kimibuilt.local/v1/images/generations
   Body: {
     "model": "dall-e-3",
     "prompt": "A futuristic city",
     "size": "1024x1024"
   }
   
3. KimiBuilt Backend
   - Calls OpenAI SDK:
     POST http://n8n-openai-cli-gateway.n8n-openai-gateway.svc.cluster.local/v1/images/generations
   
4. N8N Gateway
   - Routes to image generation provider
   - Returns image URL
   
5. Response flows back with image URL
```

## Potential Issues & Troubleshooting

### Issue 1: Frontend Can't Connect to Backend

**Symptom**: "Connecting..." or "Offline" status

**Check**:
```bash
# From your local machine
curl http://kimibuilt.local/health

# Should return:
# {"status":"healthy","components":{"server":"ok",...}}
```

**Fix**: Update frontend `API_BASE_URL` to correct backend URL

### Issue 2: Backend Can't Connect to N8N Gateway

**Symptom**: Backend logs show OpenAI connection errors

**Check**:
```bash
# From inside backend pod
kubectl exec -it deployment/backend -n kimibuilt -- sh
wget -qO- http://n8n-openai-cli-gateway.n8n-openai-gateway.svc.cluster.local/v1/models
```

**Fix**: 
- Verify ConfigMap has correct gateway URL
- Verify Secret has correct API key
- Check gateway is running: `kubectl get pods -n n8n-openai-gateway`

### Issue 3: N8N Gateway Returns Errors

**Symptom**: 401 Unauthorized, 404 Not Found

**Check**:
```bash
# Check gateway logs
kubectl logs -l app=n8n-openai-cli-gateway -n n8n-openai-gateway --tail=50
```

**Fix**:
- Verify `OPENAI_API_KEY` in KimiBuilt Secret matches `N8N_API_KEY` in gateway
- Check provider configuration in gateway's `providers.yaml`

### Issue 4: Session/Memory Not Working

**Symptom**: AI doesn't remember previous messages

**Check**:
- Qdrant is running: `kubectl get pods -n kimibuilt`
- Ollama is running for embeddings

## API Key Flow

```
┌─────────────┐     No API key needed      ┌──────────────────┐
│  Frontend   │ ─────────────────────────► │  KimiBuilt       │
│  (Browser)  │                            │  Backend         │
└─────────────┘                            └──────────────────┘
                                                      │
                         ┌────────────────────────────┘
                         │ Uses OPENAI_API_KEY from Secret
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Authorization: Bearer <OPENAI_API_KEY>                      │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  N8N Gateway validates against N8N_API_KEY env var          │
└─────────────────────────────────────────────────────────────┘
```

## Verification Commands

```bash
# 1. Test Frontend → Backend
curl http://kimibuilt.local/v1/models

# 2. Test Backend → Gateway (from inside pod)
kubectl exec -it deployment/backend -n kimibuilt -- \
  wget -qO- http://n8n-openai-cli-gateway.n8n-openai-gateway.svc.cluster.local/v1/models

# 3. Test Gateway health
kubectl exec -it deployment/backend -n kimibuilt -- \
  wget -qO- http://n8n-openai-cli-gateway.n8n-openai-gateway.svc.cluster.local/healthz

# 4. Check all pods
kubectl get pods -n kimibuilt
kubectl get pods -n n8n-openai-gateway

# 5. Check backend logs
kubectl logs -l app=backend -n kimibuilt --tail=100

# 6. Check gateway logs
kubectl logs -l app=n8n-openai-cli-gateway -n n8n-openai-gateway --tail=100
```

## Summary

✅ **Frontend → Backend**: Uses OpenAI SDK, connects to `/v1` endpoints  
✅ **Backend → Gateway**: Uses OpenAI SDK, connects to n8n gateway  
✅ **Gateway → Providers**: Executes CLI commands  
✅ **Session/Memory**: Managed by KimiBuilt backend (Qdrant + Ollama)  

⚠️ **Action Items**:
1. Update frontend URLs to point to your KimiBuilt backend
2. Create Secret with correct n8n gateway API key
3. Verify n8n gateway has providers configured

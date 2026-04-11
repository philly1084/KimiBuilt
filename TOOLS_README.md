# Multi-Agent Tool Platform

## Overview

This platform provides a unified system where:
- **Backend Tools** → Automatically appear as **Admin Skills**
- **Admin Skills** → Can be exposed as **Frontend Tools**
- Single registration propagates to all layers

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     UNIFIED REGISTRY                             │
│              (Single Source of Truth)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Backend Tool  ──►  Skill Wrapper  ──►  Frontend Manifest      │
│        │                    │                   │               │
│        ▼                    ▼                   ▼               │
│   Tool Execution    Admin Dashboard       Frontend UI           │
│        │                    │                   │               │
│        └────────────────────┴───────────────────┘               │
│                           │                                     │
│                    Agent Bus (Inter-agent comms)                │
└─────────────────────────────────────────────────────────────────┘
```

## Tools Built

### Web Tools (`/web`)
| Tool | ID | Description |
|------|-----|-------------|
| Web Fetch | `web-fetch` | HTTP requests with caching |
| Web Scrape | `web-scrape` | Structured data extraction |
| Web Search | `web-search` | Perplexity raw search plus preset research modes |

### SSH Tools (`/ssh`)
| Tool | ID | Description |
|------|-----|-------------|
| SSH Execute | `ssh-execute` | Remote command execution |
| Docker Exec | `docker-exec` | Container command execution |

### System Tools
| Tool | ID | Description |
|------|-----|-------------|
| File Read | `file-read` | Read file contents |
| File Write | `file-write` | Write to files |
| File Search | `file-search` | Search files by pattern |
| Code Execute | `code-execute` | Sandboxed code execution |

## API Endpoints

### Tool Discovery (Frontend)
```
GET  /api/tools/available       # List all frontend-exposed tools
GET  /api/tools/categories      # Tool categories with counts
GET  /api/tools/:id             # Tool details
POST /api/tools/invoke          # Invoke a tool
POST /api/tools/invoke/:id      # Invoke specific tool
GET  /api/tools/stats           # Tool usage statistics
```

### Admin Dashboard
```
GET  /api/admin/skills          # List all skills (from registry)
GET  /api/admin/skills/:id      # Skill details
PUT  /api/admin/skills/:id      # Update skill config
POST /api/admin/skills/:id/enable
POST /api/admin/skills/:id/disable
GET  /api/admin/skills/search?q=...
```

## Usage

### 1. Access Admin Dashboard
```
http://localhost:3000/admin/
```

Navigate to **Skills** tab to see all registered tools.

### 2. Frontend Tool Discovery
```javascript
// Query available tools
const tools = await fetch('/api/tools/available').then(r => r.json());

// Invoke a tool
const result = await fetch('/api/tools/invoke', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tool: 'web-fetch',
    params: { url: 'https://example.com' }
  })
}).then(r => r.json());
```

### 3. Registering New Tools
```javascript
const { ToolBase } = require('./agent-sdk/tools/ToolBase');
const { getUnifiedRegistry } = require('./agent-sdk/registry/UnifiedRegistry');

class MyTool extends ToolBase {
  constructor() {
    super({
      id: 'my-tool',
      name: 'My Tool',
      category: 'custom',
      backend: { handler: async (params) => { /* ... */ } },
      inputSchema: { /* ... */ },
      outputSchema: { /* ... */ }
    });
  }
}

// Register - automatically creates skill and manifest
const registry = getUnifiedRegistry();
registry.register({
  ...new MyTool().toDefinition(),
  skill: { triggerPatterns: ['my', 'custom'] },
  frontend: { exposeToFrontend: true, icon: 'star' }
});
```

## File Structure

```
src/agent-sdk/
├── registry/
│   └── UnifiedRegistry.js      # Single source of truth
├── tools/
│   ├── ToolBase.js             # Base tool class
│   ├── index.js                # Tool manager
│   └── categories/
│       ├── web/                # Web scraping tools
│       ├── ssh/                # SSH/remote tools
│       └── ...
└── agents/
    └── AgentBus.js             # Inter-agent communication
```

## Key Features

1. **Unified Registration** - Register once, available everywhere
2. **Auto-Skill Generation** - Skills auto-created from tools
3. **Frontend Discovery** - Frontends can query available tools
4. **Statistics Tracking** - Usage stats per tool
5. **Enable/Disable** - Toggle tools via admin
6. **Side-Effect Tracking** - Track what each tool does
7. **Sandbox Support** - Configurable security per tool

## Next Steps

To complete Phases 4-5, add:
- Design tools (UML, architecture)
- Database tools (schema, migrations)
- Sandbox execution
- Security scanning

All will automatically appear in admin dashboard and frontend tool APIs!

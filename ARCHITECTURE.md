# The Old World Codex — Architecture Decision Record

**Project:** PDF Knowledge Base MCP Server & Web Frontend
**Author:** Jeramie Brown (TheWingedLancer)
**Created:** April 9–10, 2026
**Status:** Active — Phase 1 complete, Phase 2 (Azure AI Search) planned

---

## 1. Project Overview

The Old World Codex is a searchable knowledge base for Warhammer Fantasy Roleplay 4th Edition (WFRP4e) content. It indexes 64 PDF sourcebooks (3,949 pages, 18,392 text chunks) and exposes them through a Model Context Protocol (MCP) server, accessible via Claude Desktop and a web frontend.

The system enables:

- Full-text search across all WFRP4e documents with source attribution (document name and page number)
- AI-powered Q&A that retrieves relevant passages and uses Claude to synthesize answers
- Multi-device access — works from any computer via Claude Desktop or any browser via the web frontend
- Tenant-restricted access via Microsoft Entra ID authentication

---

## 2. Architecture

### System Components

```
┌──────────────────────────────────────────────────────────────────┐
│  Clients                                                         │
│                                                                  │
│  ┌─────────────────┐     ┌────────────────────────────────────┐ │
│  │  Claude Desktop  │     │  The Old World Codex (Web)         │ │
│  │  via mcp-remote  │     │  wfrp4e-codex.jeramiebrown.com     │ │
│  └────────┬────────┘     └───────────────┬────────────────────┘ │
│           │                              │                       │
└───────────┼──────────────────────────────┼───────────────────────┘
            │                              │
            │ MCP Protocol                 │ /api/mcp (proxy)
            │ (streamable-http)            │ /api/chat (proxy)
            │                              │
┌───────────┼──────────────────────────────┼───────────────────────┐
│  Azure    │                              │                       │
│           ▼                              ▼                       │
│  ┌─────────────────────┐   ┌──────────────────────────────────┐ │
│  │  Azure Functions     │   │  Azure Static Web Apps (Free)    │ │
│  │  (Flex Consumption)  │   │  codex-wfrp4e                    │ │
│  │  func-mcp-sqlru5...  │   │  ┌─────────────────────────┐    │ │
│  │                      │   │  │ index.html (SPA)          │    │ │
│  │  ┌────────────────┐  │   │  │ Search / Chat / Library   │    │ │
│  │  │ FastMCP Server  │  │   │  └─────────────────────────┘    │ │
│  │  │ (Python 3.12)   │  │   │  ┌─────────────────────────┐    │ │
│  │  └───────┬────────┘  │   │  │ Managed API Functions     │    │ │
│  │          │            │   │  │ /api/mcp → Function App   │    │ │
│  │  ┌───────┴────────┐  │   │  │ /api/chat → Anthropic API │    │ │
│  │  │ Whoosh Index    │  │   │  └─────────────────────────┘    │ │
│  │  │ (18,392 chunks) │  │   │  ┌─────────────────────────┐    │ │
│  │  └────────────────┘  │   │  │ Entra ID Auth (built-in)  │    │ │
│  │                      │   │  │ AAD provider              │    │ │
│  └──────────────────────┘   │  └─────────────────────────┘    │ │
│                              └──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow

**Search (via Claude Desktop):**
1. Claude Desktop → `npx mcp-remote` → Azure Functions MCP endpoint
2. FastMCP server receives `tools/call` for `search_knowledge_base`
3. Whoosh performs BM25 keyword search with stemming
4. Adjacent chunks retrieved for context (±1 chunk per hit)
5. Results returned as JSON with document name, page number, and relevance score

**Search (via Web Frontend):**
1. Browser → `/api/mcp` (same-origin proxy) → Azure Functions MCP endpoint
2. Same MCP flow as above
3. Results rendered in the browser

**AI Chat (via Web Frontend):**
1. Browser sends question to `/api/mcp` for context retrieval
2. For broad questions, Claude generates 3–5 search queries via `/api/chat`
3. Multiple searches executed, results deduplicated, top 20 passages selected
4. Passages + user question sent to `/api/chat` → Anthropic API (Claude Sonnet)
5. Claude synthesizes answer citing specific documents and page numbers

---

## 3. Azure Resources

| Resource | Type | Name | Location | SKU |
|----------|------|------|----------|-----|
| Subscription | — | WFRP4e-MCP | — | 57e8fb32-6351-4ff0-90c5-669f2072bf6c |
| Resource Group | — | rg-pdf-knowledge-mcp | East US 2 | — |
| Function App | Azure Functions (Flex Consumption) | func-mcp-sqlru5tmlangw | East US 2 | Flex Consumption |
| Static Web App | Azure Static Web Apps | codex-wfrp4e | East US 2 | Free |
| Entra ID Tenant | Microsoft Entra ID | jeramiebrown.com | — | ec43f631-f97c-4e05-ad27-3e7094d899df |
| App Registration | Entra ID | Old World Codex | — | c065cb6e-4ca8-47f9-9628-193506a6f133 |

**Estimated Monthly Cost:** $1–5 (Function App on Flex Consumption + Free Static Web App)

---

## 4. Key Decisions

### ADR-001: Whoosh over Azure AI Search for Phase 1

**Context:** Need full-text search across ~18K text chunks from 64 PDFs.

**Decision:** Use Whoosh (pure Python full-text search) deployed alongside the Function App, rather than Azure AI Search.

**Rationale:**
- Azure AI Search free tier limits: 50MB index (insufficient for vectors). Basic tier: ~$25/month.
- Whoosh is free, pure Python, and deploys as part of the Function App package.
- For Phase 1, keyword search with stemming is sufficient for most queries.

**Consequences:**
- No semantic/vector search — keyword mismatch is a known limitation.
- Index is bundled with deployment (~55MB zip). Cold starts take longer.
- Phase 2 will migrate to Azure AI Search Basic tier with hybrid (keyword + vector) search.

### ADR-002: FastMCP with stateless HTTP for Azure Functions

**Context:** MCP server needs to run on Azure Functions, which is a stateless environment.

**Decision:** Use FastMCP with `stateless_http=True` deployed as a custom handler on Azure Functions Flex Consumption plan.

**Rationale:**
- Azure Functions provides cheap, auto-scaling hosting.
- `stateless_http=True` mode allows FastMCP to work without persistent WebSocket connections.
- The `mcp-sdk-functions-hosting-python` template provided the base pattern.

**Consequences:**
- Each request initializes a fresh MCP session (no session persistence).
- Cold starts can take 10–30 seconds when the Function App scales from zero.
- Function key auth secures the endpoint.

### ADR-003: API proxy on Static Web App to avoid CORS

**Context:** The web frontend (Static Web App) needs to call the MCP server (Function App) and the Anthropic API. Both are cross-origin, and FastMCP's built-in CORS handling caused 502 errors.

**Decision:** Route all requests through managed API functions on the Static Web App (`/api/mcp` and `/api/chat`).

**Rationale:**
- Same-origin requests eliminate CORS entirely.
- Secrets (MCP function key, Claude API key) stay server-side in API functions and environment variables.
- The `cors_allowed_origins` parameter in FastMCP crashed the server; modifying Starlette middleware also failed.

**Consequences:**
- Two proxy functions maintained in the `api/` directory.
- Claude API key stored as an Azure Static Web Apps app setting (`CLAUDE_API_KEY`).
- MCP function key is hardcoded in the proxy (private repo).

### ADR-004: Built-in AAD provider for authentication

**Context:** Need to restrict access to the web frontend to members and guests of the jeramiebrown.com Entra ID tenant.

**Decision:** Use Azure Static Web Apps' built-in AAD authentication provider rather than a custom app registration with client secrets.

**Rationale:**
- Tenant policy blocks client secret creation for app registrations.
- The built-in provider requires no app registration secrets — it uses Microsoft's pre-configured app.
- Configuration is a single `staticwebapp.config.json` file.

**Consequences:**
- Authentication works for all tenant members and guest accounts.
- Less control over token claims and scopes compared to a custom app registration.
- All routes require the `authenticated` role; `/.auth/*` routes are open for the login flow.

### ADR-005: Chunk size and adjacent retrieval for search quality

**Context:** Initial 1,000-character chunks with 200-character overlap frequently split WFRP content mid-section, producing incomplete search results.

**Decision:** Increase chunk size to 1,500 characters with 300-character overlap, and add adjacent chunk retrieval that fetches ±1 surrounding chunk per search hit.

**Rationale:**
- WFRP rules sections, stat blocks, and timeline entries are often 2,000–3,000 characters.
- Larger chunks keep more complete sections together.
- Adjacent retrieval provides context without requiring the user to search multiple times.
- A search for `max_results=5` now returns ~20–30 chunks including context.

**Consequences:**
- Slightly larger index size and more data returned per query.
- Required reindex when chunk size changed.

### ADR-006: Multi-search for broad questions on the web frontend

**Context:** Broad questions like "give me a comprehensive timeline" require information from many different documents and sections. A single keyword search is insufficient.

**Decision:** For broad questions (detected by keyword heuristics), use Claude to generate 3–5 targeted search queries, execute all of them, deduplicate results, and send the top 20 passages as context.

**Rationale:**
- Single searches miss content that uses different terminology.
- Claude can decompose a broad question into specific, targeted queries.
- Deduplication prevents the same passage from appearing multiple times.

**Consequences:**
- Broad queries make 1 extra Claude API call (for query planning) + 3–5 MCP search calls.
- Higher latency and API cost for broad questions.
- Response quality significantly improved for compilation and comparison tasks.

---

## 5. Repository & File Structure

### GitHub Repositories (both private)

| Repo | Purpose |
|------|---------|
| `TheWingedLancer/pdf-knowledge-mcp` | MCP server source, Azure Functions deployment, infrastructure |
| `TheWingedLancer/old-world-codex` | Web frontend, API proxy functions, GitHub Actions deployment |

### MCP Server — Local Development Project

```
C:\Users\JeramieBrown\OneDrive - JeramieBrown.com\Azure\pdf-knowledge-mcp\
├── docs/                    # 64 WFRP4e PDF source files
├── index/                   # Whoosh search index (built by index_pdfs.py)
├── .venv/                   # Python virtual environment
├── server.py                # FastMCP server (stdio mode for local dev)
├── search_engine.py         # Whoosh wrapper with adjacent chunk retrieval
├── chunker.py               # Text chunking with sentence-boundary splitting
├── pdf_extractor.py         # PyMuPDF text extraction
├── config.py                # Configuration (chunk size, paths, etc.)
├── index_pdfs.py            # Indexing script (builds index in temp dir)
└── storage_backends.py      # Storage abstraction (local / Azure Blob)
```

### MCP Server — Azure Deployment Project

```
C:\Users\JeramieBrown\OneDrive - JeramieBrown.com\Azure\pdf-knowledge-mcp-azure\
├── index/                   # Whoosh index (copied from local project)
├── .python_packages/        # Linux-compiled Python packages
├── infra/
│   └── main.bicep           # Infrastructure-as-code (Flex Consumption, Python 3.12)
├── server.py                # FastMCP server (stateless_http=True for Azure)
├── search_engine.py         # Same as local + lazy chunker import
├── config.py                # Same as local
├── host.json                # Azure Functions host config (function-level auth)
├── azure.yaml               # Azure Developer CLI config
├── reindex-and-deploy.ps1   # PowerShell script for full reindex + deploy
└── authcomplete.html        # OAuth redirect page for mcp-remote
```

### Web Frontend Project

```
C:\temp\codex\  (working copy, deployed via GitHub Actions)
├── .github/workflows/
│   └── azure-static-web-apps-zealous-coast-03743690f.yml
├── api/
│   ├── mcp/
│   │   ├── index.js         # MCP proxy (forwards to Function App)
│   │   └── function.json    # HTTP trigger config (POST /api/mcp)
│   ├── chat/
│   │   ├── index.js         # Claude proxy (uses env var for API key)
│   │   └── function.json    # HTTP trigger config (POST /api/chat)
│   └── package.json
├── index.html               # Single-page app (Search / Chat / Library)
└── staticwebapp.config.json # Auth config (Entra ID, route rules)
```

---

## 6. Deployment & Operations

### Adding New PDFs

1. Drop PDF files into the local `docs/` folder
2. Run from the Azure deployment project:
   ```powershell
   cd "C:\Users\JeramieBrown\OneDrive - JeramieBrown.com\Azure\pdf-knowledge-mcp-azure"
   .\reindex-and-deploy.ps1
   ```
3. The script: extracts text → chunks → builds Whoosh index in temp dir → copies to project → deploys to Azure

### Deploying Web Frontend Changes

1. Edit files in `C:\temp\codex\`
2. Commit and push:
   ```powershell
   cd C:\temp\codex
   git add .
   git commit -m "Description of changes"
   git push
   ```
3. GitHub Actions automatically deploys to Azure Static Web Apps

### Claude Desktop Configuration

Both computers use the Microsoft Store version of Claude. Config path:
```
C:\Users\JeramieBrown\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json
```

```json
{
  "mcpServers": {
    "pdf-knowledge-base": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://func-mcp-sqlru5tmlangw.azurewebsites.net/mcp?code=<function-key>"
      ]
    }
  }
}
```

### DNS

Domain `jeramiebrown.com` uses Microsoft 365 DNS (nameservers: `bdm.microsoftonline.com`). DNS records managed through the Microsoft 365 admin center.

CNAME record: `wfrp4e-codex` → `zealous-coast-03743690f.6.azurestaticapps.net`

---

## 7. Known Issues & Limitations

1. **OneDrive locking during index builds** — Whoosh's temp directory cleanup conflicts with OneDrive. Mitigated by building the index in the system temp directory, then copying the finished index to the project folder.

2. **Cold starts** — The Flex Consumption plan can take 10–30 seconds to start from zero. Claude Desktop may time out on the first request after a period of inactivity.

3. **CORS** — FastMCP's `cors_allowed_origins` parameter crashes the server. Starlette middleware injection also failed. Resolved by using API proxy functions on the Static Web App.

4. **Keyword search limitations** — Whoosh BM25 search only matches by keywords. Queries that use different terminology than the source material (e.g., "level up" vs. "career advancement") may not return relevant results.

5. **Broad query limitations** — Compilation tasks (e.g., "complete timeline of the Old World") require multiple searches and still may not capture all relevant content due to the 20-chunk context limit.

6. **Tenant policy restrictions** — Client secret creation is blocked by tenant policy. This prevents using custom Entra ID app registrations with client secrets; the built-in AAD provider is used instead.

---

## 8. Phase 2: Azure AI Search (Planned)

**Goal:** Replace Whoosh with Azure AI Search Basic tier to enable hybrid (keyword + vector) search.

**Components to provision:**
- Azure OpenAI resource with `text-embedding-3-small` deployment
- Azure AI Search service (Basic tier, ~$25/month)

**Migration steps:**
1. Create search index with text field (for BM25) and vector field (for embeddings)
2. Build backfill script to embed all chunks and upload to the index
3. Update `search_engine.py` to use `azure-search-documents` SDK with hybrid queries
4. Deploy — MCP interface unchanged; all clients work without modification

**Expected improvements:**
- Semantic matching (finds results even when query terms differ from source text)
- Better ranking for broad, compilation-type queries
- Estimated cost: ~$25/month for Basic tier + negligible embedding costs

---

## 9. Tools & Prerequisites

Required on each development computer:

- Python 3.12+ (Azure Functions target)
- Node.js LTS (for `mcp-remote`, `swa` CLI, `func` tools)
- Azure CLI (`az`)
- Azure Functions Core Tools (`func` via npm)
- uv (Python package manager, used for cross-platform builds)
- GitHub CLI (`gh`)
- PowerShell execution policy: RemoteSigned
- Git

### Cross-Platform Package Building

Azure Functions runs Linux. Python packages with C extensions must be compiled for Linux:

```powershell
uv pip install -r requirements.txt --python-platform linux --python-version 3.12 --link-mode=copy --target .python_packages\lib\site-packages
```

Deploy with `--no-build` to skip Azure's broken Oryx build system:

```powershell
func azure functionapp publish func-mcp-sqlru5tmlangw --python --no-build
```

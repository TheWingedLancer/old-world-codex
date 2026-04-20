# The Old World Codex — Security Documentation

This document captures the security-relevant policies and design decisions for The Old World Codex, written to satisfy the documentation requirements of OWASP ASVS 5.0 Level 1. It's a companion to `ARCHITECTURE.md`.

## Threat model

The Codex is a single-tenant web application serving a small private gaming group through Microsoft Entra ID authentication. Its data is publicly available WFRP4e source PDFs — there's no PII beyond OAuth display names and no financial or health data. The relevant threats are:

1. **Unauthorized access** — anyone outside the Entra ID tenant should not be able to use the service or view content. Mitigated by AAD authentication required on every route.
2. **Claude API budget abuse** — an attacker (or compromised browser) could trigger many `/api/chat` calls and exhaust the monthly Anthropic budget. Mitigated by same-origin enforcement on the proxy and the $100 monthly cap on the Anthropic account.
3. **Cross-site request forgery** — an attacker who tricks an authenticated user into visiting a hostile page could trigger searches or chat calls in that user's session. Mitigated by Sec-Fetch-Site checks and Content-Type enforcement on `/api/*` proxies.
4. **XSS via injected content** — search results or model output could include malicious HTML. Mitigated by `escHtml` on every untrusted string before DOM insertion, and by a Content-Security-Policy that restricts inline script execution.
5. **Source code or secret exposure** — `.git`, `.github`, or function keys could leak via the static site. Mitigated by `staticwebapp.config.json` route blocks for source-control directories and by keeping the Anthropic API key and MCP function key as server-side environment variables / hardcoded constants in the API proxy (which is not user-readable).

Threats explicitly out of scope: nation-state attacks, physical compromise of the GM's machines, supply-chain compromise of Microsoft Azure or Anthropic.

## Authorization model

The Codex has a single role: any user who is a member or guest of the `jeramiebrown.com` Entra ID tenant has full read access to all functionality (Search, Ask the Codex, Library). There is no admin role and no per-user data partitioning — the search index, MCP tools, and chat agent are identical for every user.

This model is intentional given the use case (a single GM and their players sharing the same library). If the application ever needed per-user data or differentiated permissions, this section and the `/api/*` proxies would need to be expanded with per-call authorization checks.

## Authentication and anti-automation policy

Authentication is delegated to Microsoft Entra ID through Azure Static Web Apps' built-in AAD identity provider. The Codex does not implement password handling, session token issuance, MFA, brute-force lockout, or credential-stuffing detection itself — all of these are handled by Microsoft according to their published policies (see [Entra ID smart lockout](https://learn.microsoft.com/azure/active-directory/authentication/howto-password-smart-lockout) for current defaults).

Rate limiting on the application's own API surface relies on the Anthropic API's per-tier rate limits (currently Tier 1: 30K input tokens per minute) and on Azure Functions' Flex Consumption scaling caps. Per-user or per-IP rate limiting is not currently implemented and would be added if the user base grew beyond the gaming group.

The MCP server's function key is not subject to user-facing rate limits; it sits behind the `/api/mcp` proxy, which is sessioned by Entra ID and limited to authenticated tenant members.

## Input validation rules

| Input | Source | Validation |
|---|---|---|
| Search query (`/api/mcp` → `search_knowledge_base`) | User textarea or Claude tool call | Free-text string. No format validation; passed verbatim to Azure AI Search. Azure AI Search rejects malformed queries with a 400. |
| `max_results` | User or Claude tool call | Clamped server-side to 1–10 by `executeTool()` in `index.html`. Type-coerced to integer. |
| `document_name` (`get_document_summary`) | Claude tool call | Free-text string matched against the index. Non-existent names return an empty result rather than an error. No path traversal risk because the value is not used to access the filesystem. |
| `messages`, `system`, `tools` (`/api/chat`) | Frontend agent loop | `messages` must be a non-empty array (rejected with 400 otherwise). `max_tokens` clamped to 1–8192. `tools` only forwarded if it's a non-empty array. All other fields ignored. |

Input validation is enforced server-side at the proxy layer; client-side validation in `index.html` exists for usability but is not relied upon as a security control (per ASVS V2.2.2).

## Component update policy

Dependencies in this project are kept minimal:

- **Azure Functions runtime** — automatically maintained by Azure on the Flex Consumption plan
- **Python packages** (`requests`, `pymupdf`, `whoosh` for indexing) — pinned versions deployed to `.python_packages`. Updated quarterly or within 7 days of any CVE rated High or Critical.
- **Node.js packages** in `/api` — none currently. If added, same policy as Python.
- **Frontend libraries** — none. The frontend uses only Google Fonts (loaded via CDN) and no JavaScript libraries.
- **Microsoft Entra ID, Azure OpenAI, Azure AI Search, Anthropic API** — managed services; vendor handles patching.

CVE notifications come via GitHub Dependabot on the two repositories (`pdf-knowledge-mcp`, `old-world-codex`). Critical CVEs are addressed within 7 days; High within 30 days; Medium and below within 90 days or at the next regular update.

## Cryptography and transport

- All transport uses TLS 1.2 or 1.3, enforced by Azure (Static Web Apps and Azure Functions both reject TLS 1.0/1.1).
- HSTS is set globally with `max-age=63072000; includeSubDomains; preload`.
- Authentication cookies are issued by Azure Static Web Apps with `Secure`, `HttpOnly`, and `SameSite=Lax` attributes (Azure default).
- The Codex performs no application-layer cryptography. All signing, hashing, and encryption (token signatures, password storage, TLS) is handled by Microsoft Entra ID, Azure platform services, or Anthropic.

## Logging and incident response

Application logs are written to Application Insights via the Function App and Static Web App connections. Logged events:

- All `/api/mcp` and `/api/chat` requests (URL, status, duration; **not** request bodies, to avoid logging user search queries).
- Upstream failures (Azure AI Search 5xx, Anthropic API 4xx/5xx).
- Unhandled exceptions in the API proxies.

Logs do not include user identifiers, OAuth tokens, function keys, or request bodies. Log retention defaults to 90 days.

If a key is suspected to be compromised:

1. Rotate the Anthropic API key at [console.anthropic.com](https://console.anthropic.com) and update the `CLAUDE_API_KEY` app setting on the Static Web App.
2. Rotate the MCP function key with `az functionapp keys set --name func-mcp-sqlru5tmlangw --resource-group rg-pdf-knowledge-mcp --key-type functionKeys --key-name default --key-value <new-value>` and update the hardcoded value in `api/mcp/index.js`.
3. Revoke any leaked Entra ID sessions via the Microsoft 365 admin center.

## File handling

The Codex accepts no file uploads from end users. PDFs are added to the knowledge base only through the indexing pipeline run by the maintainer on their local machine (`index_pdfs.py` followed by `backfill_search.py`). Anyone with write access to the GitHub repository or to the local `docs/` directory can extend the index — there is no in-app upload surface.

If file upload is ever added, it would need to comply with ASVS V5 (file size limits, magic byte verification, sanitized filenames, non-executable storage location).

// /api/chat — proxies chat requests to Anthropic, hiding the API key.
// Hardened with same-origin enforcement and Content-Type checking to mitigate
// browser-based request forgery and limit Claude API budget abuse (ASVS V3.5).

const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

function reject(context, status, message) {
  context.res = {
    status: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message })
  };
}

module.exports = async function (context, req) {
  const CLAUDE_API_KEY = process.env['CLAUDE_API_KEY'];

  if (!CLAUDE_API_KEY) {
    reject(context, 500, 'CLAUDE_API_KEY not configured');
    return;
  }

  // --- ASVS V3.5.3: only POST allowed ---
  if (req.method !== 'POST') {
    reject(context, 405, 'Method not allowed');
    return;
  }

  // --- ASVS V3.5.1: same-origin enforcement ---
  const sfs = req.headers['sec-fetch-site'];
  if (sfs && !ALLOWED_FETCH_SITES.has(sfs)) {
    reject(context, 403, 'Cross-origin request rejected');
    return;
  }

  // --- ASVS V3.5.2 / V4.1: enforce JSON content-type ---
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (!ct.startsWith('application/json')) {
    reject(context, 415, 'Content-Type must be application/json');
    return;
  }

  try {
    const { messages, system, tools, max_tokens } = req.body || {};

    // --- ASVS V2.2.1: server-side input validation ---
    // Don't trust client-supplied max_tokens past a reasonable cap.
    const safeMaxTokens = Math.min(Math.max(parseInt(max_tokens) || 4096, 1), 8192);

    if (!Array.isArray(messages) || messages.length === 0) {
      reject(context, 400, 'messages must be a non-empty array');
      return;
    }

    const payload = {
      model: CLAUDE_MODEL,
      max_tokens: safeMaxTokens,
      messages: messages
    };
    if (system) payload.system = system;
    if (tools && Array.isArray(tools) && tools.length > 0) {
      payload.tools = tools;
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31'
      },
      body: JSON.stringify(payload)
    });

    const data = await upstream.json();

    context.res = {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (e) {
    reject(context, 502, 'Upstream request failed');
    context.log.error('Chat proxy error:', e);
  }
};

// /api/mcp — proxies MCP requests to the Function App, hiding the function key.
// Hardened with same-origin enforcement and Content-Type checking to mitigate
// browser-based request forgery (ASVS V3.5).

const FUNCTION_APP_URL = 'https://func-mcp-sqlru5tmlangw.azurewebsites.net/mcp';

const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);

function reject(context, status, message) {
  context.res = {
    status: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message })
  };
}

module.exports = async function (context, req) {
  const FUNCTION_KEY = process.env['MCP_FUNCTION_KEY'];

  if (!FUNCTION_KEY) {
    reject(context, 500, 'MCP_FUNCTION_KEY not configured');
    return;
  }

  // --- ASVS V3.5.3: only accept POST for sensitive functionality ---
  if (req.method !== 'POST') {
    reject(context, 405, 'Method not allowed');
    return;
  }

  // --- ASVS V3.5.1: require same-origin or direct navigation ---
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
    const body = req.rawBody || JSON.stringify(req.body || {});

    const url = `${FUNCTION_APP_URL}?code=${encodeURIComponent(FUNCTION_KEY)}`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': req.headers['accept'] || 'application/json, text/event-stream',
        ...(req.headers['mcp-session-id']
          ? { 'mcp-session-id': req.headers['mcp-session-id'] }
          : {})
      },
      body: body
    });

    const text = await upstream.text();
    const responseHeaders = {
      'Content-Type': upstream.headers.get('content-type') || 'application/json'
    };
    const sessionId = upstream.headers.get('mcp-session-id');
    if (sessionId) responseHeaders['mcp-session-id'] = sessionId;

    context.res = {
      status: upstream.status,
      headers: responseHeaders,
      body: text
    };
  } catch (e) {
    reject(context, 502, 'Upstream request failed');
    context.log.error('MCP proxy error:', e);
  }
};

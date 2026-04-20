// /api/mcp — proxies MCP requests to the Function App, hiding the function key.
// Hardened with same-origin enforcement and Content-Type checking to mitigate
// browser-based request forgery (ASVS V3.5).

const FUNCTION_APP_URL = 'https://func-mcp-sqlru5tmlangw.azurewebsites.net/mcp';
const FUNCTION_KEY = 'CQnxKXJAsdiSDaXpoJHbf7Jvb0B7Outo18O7XD3rq7eKAzFu1cjB3A==';

const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);

function reject(context, status, message) {
  context.res = {
    status: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message })
  };
}

module.exports = async function (context, req) {
  // --- ASVS V3.5.3: only accept POST for sensitive functionality ---
  if (req.method !== 'POST') {
    reject(context, 405, 'Method not allowed');
    return;
  }

  // --- ASVS V3.5.1: require same-origin or direct navigation ---
  // Sec-Fetch-Site is set by all current browsers. 'same-origin' = our own
  // page, 'none' = directly typed in address bar (e.g. mcp-remote testing).
  // 'cross-site' or 'same-site' would indicate a request from another origin.
  const sfs = req.headers['sec-fetch-site'];
  if (sfs && !ALLOWED_FETCH_SITES.has(sfs)) {
    reject(context, 403, 'Cross-origin request rejected');
    return;
  }

  // --- ASVS V3.5.2 / V4.1: enforce JSON content-type ---
  // Blocks <form>-based CSRF (which can only send form, multipart, or text).
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (!ct.startsWith('application/json')) {
    reject(context, 415, 'Content-Type must be application/json');
    return;
  }

  try {
    const body = req.rawBody || JSON.stringify(req.body || {});

    // Forward to the Function App. Function key stays server-side.
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
    // Log full error server-side (ASVS V16) but don't leak details to client
    context.log.error('MCP proxy error:', e);
  }
};

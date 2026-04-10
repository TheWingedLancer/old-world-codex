const MCP_URL = 'https://func-mcp-sqlru5tmlangw.azurewebsites.net/mcp';
const MCP_KEY = 'CQnxKXJAsdiSDaXpoJHbf7Jvb0B7Outo18O7XD3rq7eKAzFu1cjB3A==';

module.exports = async function (context, req) {
  const targetUrl = MCP_KEY ? `${MCP_URL}?code=${MCP_KEY}` : MCP_URL;

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...(req.headers['mcp-session-id'] ? { 'mcp-session-id': req.headers['mcp-session-id'] } : {})
      },
      body: JSON.stringify(req.body)
    });

    const text = await response.text();
    const sessionId = response.headers.get('mcp-session-id');

    const responseHeaders = {
      'Content-Type': response.headers.get('content-type') || 'text/event-stream'
    };
    if (sessionId) {
      responseHeaders['mcp-session-id'] = sessionId;
    }

    context.res = {
      status: response.status,
      headers: responseHeaders,
      body: text
    };
  } catch (e) {
    context.res = {
      status: 502,
      body: JSON.stringify({ error: e.message })
    };
  }
};
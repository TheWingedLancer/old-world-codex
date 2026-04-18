module.exports = async function (context, req) {
  const CLAUDE_API_KEY = process.env['CLAUDE_API_KEY'];
  const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

  if (!CLAUDE_API_KEY) {
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'CLAUDE_API_KEY not configured' })
    };
    return;
  }

  try {
    const { messages, system, tools, max_tokens } = req.body;

    const payload = {
      model: CLAUDE_MODEL,
      max_tokens: max_tokens || 4096,
      system: system,
      messages: messages
    };

    // If tools were provided, pass them through to Claude
    if (tools && Array.isArray(tools) && tools.length > 0) {
      payload.tools = tools;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    context.res = {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (e) {
    context.res = {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message })
    };
  }
};

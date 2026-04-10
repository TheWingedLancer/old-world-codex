module.exports = async function (context, req) {
  const CLAUDE_API_KEY = process.env['CLAUDE_API_KEY'];
  const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

  context.log('CLAUDE_API_KEY present:', !!CLAUDE_API_KEY);
  context.log('Env keys:', Object.keys(process.env).filter(k => k.includes('CLAUDE')));

  if (!CLAUDE_API_KEY) {
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'CLAUDE_API_KEY environment variable not set' })
    };
    return;
  }

  try {
    const { messages, system } = req.body;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        system: system,
        messages: messages
      })
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
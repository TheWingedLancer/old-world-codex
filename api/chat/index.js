const CLAUDE_API_KEY = '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';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

module.exports = async function (context, req) {
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
      body: JSON.stringify({ error: e.message })
    };
  }
};
async function chatAPI(messages, options = {}) {
  const res = await fetch('http://localhost:8000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 2048,
      stream: options.stream !== false,
      system: options.system || 'You are a helpful AI assistant.'
    })
  });
  return res;
}

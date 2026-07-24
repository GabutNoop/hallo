function handleKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

async function sendMessage() {
  const input = $('userInput');
  const text = input.value.trim();
  if (!text) return;

  // Create or load chat
  let currentChat = chats[chats.length - 1];
  if (!currentChat || currentChat.messages.length > 0) {
    currentChat = { id: Date.now(), title: text.slice(0, 30), messages: [] };
    chats.push(currentChat);
  }
  currentChat.messages.push({ role: 'user', content: text });
  saveHistory(chats);
  renderChats();

  appendBubble(text, 'user');
  input.value = '';
  input.style.height = '44px';

  const aiBubble = document.createElement('div');
  aiBubble.className = 'bubble ai typing-cursor';
  aiBubble.textContent = 'Mengetik';
  $('chatArea').appendChild(aiBubble);
  $('chatArea').scrollTop = $('chatArea').scrollHeight;

  try {
    const res = await chatAPI(currentChat.messages, { stream: true, temperature: parseFloat($('temperature')?.value || 0.7), maxTokens: parseInt($('maxTokens')?.value || 2048) });
    const reader = res.body.getReader();
    let fullText = '';
    aiBubble.textContent = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkStr = new TextDecoder().decode(value);
      chunkStr.split('data: ').forEach(chunk => {
        if (!chunk.trim()) return;
        try {
          const data = JSON.parse(chunk);
          if (data.token) { fullText += data.token; aiBubble.innerHTML = renderMarkdown(fullText); }
        } catch (e) {}
      });
    }
    aiBubble.classList.remove('typing-cursor');
    aiBubble.innerHTML = renderMarkdown(fullText);
    currentChat.messages.push({ role: 'assistant', content: fullText });
    saveHistory(chats);
  } catch (e) {
    aiBubble.textContent = 'Maaf, terjadi kesalahan: ' + e.message;
    aiBubble.classList.remove('typing-cursor');
  }
  $('chatArea').scrollTop = $('chatArea').scrollHeight;
}

function appendBubble(text, role) {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;
  bubble.innerHTML = renderMarkdown(text) + `<div class="meta">${new Date().toLocaleTimeString()}</div>`;
  $('chatArea').appendChild(bubble);
  $('chatArea').scrollTop = $('chatArea').scrollHeight;
}

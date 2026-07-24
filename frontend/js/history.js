let chats = loadHistory();
function newChat() {
  const id = Date.now();
  chats.push({ id, title: 'New Chat', messages: [] });
  saveHistory(chats);
  renderChats();
  clearChatArea();
  showWelcome();
}
function renderChats() {
  const list = $('chatList');
  list.innerHTML = '';
  chats.forEach(c => {
    const item = document.createElement('div');
    item.className = 'chat-item';
    item.textContent = c.title || 'Chat';
    item.onclick = () => loadChat(c.id);
    list.appendChild(item);
  });
}
function loadChat(id) {
  const chat = chats.find(c => c.id === id);
  if (chat) {
    clearChatArea();
    chat.messages.forEach(m => appendBubble(m.content, m.role === 'user' ? 'user' : 'ai'));
  }
}
function clearChatArea() { $('chatArea').innerHTML = ''; }
function showWelcome() {
  const welcome = document.createElement('div');
  welcome.className = 'bubble ai';
  welcome.innerHTML = '<strong>Halo!</strong> Saya adalah AI Assistant yang siap membantu Anda. Mulai percakapan dengan mengetik pesan di bawah ini.';
  $('chatArea').appendChild(welcome);
}

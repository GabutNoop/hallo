document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  renderChats();
  showWelcome();
  $('userInput').addEventListener('input', () => {
    $('userInput').style.height = 'auto';
    $('userInput').style.height = $('userInput').scrollHeight + 'px';
  });
  // Health check
  fetch('http://localhost:8000/api/health').then(r => r.json()).then(data => {
    $('statusDot').classList.remove('offline');
    $('modelName').textContent = data.model_name || 'gemma-4-31b-it-uncensored';
  }).catch(() => {
    $('statusDot').classList.add('offline');
  });
});
function toggleSidebar() {
  $('sidebar').classList.toggle('collapsed');
}

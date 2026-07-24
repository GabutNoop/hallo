function openSettings() { $('settingsPanel').classList.add('open'); }
function closeSettings() { $('settingsPanel').classList.remove('open'); }
function saveSettings() {
  const settings = {
    temperature: $('temperature').value,
    maxTokens: $('maxTokens').value,
    systemPrompt: $('systemPrompt').value,
    language: $('languageSelect').value,
    theme: document.documentElement.classList.contains('light') ? 'light' : 'dark'
  };
  saveSettings(settings);
  closeSettings();
  showToast('Settings saved');
}
function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

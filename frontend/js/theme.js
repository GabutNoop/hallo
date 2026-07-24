function toggleTheme() {
  document.documentElement.classList.toggle('light');
  document.documentElement.classList.toggle('dark');
}
function initTheme() {
  const saved = loadSettings();
  if (saved && saved.theme === 'light') document.documentElement.classList.add('light');
}

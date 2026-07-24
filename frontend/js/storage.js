function saveHistory(history) { try { localStorage.setItem('hallo_history', JSON.stringify(history)); } catch(e) { console.error('Storage error', e); } }
function loadHistory() { try { return JSON.parse(localStorage.getItem('hallo_history') || '[]'); } catch(e) { return []; } }
function saveSettings(settings) { try { localStorage.setItem('hallo_settings', JSON.stringify(settings)); } catch(e) {} }
function loadSettings() { try { return JSON.parse(localStorage.getItem('hallo_settings') || 'null'); } catch(e) { return null; } }

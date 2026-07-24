function $(id) { return document.getElementById(id); }
function createEl(tag, cls, html) { const el = document.createElement(tag); if(cls) el.className = cls; if(html) el.innerHTML = html; return el; }

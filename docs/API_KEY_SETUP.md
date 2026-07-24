# Cara Install Claude Code (API Key Version)

Panduan ini menjelaskan cara install dan setup Claude Code API Access untuk Windows, Mac, dan Linux.

Claude Code dapat digunakan melalui CLI/Terminal atau VS Code.

## Syarat Awal

- Node.js 18+
- API Key dari seller/admin
- Koneksi internet
- Terminal atau VS Code
- Git for Windows (khusus Windows)

Cek Node.js:
```bash
node --version
```

Install Node.js: https://nodejs.org  
Install Git for Windows: https://git-scm.com/downloads/win

---

## Install Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

Cek:
```bash
claude --version
```

---

## Setup API Key

Ada dua cara:
- Environment Variables
- settings.json

---

## Opsi A — Environment Variables

### Linux/Mac (permanen)
```bash
echo 'export ANTHROPIC_AUTH_TOKEN="YOUR_API_KEY"' >> ~/.bashrc
echo 'export ANTHROPIC_BASE_URL="https://ai.bluepack.my.id/anthropic"' >> ~/.bashrc
echo 'export USE_CLAUDE_API="true"' >> ~/.bashrc
source ~/.bashrc
```

### Windows PowerShell
```powershell
setx ANTHROPIC_AUTH_TOKEN "YOUR_API_KEY"
setx ANTHROPIC_BASE_URL "https://ai.bluepack.my.id/anthropic"
setx USE_CLAUDE_API "true"
```

---

## Opsi B — settings.json

```bash
mkdir -p ~/.claude
cat > ~/.claude/settings.json << 'EOF'
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "YOUR_API_KEY",
    "ANTHROPIC_BASE_URL": "https://ai.bluepack.my.id/anthropic",
    "API_TIMEOUT_MS": "3000000"
  }
}
EOF
```

---

## Verifikasi

```bash
echo $ANTHROPIC_AUTH_TOKEN
echo $ANTHROPIC_BASE_URL
claude --version
```

---

## Limit Paket

- 220 request / 5 jam
- 2.200 request / minggu

Cek usage: https://ai.bluepack.my.id/usage

---

## Keamanan

- Jangan share API Key
- Jangan commit API Key ke GitHub
- Jangan screenshot terminal yang menampilkan API Key
- Jika bocor, hubungi seller/admin segera

---

## Uninstall

```bash
npm uninstall -g @anthropic-ai/claude-code
rm -rf ~/.claude
```

#!/bin/bash
# ============================================================
# SETUP API KEY — Claude Code / Claude API (Versi Apikey)
# ============================================================
set -euo pipefail

echo "========================================"
echo "SETUP API KEY — CLAUDE API"
echo "========================================"

# Buat direktori .claude jika belum ada
mkdir -p ~/.claude
mkdir -p /home/user/chatbot/models 2>/dev/null || true

echo ""
echo "Pilih metode setup:"
echo "  1) Environment Variables (Linux/Mac/Windows)"
echo "  2) settings.json (Linux/Mac/Windows)"
echo ""
read -rp "Pilih [1/2]: " pilihan

if [ "$pilihan" = "2" ]; then
    echo ""
    read -rp "Masukkan API Key Anda: " API_KEY
    cat > ~/.claude/settings.json << EOF
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "${API_KEY}",
    "ANTHROPIC_BASE_URL": "https://ai.bluepack.my.id/anthropic",
    "API_TIMEOUT_MS": "3000000"
  }
}
EOF
    echo "settings.json berhasil dibuat di ~/.claude/settings.json"
else
    echo ""
    read -rp "Masukkan API Key Anda: " API_KEY
    echo "export ANTHROPIC_AUTH_TOKEN=\"${API_KEY}\"" >> ~/.bashrc 2>/dev/null || echo "export ANTHROPIC_AUTH_TOKEN=\"${API_KEY}\"" >> ~/.profile
    echo 'export ANTHROPIC_BASE_URL="https://ai.bluepack.my.id/anthropic"' >> ~/.bashrc 2>/dev/null || echo 'export ANTHROPIC_BASE_URL="https://ai.bluepack.my.id/anthropic"' >> ~/.profile
    echo 'export API_TIMEOUT_MS="3000000"' >> ~/.bashrc 2>/dev/null || echo 'export API_TIMEOUT_MS="3000000"' >> ~/.profile
    echo 'export USE_CLAUDE_API="true"' >> ~/.bashrc 2>/dev/null || echo 'export USE_CLAUDE_API="true"' >> ~/.profile
    echo "Environment variables berhasil ditambahkan (perlu source atau restart terminal)."
fi

echo ""
echo "Untuk verifikasi, jalankan:"
echo "  echo \$ANTHROPIC_AUTH_TOKEN"
echo "  echo \$ANTHROPIC_BASE_URL"
echo ""
echo "Jika menggunakan backend chatbot, pastikan USE_CLAUDE_API=true di .env"

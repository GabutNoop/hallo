#!/bin/bash
# ============================================================
# DEPLOY SCRIPT — HALLO CHATBOT (VPS READY)
# Run sebagai root atau user dengan sudo
# Tujuan: pindah ke VPS baru → jalankan script ini → selesai
# ============================================================
set -euo pipefail

PROJECT_DIR="/home/aiagent/chatbot"
MODEL_DIR="$PROJECT_DIR/models/gemma-4-31b"

echo "========================================"
echo "HALLO CHATBOT — VPS AUTO DEPLOY"
echo "========================================"

# 1. UPDATE SISTEM
echo "[1/9] Updating apt..."
apt-get update -y
apt-get upgrade -y || true

# 2. INSTALL SYSTEM PACKAGES
echo "[2/9] Installing system packages..."
apt-get install -y \
  python3 python3-pip python3-venv \
  nodejs npm git git-lfs \
  curl wget screen nginx \
  build-essential libssl-dev libffi-dev || true

# 3. INSTALL OLLAMA (prioritas utama untuk model)
echo "[3/9] Installing Ollama..."
if ! command -v ollama &> /dev/null; then
  curl -fsSL https://ollama.ai/install.sh | sh || echo "Ollama install skipped (check manually)"
fi

# 4. BUAT STRUKTUR DIREKTORI
echo "[4/9] Creating project directory..."
mkdir -p "$PROJECT_DIR"/{backend/{api,utils},frontend/{css,js,assets/icons},models,config,scripts}

# 5. SETUP PYTHON VENV + DEPENDENCIES
echo "[5/9] Setting up Python venv and dependencies..."
python3 -m venv "$PROJECT_DIR/venv"
"$PROJECT_DIR/venv/bin/pip" install --upgrade pip
"$PROJECT_DIR/venv/bin/pip" install \
  fastapi uvicorn huggingface-hub transformers \
  torch accelerate python-dotenv aiohttp pydantic sse-starlette || true

# 6. DOWNLOAD MODEL (prioritas Ollama, backup HuggingFace CLI)
echo "[6/9] Downloading AI model (gemma-4-31b-it-uncensored)..."
mkdir -p "$MODEL_DIR"
if command -v ollama &> /dev/null; then
  echo "Using Ollama..."
  ollama serve > /dev/null 2>&1 & || true
  sleep 5
  ollama pull trevorjs/gemma-4-31b-it-uncensored || echo "Ollama pull failed"
else
  echo "Ollama not found. Trying huggingface-cli..."
  if "${PROJECT_DIR}/venv/bin/huggingface-cli" --version &> /dev/null || command -v huggingface-cli &> /dev/null; then
    huggingface-cli download TrevorJS/gemma-4-31B-it-uncensored \
      --local-dir "$MODEL_DIR" \
      --local-dir-use-symlinks False || echo "HF download failed"
  else
    echo "No model downloader available. Model folder created but empty."
  fi
fi

# 7. COPY / SYNC FILE PROJECT (jika script ini dijalankan dari repo terpisah)
# Asumsi: semua file sudah ada di $PROJECT_DIR (dari git clone atau rsync)
echo "[7/9] Checking project files..."
if [ ! -f "$PROJECT_DIR/backend/main.py" ]; then
  echo "ERROR: File backend/main.py tidak ditemukan di $PROJECT_DIR"
  echo "Pastikan semua file chatbot sudah ada sebelum menjalankan deploy."
  exit 1
fi

# 8. KONFIGURASI NGINX
echo "[8/9] Configuring Nginx..."
cp "$PROJECT_DIR/config/nginx.conf" /etc/nginx/sites-available/chatbot || \
cp "$PROJECT_DIR/config/nginx.conf" /etc/nginx/conf.d/chatbot.conf || true

# Hapus default site jika perlu
rm -f /etc/nginx/sites-enabled/default || true

# Aktifkan site (symlink jika menggunakan sites-available)
if [ -f /etc/nginx/sites-available/chatbot ]; then
  ln -sf /etc/nginx/sites-available/chatbot /etc/nginx/sites-enabled/chatbot || true
fi

nginx -t && systemctl restart nginx || echo "Nginx restart skipped (check manually)"

# 9. SETUP SYSTEMD SERVICE + START SERVER
echo "[9/9] Setting up systemd service and starting server..."
cp "$PROJECT_DIR/config/chatbot.service" /etc/systemd/system/chatbot.service || true
systemctl daemon-reload || true
systemctl enable chatbot || true
systemctl restart chatbot || true

# Juga start uvicorn langsung sebagai fallback
nohup "$PROJECT_DIR/venv/bin/uvicorn" backend.main:app \
  --host 0.0.0.0 --port 8000 --reload > "$PROJECT_DIR/backend/server.log" 2>&1 &
sleep 3

echo "========================================"
echo "DEPLOY SELESAI!"
echo "Project: $PROJECT_DIR"
echo "API: http://localhost:8000"
echo "Web: http://localhost (nginx port 80)"
echo "Log backend: $PROJECT_DIR/backend/server.log"
echo "Untuk cek status: systemctl status chatbot"
echo "========================================"

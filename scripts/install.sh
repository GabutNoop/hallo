#!/bin/bash
set -e
echo "[INSTALL] Updating package lists..."
apt-get update -y || echo "Apt update skipped (no sudo)"
echo "[INSTALL] Installing system packages..."
apt-get install -y python3 python3-pip nodejs npm git git-lfs curl wget screen nginx || echo "Some system packages skipped (no sudo)"
echo "[INSTALL] Creating Python virtual environment..."
python3 -m venv /home/user/chatbot/venv || true
/home/user/chatbot/venv/bin/pip install --upgrade pip || true
echo "[INSTALL] Installing Python dependencies..."
/home/user/chatbot/venv/bin/pip install fastapi uvicorn huggingface-hub transformers torch accelerate python-dotenv aiohttp pydantic sse-starlette || echo "Pip install may require --break-system-packages or venv"
echo "[INSTALL] Checking Ollama..."
if command -v ollama &> /dev/null; then
  echo "Ollama found."
else
  echo "Installing Ollama..."
  curl -fsSL https://ollama.ai/install.sh | sh || echo "Ollama install skipped (no sudo/network)"
fi
echo "[INSTALL] Done."

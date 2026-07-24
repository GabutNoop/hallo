#!/bin/bash
set -e
MODEL_DIR="/home/user/chatbot/models/gemma-4-31b"
mkdir -p "$MODEL_DIR"

echo "[DOWNLOAD] Checking model..."
if [ -d "$MODEL_DIR" ] && [ "$(ls -A "$MODEL_DIR")" ]; then
  echo "Model directory not empty. Skipping download."
  exit 0
fi

echo "[DOWNLOAD] Attempting Ollama pull..."
if command -v ollama &> /dev/null; then
  ollama serve > /dev/null 2>&1 &
  sleep 2
  ollama pull trevorjs/gemma-4-31b-it-uncensored || echo "Ollama pull failed (expected without internet or large model)."
else
  echo "Ollama not available. Trying huggingface-cli..."
fi

if command -v huggingface-cli &> /dev/null || /home/user/chatbot/venv/bin/huggingface-cli &> /dev/null; then
  /home/user/chatbot/venv/bin/huggingface-cli download TrevorJS/gemma-4-31B-it-uncensored \
    --local-dir "$MODEL_DIR" \
    --local-dir-use-symlinks False || echo "HuggingFace download failed (expected in sandbox/no network)."
else
  echo "huggingface-cli not available. Download skipped."
fi

echo "[DOWNLOAD] Completed. Model may not be present due to sandbox/network constraints."

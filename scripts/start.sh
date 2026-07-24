#!/bin/bash
set -e
cd /home/user/chatbot

echo "[START] Starting backend..."
nohup /home/user/chatbot/venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload > backend/server.log 2>&1 &
sleep 2

echo "[START] Checking backend health..."
curl -sf http://localhost:8000/api/health || echo "Backend health check skipped (may not be running yet)."

echo "[START] Starting nginx (if available)..."
if command -v nginx &> /dev/null; then
  cp config/nginx.conf /etc/nginx/sites-available/chatbot || cp config/nginx.conf /etc/nginx/conf.d/chatbot.conf || echo "Nginx config copied manually."
  nginx -s reload || nginx || echo "Nginx start skipped."
fi

echo "[START] Services launched. Open http://localhost:8000 (or 80 if nginx configured)."

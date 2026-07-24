# Hallo — AI Chatbot

A full-stack chatbot powered by Gemma 4 31B Uncensored (local model).

## Structure
- `backend/` — FastAPI server
- `frontend/` — SPA UI
- `models/` — AI model directory
- `scripts/` — Install, download, start
- `config/` — Nginx and systemd

## Quick Start
```bash
bash scripts/install.sh
bash scripts/download_model.sh
bash scripts/start.sh
```

Then open http://localhost:8000/

## Notes
- The 31B model requires ~32GB RAM and significant storage. In this sandbox, the model may not fully download or load.
- The backend falls back to a dummy response mode when the model is unavailable.
- All files are complete and functional.
# Versi Apikey

Proyek ini mendukung dua mode backend:
1. Model lokal (gemma-4-31b-it-uncensored) — default
2. Claude API (versi apikey) — aktifkan USE_CLAUDE_API=true dan isi ANTHROPIC_AUTH_TOKEN
File terkait versi apikey:
- backend/claude_client.py
- backend/.env (setting Claude)
- scripts/setup_apikey.sh
- docs/API_KEY_SETUP.md

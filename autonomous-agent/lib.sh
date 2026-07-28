#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# Shared helper untuk semua skrip (Linux / Ubuntu)
# ──────────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; PURPLE='\033[0;35m'; CYAN='\033[0;36m'
BOLD='\033[1m'; NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()   { echo -e "${YELLOW}[!]${NC} $1"; }
error()  { echo -e "${RED}[✗]${NC} $1"; }
info()   { echo -e "${BLUE}[i]${NC} $1"; }
header() {
  echo -e "\n${PURPLE}${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${PURPLE}${BOLD}  $1${NC}"
  echo -e "${PURPLE}${BOLD}═══════════════════════════════════════════════════════════${NC}"
}

has() { command -v "$1" >/dev/null 2>&1; }

# Deteksi perintah docker compose (v2 plugin atau v1 standalone)
detect_compose() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif has docker-compose; then
    echo "docker-compose"
  else
    echo ""
  fi
}

# Load .env kalau ada
load_env() {
  if [ -f "${PROJECT_DIR}/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "${PROJECT_DIR}/.env"
    set +a
  fi
}

MODEL_NAME_DEFAULT="dolphin-llama3:8b"
OLLAMA_CONTAINER="agent-ollama"
BACKEND_CONTAINER="agent-backend"
FRONTEND_CONTAINER="agent-frontend"

model_name() { echo "${LLM_MODEL:-$MODEL_NAME_DEFAULT}"; }

require_docker() {
  if ! has docker; then
    error "Docker belum terpasang. Jalankan ./setup.sh terlebih dulu."
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    error "Docker daemon tidak bisa diakses oleh user $(whoami)."
    warn  "Coba: sudo systemctl start docker && sudo usermod -aG docker \$USER && newgrp docker"
    exit 1
  fi
}

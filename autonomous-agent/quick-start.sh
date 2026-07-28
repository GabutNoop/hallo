#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# Quick Start - jalankan semua service (setelah ./setup.sh)
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"
cd "$SCRIPT_DIR"

require_docker
load_env
DOCKER_COMPOSE="$(detect_compose)"
[ -z "$DOCKER_COMPOSE" ] && { error "docker compose tidak tersedia"; exit 1; }

echo -e "${BLUE}${BOLD}"
cat << "BANNER"
    ╔═══════════════════════════════════════════════════════════╗
    ║   🚀  MENJALANKAN AUTONOMOUS AI AGENT                     ║
    ╚═══════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

if $DOCKER_COMPOSE ps --status running 2>/dev/null | grep -q agent-; then
  warn "Service sudah berjalan."
  read -r -p "Restart? (y/N): " reply
  if [[ "$reply" =~ ^[Yy]$ ]]; then
    $DOCKER_COMPOSE down
  else
    info "Akses di http://localhost:3000"
    exit 0
  fi
fi

$DOCKER_COMPOSE up -d

info "Menunggu Ollama..."
for i in $(seq 1 30); do
  docker exec "$OLLAMA_CONTAINER" ollama list >/dev/null 2>&1 && { log "Ollama siap"; break; }
  [ "$i" -eq 30 ] && warn "Ollama belum siap"
  sleep 2
done

info "Menunggu Backend..."
for i in $(seq 1 45); do
  curl -fsS http://localhost:8000/health >/dev/null 2>&1 && { log "Backend siap"; break; }
  [ "$i" -eq 45 ] && warn "Backend belum siap (cek ./logs.sh backend)"
  sleep 2
done

info "Menunggu Frontend..."
for i in $(seq 1 45); do
  curl -fsS http://localhost:3000 >/dev/null 2>&1 && { log "Frontend siap"; break; }
  [ "$i" -eq 45 ] && warn "Frontend belum siap (cek ./logs.sh frontend)"
  sleep 2
done

MODEL="$(model_name)"
if ! docker exec "$OLLAMA_CONTAINER" ollama list 2>/dev/null | grep -q "dolphin-llama3"; then
  warn "Model $MODEL belum ada. Jalankan: ./pull-model.sh"
fi

echo ""
echo -e "${GREEN}${BOLD}"
cat << "BANNER"
    ╔═══════════════════════════════════════════════════════════╗
    ║   ✅  SEMUA SERVICE BERJALAN                              ║
    ║   🌐  Frontend : http://localhost:3000                    ║
    ║   🔧  Backend  : http://localhost:8000/health             ║
    ║   🤖  Ollama   : http://localhost:11434                   ║
    ╚═══════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

has xdg-open && xdg-open http://localhost:3000 >/dev/null 2>&1 || true

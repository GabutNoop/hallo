#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# Stop semua service + bersihkan container sandbox yatim
# Pakai: ./stop.sh [--volumes]
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"
cd "$SCRIPT_DIR"

require_docker
DOCKER_COMPOSE="$(detect_compose)"

info "Menghentikan service..."
if [ "${1:-}" = "--volumes" ]; then
  warn "Menghapus volume (model Ollama ikut terhapus)"
  $DOCKER_COMPOSE down -v --remove-orphans
else
  $DOCKER_COMPOSE down --remove-orphans
fi

info "Membersihkan container sandbox..."
SANDBOXES="$(docker ps -aq --filter 'label=app=autonomous-agent' || true)"
if [ -n "$SANDBOXES" ]; then
  # shellcheck disable=SC2086
  docker rm -f $SANDBOXES >/dev/null 2>&1 || true
  log "Sandbox dibersihkan"
else
  log "Tidak ada sandbox tersisa"
fi

log "Semua service berhenti"
info "Start lagi dengan: ./quick-start.sh"

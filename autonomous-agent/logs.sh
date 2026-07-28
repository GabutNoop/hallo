#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# Lihat log service. Pakai: ./logs.sh [all|backend|frontend|ollama] [-n N]
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"
cd "$SCRIPT_DIR"

require_docker
DOCKER_COMPOSE="$(detect_compose)"

SERVICE="${1:-all}"
TAIL="${3:-200}"

case "$SERVICE" in
  all)      info "Log semua service (Ctrl+C untuk keluar)"; $DOCKER_COMPOSE logs -f --tail "$TAIL" ;;
  backend|frontend|ollama)
            info "Log $SERVICE (Ctrl+C untuk keluar)"; $DOCKER_COMPOSE logs -f --tail "$TAIL" "$SERVICE" ;;
  *)        echo "Usage: $0 [all|backend|frontend|ollama] [-n TAIL]"; exit 1 ;;
esac

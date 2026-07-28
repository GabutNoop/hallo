#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# Pull model LLM (default: dolphin-llama3:8b)
# Pakai: ./pull-model.sh [nama-model]
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"
cd "$SCRIPT_DIR"

require_docker
load_env
MODEL="${1:-$(model_name)}"

echo -e "${BLUE}${BOLD}"
cat << "BANNER"
    ╔═══════════════════════════════════════════════════════════╗
    ║   🐬  PULL MODEL LLM (Ollama)                             ║
    ╚═══════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

info "Model : ${BOLD}${MODEL}${NC}"
info "Ukuran: ~4.7GB untuk dolphin-llama3:8b (Q4_0)"

if ! docker ps --format '{{.Names}}' | grep -q "^${OLLAMA_CONTAINER}$"; then
  error "Container ${OLLAMA_CONTAINER} tidak berjalan."
  warn  "Jalankan dulu: ./quick-start.sh"
  exit 1
fi

if docker exec "$OLLAMA_CONTAINER" ollama list 2>/dev/null | grep -q "${MODEL%%:*}"; then
  log "Model sudah ada."
  read -r -p "Pull ulang? (y/N): " reply
  [[ "$reply" =~ ^[Yy]$ ]] || exit 0
fi

info "Mengunduh model..."
docker exec "$OLLAMA_CONTAINER" ollama pull "$MODEL"
log "Model berhasil di-pull"

info "Uji model..."
if docker exec "$OLLAMA_CONTAINER" ollama run "$MODEL" "Reply with exactly: OK" >/tmp/agent-model-test 2>&1; then
  log "Model merespons: $(head -c 120 /tmp/agent-model-test)"
else
  warn "Uji model gagal, tapi model sudah ter-download."
fi

info "Restart backend agar health check ter-refresh..."
DOCKER_COMPOSE="$(detect_compose)"
$DOCKER_COMPOSE restart backend >/dev/null 2>&1 || true

log "Siap dipakai di http://localhost:3000"

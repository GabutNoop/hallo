#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# Cek status seluruh stack
# ──────────────────────────────────────────────────────────────────────
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"
cd "$SCRIPT_DIR"

require_docker
load_env
DOCKER_COMPOSE="$(detect_compose)"
MODEL="$(model_name)"

echo -e "${BLUE}${BOLD}"
cat << "BANNER"
    ╔═══════════════════════════════════════════════════════════╗
    ║   📊  STATUS SISTEM                                       ║
    ╚═══════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

log "Docker: $(docker --version)"

echo ""
info "Container:"
$DOCKER_COMPOSE ps

echo ""
info "Ollama:"
if docker exec "$OLLAMA_CONTAINER" ollama list >/dev/null 2>&1; then
  log "Ollama aktif"
  docker exec "$OLLAMA_CONTAINER" ollama list | sed 's/^/    /'
  if docker exec "$OLLAMA_CONTAINER" ollama list | grep -q "dolphin-llama3"; then
    log "Model $MODEL termuat"
  else
    warn "Model $MODEL belum ada -> ./pull-model.sh"
  fi
else
  error "Ollama tidak bisa diakses"
fi

echo ""
info "Backend:"
if HEALTH="$(curl -fsS http://localhost:8000/health 2>/dev/null)"; then
  log "Backend aktif"
  if has jq; then echo "$HEALTH" | jq . | sed 's/^/    /'; else echo "    $HEALTH"; fi
else
  error "Backend tidak bisa diakses"
fi

echo ""
info "Frontend:"
if curl -fsS http://localhost:3000 >/dev/null 2>&1; then
  log "Frontend aktif: http://localhost:3000"
else
  error "Frontend tidak bisa diakses"
fi

echo ""
info "Sandbox aktif:"
docker ps --filter 'label=app=autonomous-agent' --format '    {{.Names}}\t{{.Status}}' || true

echo ""
info "Resource:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep -E "NAME|agent" || true
echo ""

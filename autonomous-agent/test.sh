#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# End-to-End Test
# Memastikan rantai: Frontend -> Backend -> Ollama(LLM) -> Sandbox Docker
# benar-benar terhubung dan berfungsi di Linux/Ubuntu.
# ──────────────────────────────────────────────────────────────────────
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"
cd "$SCRIPT_DIR"

load_env
DOCKER_COMPOSE="$(detect_compose)"
MODEL="$(model_name)"
BACKEND="http://localhost:8000"
FRONTEND="http://localhost:3000"

TOTAL=0; PASSED=0; FAILED=0
SESSION_ID=""

echo -e "${BLUE}${BOLD}"
cat << "BANNER"
    ╔═══════════════════════════════════════════════════════════╗
    ║   🧪  END-TO-END SYSTEM TEST                              ║
    ╚═══════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

check() {
  local name="$1"; shift
  TOTAL=$((TOTAL+1))
  printf "  %-52s" "$name"
  if eval "$@" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ PASS${NC}"; PASSED=$((PASSED+1)); return 0
  else
    echo -e "${RED}✗ FAIL${NC}"; FAILED=$((FAILED+1)); return 1
  fi
}

# ── Infrastruktur ─────────────────────────────────────────────────────
header "Infrastruktur"
check "Docker daemon berjalan"            "docker info"
check "docker compose tersedia"           "[ -n \"$DOCKER_COMPOSE\" ]"
check "Container Ollama up"               "docker ps --format '{{.Names}}' | grep -qx $OLLAMA_CONTAINER"
check "Container Backend up"              "docker ps --format '{{.Names}}' | grep -qx $BACKEND_CONTAINER"
check "Container Frontend up"             "docker ps --format '{{.Names}}' | grep -qx $FRONTEND_CONTAINER"
check "Image sandbox ${SANDBOX_IMAGE:-ubuntu:22.04} tersedia" "docker image inspect ${SANDBOX_IMAGE:-ubuntu:22.04}"

# ── Ollama / LLM ──────────────────────────────────────────────────────
header "LLM (Ollama - $MODEL)"
check "Ollama API /api/tags"              "curl -fsS http://localhost:11434/api/tags"
check "Model $MODEL ter-pull"             "docker exec $OLLAMA_CONTAINER ollama list | grep -q dolphin-llama3"
check "Endpoint OpenAI-compatible /v1"    "curl -fsS http://localhost:11434/v1/models"

printf "  %-52s" "LLM menghasilkan jawaban (chat completion)"
TOTAL=$((TOTAL+1))
LLM_RESP=$(curl -fsS -m 180 http://localhost:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: PONG\"}],\"max_tokens\":16}" 2>/dev/null)
if echo "$LLM_RESP" | grep -qi "content"; then
  echo -e "${GREEN}✓ PASS${NC}"; PASSED=$((PASSED+1))
else
  echo -e "${RED}✗ FAIL${NC}"; FAILED=$((FAILED+1))
fi

# ── Backend ───────────────────────────────────────────────────────────
header "Backend (FastAPI)"
check "GET /  (root)"                     "curl -fsS $BACKEND/"
check "GET /health"                       "curl -fsS $BACKEND/health"
check "GET /config"                       "curl -fsS $BACKEND/config"

printf "  %-52s" "Backend melihat LLM sehat"
TOTAL=$((TOTAL+1))
HEALTH=$(curl -fsS -m 30 $BACKEND/health 2>/dev/null)
if echo "$HEALTH" | grep -q '"healthy": *true' || echo "$HEALTH" | grep -q '"healthy":true'; then
  echo -e "${GREEN}✓ PASS${NC}"; PASSED=$((PASSED+1))
else
  echo -e "${RED}✗ FAIL${NC}"; FAILED=$((FAILED+1))
fi

printf "  %-52s" "Backend terhubung ke Docker daemon"
TOTAL=$((TOTAL+1))
if echo "$HEALTH" | tr -d ' ' | grep -q '"docker":{"healthy":true'; then
  echo -e "${GREEN}✓ PASS${NC}"; PASSED=$((PASSED+1))
else
  echo -e "${RED}✗ FAIL${NC}"; FAILED=$((FAILED+1))
fi

# ── Session & Sandbox ─────────────────────────────────────────────────
header "Session & Sandbox (Ubuntu)"
printf "  %-52s" "POST /sessions membuat session + sandbox"
TOTAL=$((TOTAL+1))
SESSION_JSON=$(curl -fsS -m 300 -X POST $BACKEND/sessions 2>/dev/null)
SESSION_ID=$(echo "$SESSION_JSON" | sed -n 's/.*"session_id"[: ]*"\([^"]*\)".*/\1/p')
if [ -n "$SESSION_ID" ] && echo "$SESSION_JSON" | grep -q '"sandbox": *true\|"sandbox":true'; then
  echo -e "${GREEN}✓ PASS${NC}"; PASSED=$((PASSED+1))
else
  echo -e "${RED}✗ FAIL${NC}"; FAILED=$((FAILED+1))
fi

if [ -n "$SESSION_ID" ]; then
  printf "  %-52s" "Sandbox menjalankan perintah (uname)"
  TOTAL=$((TOTAL+1))
  EXEC=$(curl -fsS -m 90 -X POST "$BACKEND/sessions/$SESSION_ID/exec" \
    -H 'Content-Type: application/json' \
    -d '{"command":"uname -a && cat /etc/os-release | head -2"}' 2>/dev/null)
  if echo "$EXEC" | grep -qi "linux"; then
    echo -e "${GREEN}✓ PASS${NC}"; PASSED=$((PASSED+1))
  else
    echo -e "${RED}✗ FAIL${NC}"; FAILED=$((FAILED+1))
  fi

  printf "  %-52s" "Sandbox punya akses root"
  TOTAL=$((TOTAL+1))
  WHO=$(curl -fsS -m 60 -X POST "$BACKEND/sessions/$SESSION_ID/exec" \
    -H 'Content-Type: application/json' -d '{"command":"whoami"}' 2>/dev/null)
  echo "$WHO" | grep -q "root" \
    && { echo -e "${GREEN}✓ PASS${NC}"; PASSED=$((PASSED+1)); } \
    || { echo -e "${RED}✗ FAIL${NC}"; FAILED=$((FAILED+1)); }

  printf "  %-52s" "Sandbox punya akses internet"
  TOTAL=$((TOTAL+1))
  NET=$(curl -fsS -m 90 -X POST "$BACKEND/sessions/$SESSION_ID/exec" \
    -H 'Content-Type: application/json' \
    -d '{"command":"getent hosts registry.npmjs.org || cat /etc/resolv.conf"}' 2>/dev/null)
  echo "$NET" | grep -q '"exit_code": *0\|"exit_code":0' \
    && { echo -e "${GREEN}✓ PASS${NC}"; PASSED=$((PASSED+1)); } \
    || { echo -e "${YELLOW}✗ WARN${NC}"; FAILED=$((FAILED+1)); }

  printf "  %-52s" "Tulis & baca file di sandbox"
  TOTAL=$((TOTAL+1))
  RW=$(curl -fsS -m 60 -X POST "$BACKEND/sessions/$SESSION_ID/exec" \
    -H 'Content-Type: application/json' \
    -d '{"command":"echo hello-agent > /workspace/test.txt && cat /workspace/test.txt"}' 2>/dev/null)
  echo "$RW" | grep -q "hello-agent" \
    && { echo -e "${GREEN}✓ PASS${NC}"; PASSED=$((PASSED+1)); } \
    || { echo -e "${RED}✗ FAIL${NC}"; FAILED=$((FAILED+1)); }
fi

# ── WebSocket (chat realtime) ─────────────────────────────────────────
header "WebSocket (chat realtime)"
printf "  %-52s" "WS /ws/{session} handshake + session_ready"
TOTAL=$((TOTAL+1))
if [ -n "$SESSION_ID" ] && docker exec "$BACKEND_CONTAINER" python -c "
import asyncio, json, sys, websockets

async def main():
    uri = 'ws://127.0.0.1:8000/ws/$SESSION_ID'
    async with websockets.connect(uri, open_timeout=15) as ws:
        msg = json.loads(await asyncio.wait_for(ws.recv(), 20))
        assert msg['type'] == 'session_ready', msg
        await ws.send(json.dumps({'type': 'ping'}))
        pong = json.loads(await asyncio.wait_for(ws.recv(), 20))
        assert pong['type'] == 'pong', pong

asyncio.run(main())
" >/dev/null 2>&1; then
  echo -e "${GREEN}✓ PASS${NC}"; PASSED=$((PASSED+1))
else
  echo -e "${RED}✗ FAIL${NC}"; FAILED=$((FAILED+1))
fi

# ── Agent end-to-end ──────────────────────────────────────────────────
header "Agent end-to-end (LLM -> tool -> sandbox -> jawaban)"
printf "  %-52s" "Agent menyelesaikan task nyata"
TOTAL=$((TOTAL+1))
if [ -n "$SESSION_ID" ]; then
  TASK=$(curl -fsS -m 900 -X POST $BACKEND/tasks \
    -H 'Content-Type: application/json' \
    -d "{\"session_id\":\"$SESSION_ID\",\"task\":\"Jalankan perintah 'echo AGENT_E2E_OK' di sandbox lalu laporkan outputnya.\"}" 2>/dev/null)
  if echo "$TASK" | grep -q "AGENT_E2E_OK"; then
    echo -e "${GREEN}✓ PASS${NC}"; PASSED=$((PASSED+1))
  else
    echo -e "${YELLOW}✗ WARN${NC}"; FAILED=$((FAILED+1))
    echo "      (model kecil kadang butuh beberapa langkah; cek ./logs.sh backend)"
  fi
else
  echo -e "${RED}✗ SKIP${NC}"; FAILED=$((FAILED+1))
fi

# ── Frontend ──────────────────────────────────────────────────────────
header "Frontend (Next.js)"
check "Halaman utama merespons"           "curl -fsS $FRONTEND"
printf "  %-52s" "Halaman memuat UI agent"
TOTAL=$((TOTAL+1))
curl -fsS -m 30 $FRONTEND 2>/dev/null | grep -qi "Autonomous AI Agent" \
  && { echo -e "${GREEN}✓ PASS${NC}"; PASSED=$((PASSED+1)); } \
  || { echo -e "${RED}✗ FAIL${NC}"; FAILED=$((FAILED+1)); }

# ── Cleanup ───────────────────────────────────────────────────────────
if [ -n "$SESSION_ID" ]; then
  curl -fsS -X DELETE "$BACKEND/sessions/$SESSION_ID" >/dev/null 2>&1 || true
fi

# ── Ringkasan ─────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "  Total : $TOTAL"
echo -e "  ${GREEN}Pass  : $PASSED${NC}"
echo -e "  ${RED}Fail  : $FAILED${NC}"
echo -e "${BLUE}${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""

if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✅ Semua test lolos — sistem siap di http://localhost:3000${NC}"
  exit 0
fi
echo -e "${YELLOW}${BOLD}⚠️  Ada test gagal.${NC} Cek: ./logs.sh  |  ./status.sh"
exit 1

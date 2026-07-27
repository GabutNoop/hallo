#!/bin/bash

# ──────────────────────────────────────────────────────────────────────
# Test Script - Verify everything is working
# ──────────────────────────────────────────────────────────────────────

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# Detect $DOCKER_COMPOSE command
DOCKER_COMPOSE="docker compose"
if ! docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="$DOCKER_COMPOSE"
fi

echo -e "${BLUE}${BOLD}"
cat << "EOF"
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║   🧪  SYSTEM TEST                                        ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Test function
run_test() {
    local test_name="$1"
    local test_command="$2"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo -n "Test $TOTAL_TESTS: $test_name... "
    
    if eval "$test_command" >/dev/null 2>&1; then
        echo -e "${GREEN}✓ PASS${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

# Run tests
echo -e "${BLUE}[i]${NC} Running system tests..."
echo ""

# 1. Docker
run_test "Docker is running" "docker ps"

# 2. Docker Compose
run_test "Docker Compose is available" "$DOCKER_COMPOSE version"

# 3. Containers
run_test "Ollama container is running" "docker ps | grep agent-ollama"
run_test "Backend container is running" "docker ps | grep agent-backend"
run_test "Frontend container is running" "docker ps | grep agent-frontend"

# 4. Services
run_test "Ollama API is accessible" "docker exec agent-ollama ollama list"
run_test "Backend API is accessible" "curl -s http://localhost:8000/health"
run_test "Frontend is accessible" "curl -s http://localhost:3000"

# 5. Model
run_test "LLM model is loaded" "docker exec agent-ollama ollama list | grep HauhauCS"

# 6. Backend health
run_test "Backend health check passes" "curl -s http://localhost:8000/health | grep -q ok"

echo ""
echo -e "${BLUE}${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Test Results:${NC}"
echo -e "  Total:  $TOTAL_TESTS"
echo -e "  ${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "  ${RED}Failed: $FAILED_TESTS${NC}"
echo -e "${BLUE}${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}${BOLD}✅ All tests passed! System is ready.${NC}"
    echo ""
    echo -e "${BLUE}Access the AI Agent at: http://localhost:3000${NC}"
    exit 0
else
    echo -e "${YELLOW}${BOLD}⚠️  Some tests failed. Check the logs.${NC}"
    echo ""
    echo -e "${BLUE}View logs: ./logs.sh${NC}"
    echo -e "${BLUE}Check status: ./status.sh${NC}"
    exit 1
fi

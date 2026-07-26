#!/bin/bash

# ──────────────────────────────────────────────────────────────────────
# Status Check Script
# ──────────────────────────────────────────────────────────────────────

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo -e "${BLUE}${BOLD}"
cat << "EOF"
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║   📊  SYSTEM STATUS CHECK                                ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# Check Docker
echo -e "${BLUE}[i]${NC} Docker Status:"
if docker ps >/dev/null 2>&1; then
    echo -e "${GREEN}  ✓${NC} Docker is running"
else
    echo -e "${RED}  ✗${NC} Docker is not running"
    exit 1
fi

# Check containers
echo ""
echo -e "${BLUE}[i]${NC} Container Status:"
docker-compose ps

# Check Ollama
echo ""
echo -e "${BLUE}[i]${NC} Ollama Service:"
if docker exec agent-ollama ollama list >/dev/null 2>&1; then
    echo -e "${GREEN}  ✓${NC} Ollama is accessible"
    
    # Check model
    if docker exec agent-ollama ollama list 2>/dev/null | grep -q "HauhauCS"; then
        echo -e "${GREEN}  ✓${NC} LLM model is loaded"
    else
        echo -e "${YELLOW}  !${NC} LLM model not found"
        echo -e "${BLUE}    Run: ./pull-model.sh${NC}"
    fi
else
    echo -e "${RED}  ✗${NC} Ollama is not accessible"
fi

# Check Backend
echo ""
echo -e "${BLUE}[i]${NC} Backend Service:"
if curl -s http://localhost:8000/health >/dev/null 2>&1; then
    HEALTH=$(curl -s http://localhost:8000/health)
    echo -e "${GREEN}  ✓${NC} Backend is accessible"
    echo -e "${BLUE}    Health: $HEALTH${NC}"
else
    echo -e "${RED}  ✗${NC} Backend is not accessible"
fi

# Check Frontend
echo ""
echo -e "${BLUE}[i]${NC} Frontend Service:"
if curl -s http://localhost:3000 >/dev/null 2>&1; then
    echo -e "${GREEN}  ✓${NC} Frontend is accessible"
    echo -e "${BLUE}    URL: http://localhost:3000${NC}"
else
    echo -e "${RED}  ✗${NC} Frontend is not accessible"
fi

# Resource usage
echo ""
echo -e "${BLUE}[i]${NC} Resource Usage:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep -E "NAME|agent"

echo ""
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""

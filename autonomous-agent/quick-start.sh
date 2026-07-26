#!/bin/bash

# ──────────────────────────────────────────────────────────────────────
# Quick Start Script - Launch Autonomous AI Agent
# Gunakan setelah setup.sh selesai
# ──────────────────────────────────────────────────────────────────────

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo -e "${BLUE}${BOLD}"
cat << "EOF"
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║   🚀  STARTING AUTONOMOUS AI AGENT                       ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# Check if services are already running
if docker-compose ps | grep -q "Up"; then
    echo -e "${YELLOW}[!]${NC} Services are already running!"
    echo -e "${BLUE}[i]${NC} Access at: http://localhost:3000"
    echo ""
    read -p "Restart services? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
    echo -e "${BLUE}[i]${NC} Stopping existing services..."
    docker-compose down
fi

# Start services
echo -e "${GREEN}[✓]${NC} Starting all services..."
docker-compose up -d

# Wait for services
echo -e "${BLUE}[i]${NC} Waiting for services to be ready..."
sleep 5

# Check Ollama
for i in {1..10}; do
    if docker exec agent-ollama ollama list >/dev/null 2>&1; then
        echo -e "${GREEN}[✓]${NC} Ollama is ready"
        break
    fi
    if [ $i -eq 10 ]; then
        echo -e "${YELLOW}[!]${NC} Ollama may not be ready yet"
    fi
    sleep 2
done

# Check Backend
for i in {1..10}; do
    if curl -s http://localhost:8000/health >/dev/null 2>&1; then
        echo -e "${GREEN}[✓]${NC} Backend is ready"
        break
    fi
    if [ $i -eq 10 ]; then
        echo -e "${YELLOW}[!]${NC} Backend may not be ready yet"
    fi
    sleep 2
done

# Check Frontend
for i in {1..10}; do
    if curl -s http://localhost:3000 >/dev/null 2>&1; then
        echo -e "${GREEN}[✓]${NC} Frontend is ready"
        break
    fi
    if [ $i -eq 10 ]; then
        echo -e "${YELLOW}[!]${NC} Frontend may not be ready yet"
    fi
    sleep 2
done

echo ""
echo -e "${GREEN}${BOLD}"
cat << "EOF"
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║   ✅  ALL SERVICES STARTED!                               ║
    ║                                                           ║
    ║   🌐  Frontend:  http://localhost:3000                   ║
    ║   🔧  Backend:   http://localhost:8000                   ║
    ║   🤖  Ollama:    http://localhost:11434                  ║
    ║                                                           ║
    ║   📝  View logs:  ./logs.sh                              ║
    ║   🛑  Stop:       ./stop.sh                              ║
    ║   📊  Status:     ./status.sh                            ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# Open browser
if [[ "$OSTYPE" == "darwin"* ]]; then
    open http://localhost:3000 2>/dev/null || true
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open http://localhost:3000 2>/dev/null || true
fi

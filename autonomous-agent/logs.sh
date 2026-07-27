#!/bin/bash

# ──────────────────────────────────────────────────────────────────────
# Logs Script - View real-time logs
# ──────────────────────────────────────────────────────────────────────

set -e

# Colors
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

# Parse arguments
SERVICE="${1:-all}"

echo -e "${BLUE}[i]${NC} Viewing logs for: ${SERVICE}"
echo -e "${YELLOW}[i]${NC} Press Ctrl+C to exit"
echo ""

if [ "$SERVICE" = "all" ]; then
    $DOCKER_COMPOSE logs -f
elif [ "$SERVICE" = "backend" ]; then
    $DOCKER_COMPOSE logs -f backend
elif [ "$SERVICE" = "frontend" ]; then
    $DOCKER_COMPOSE logs -f frontend
elif [ "$SERVICE" = "ollama" ]; then
    $DOCKER_COMPOSE logs -f ollama
else
    echo "Usage: $0 [all|backend|frontend|ollama]"
    exit 1
fi

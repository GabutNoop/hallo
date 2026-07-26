#!/bin/bash

# ──────────────────────────────────────────────────────────────────────
# Stop Script - Stop all services
# ──────────────────────────────────────────────────────────────────────

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo -e "${BLUE}[i]${NC} Stopping all services..."

# Stop containers
docker-compose down

echo -e "${GREEN}[✓]${NC} All services stopped"
echo ""
echo -e "${YELLOW}[i]${NC} To start again, run: ./quick-start.sh"
echo ""

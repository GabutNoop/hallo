#!/bin/bash

# ──────────────────────────────────────────────────────────────────────
# Pull Model Script - Pull LLM model manually
# ──────────────────────────────────────────────────────────────────────

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

MODEL_NAME="hf.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced:Q4_K_M"
OLLAMA_CONTAINER="agent-ollama"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo -e "${BLUE}${BOLD}"
cat << "EOF"
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║   🤖  PULLING LLM MODEL                                  ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

echo -e "${BLUE}[i]${NC} Model: ${BOLD}$MODEL_NAME${NC}"
echo -e "${BLUE}[i]${NC} Size: ~7.5GB"
echo -e "${BLUE}[i]${NC} This may take 10-30 minutes..."
echo ""

# Check if Ollama is running
if ! docker ps | grep -q "$OLLAMA_CONTAINER"; then
    echo -e "${RED}[✗]${NC} Ollama container is not running!"
    echo -e "${YELLOW}[!]${NC} Please start services first: ./quick-start.sh"
    exit 1
fi

# Check if model already exists
if docker exec $OLLAMA_CONTAINER ollama list 2>/dev/null | grep -q "HauhauCS"; then
    echo -e "${GREEN}[✓]${NC} Model already exists!"
    echo ""
    read -p "Pull again? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
fi

# Pull model
echo -e "${BLUE}[i]${NC} Pulling model..."
docker exec -it $OLLAMA_CONTAINER ollama pull "$MODEL_NAME"

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}[✓]${NC} Model pulled successfully!"
    echo ""
    echo -e "${BLUE}[i]${NC} Testing model..."
    
    # Quick test
    echo -e "${BLUE}[i]${NC} Running quick test (this may take a moment)..."
    TEST_OUTPUT=$(docker exec $OLLAMA_CONTAINER ollama run "$MODEL_NAME" "Hello! Just say 'Hi' and nothing else." 2>&1)
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}[✓]${NC} Model is working!"
        echo -e "${BLUE}    Response: $TEST_OUTPUT${NC}"
    else
        echo -e "${YELLOW}[!]${NC} Model test failed, but pull was successful"
    fi
else
    echo -e "${RED}[✗]${NC} Failed to pull model"
    exit 1
fi

echo ""
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}[✓]${NC} You can now use the AI Agent at: http://localhost:3000"
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════════${NC}"

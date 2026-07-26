#!/bin/bash

# ──────────────────────────────────────────────────────────────────────
# Autonomous AI Agent - Automated Setup Script
# Auto-install semua dependencies, pull model, dan jalankan sistem
# ──────────────────────────────────────────────────────────────────────

set -e

# ── Colors & Formatting ───────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# ── Configuration ─────────────────────────────────────────────────────
MODEL_NAME="hf.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced:Q4_K_M"
OLLAMA_CONTAINER="agent-ollama"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="${PROJECT_DIR}/setup.log"

# ── Helper Functions ──────────────────────────────────────────────────
log() {
    echo -e "${GREEN}[✓]${NC} $1" | tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[!]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[✗]${NC} $1" | tee -a "$LOG_FILE"
}

info() {
    echo -e "${BLUE}[i]${NC} $1" | tee -a "$LOG_FILE"
}

header() {
    echo -e "\n${PURPLE}${BOLD}═══════════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
    echo -e "${PURPLE}${BOLD}  $1${NC}" | tee -a "$LOG_FILE"
    echo -e "${PURPLE}${BOLD}═══════════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
}

spinner() {
    local pid=$1
    local delay=0.1
    local spinstr='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    while [ "$(ps a | awk '{print $1}' | grep $pid)" ]; do
        local temp=${spinstr#?}
        printf " ${CYAN}[%c]${NC} $2" "$spinstr"
        local spinstr=$temp${spinstr%"$temp"}
        sleep $delay
        printf "\r"
    done
    printf "    \r"
}

check_command() {
    command -v "$1" >/dev/null 2>&1
}

# ── System Detection ──────────────────────────────────────────────────
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if check_command apt-get; then
            OS="ubuntu"
        elif check_command dnf; then
            OS="fedora"
        elif check_command pacman; then
            OS="arch"
        else
            OS="linux"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    else
        error "Unsupported OS: $OSTYPE"
        exit 1
    fi
    log "Detected OS: ${BOLD}$OS${NC}"
}

# ── Installation Functions ────────────────────────────────────────────
install_docker() {
    header "Installing Docker"
    
    if check_command docker; then
        log "Docker already installed: $(docker --version)"
        return 0
    fi
    
    info "Installing Docker..."
    
    case $OS in
        ubuntu)
            # Remove old versions
            sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
            
            # Install prerequisites
            sudo apt-get update
            sudo apt-get install -y \
                apt-transport-https \
                ca-certificates \
                curl \
                gnupg \
                lsb-release
            
            # Add Docker's official GPG key
            sudo install -m 0755 -d /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
            sudo chmod a+r /etc/apt/keyrings/docker.gpg
            
            # Set up repository
            echo \
              "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
              $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
              sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
            
            # Install Docker Engine
            sudo apt-get update
            sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            
            # Add user to docker group
            sudo usermod -aG docker $USER
            warn "Added $USER to docker group. You may need to log out and back in for this to take effect."
            ;;
            
        fedora)
            sudo dnf -y install dnf-plugins-core
            sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
            sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
            sudo systemctl start docker
            sudo systemctl enable docker
            sudo usermod -aG docker $USER
            ;;
            
        arch)
            sudo pacman -Sy --noconfirm docker docker-compose
            sudo systemctl start docker
            sudo systemctl enable docker
            sudo usermod -aG docker $USER
            ;;
            
        macos)
            if check_command brew; then
                brew install --cask docker
            else
                error "Please install Docker Desktop manually from https://docker.com/products/docker-desktop"
                exit 1
            fi
            ;;
    esac
    
    # Start Docker service
    if [[ "$OS" != "macos" ]]; then
        sudo systemctl start docker 2>/dev/null || true
        sudo systemctl enable docker 2>/dev/null || true
    fi
    
    # Verify installation
    if check_command docker; then
        log "Docker installed successfully: $(docker --version)"
    else
        error "Docker installation failed"
        exit 1
    fi
}

install_nodejs() {
    header "Installing Node.js"
    
    if check_command node; then
        NODE_VERSION=$(node --version)
        log "Node.js already installed: $NODE_VERSION"
        
        # Check version
        MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$MAJOR_VERSION" -lt 18 ]; then
            warn "Node.js version $NODE_VERSION is too old. Need v18+"
        else
            return 0
        fi
    fi
    
    info "Installing Node.js v20 LTS..."
    
    case $OS in
        ubuntu)
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
            
        fedora)
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            sudo dnf install -y nodejs
            ;;
            
        arch)
            sudo pacman -Sy --noconfirm nodejs npm
            ;;
            
        macos)
            if check_command brew; then
                brew install node@20
                brew link --overwrite node@20
            else
                error "Please install Node.js manually from https://nodejs.org"
                exit 1
            fi
            ;;
    esac
    
    if check_command node; then
        log "Node.js installed successfully: $(node --version)"
    else
        error "Node.js installation failed"
        exit 1
    fi
}

install_ollama() {
    header "Installing Ollama"
    
    # Check if Ollama is running in Docker
    if docker ps --format '{{.Names}}' | grep -q "$OLLAMA_CONTAINER"; then
        log "Ollama already running in Docker container"
        return 0
    fi
    
    # Check if Ollama is installed locally
    if check_command ollama; then
        log "Ollama already installed locally: $(ollama --version)"
        return 0
    fi
    
    info "Ollama will be run via Docker (no local installation needed)"
}

# ── Model Management ──────────────────────────────────────────────────
pull_model() {
    header "Pulling LLM Model"
    
    info "Model: ${BOLD}$MODEL_NAME${NC}"
    info "This may take 10-30 minutes depending on your internet speed..."
    info "Model size: ~7.5GB (Q4_K_M quantization)"
    
    # Wait for Ollama to be ready
    info "Waiting for Ollama service to be ready..."
    for i in {1..30}; do
        if docker exec $OLLAMA_CONTAINER ollama list >/dev/null 2>&1; then
            log "Ollama service is ready"
            break
        fi
        if [ $i -eq 30 ]; then
            error "Ollama service failed to start"
            exit 1
        fi
        sleep 2
    done
    
    # Check if model already exists
    if docker exec $OLLAMA_CONTAINER ollama list 2>/dev/null | grep -q "HauhauCS"; then
        log "Model already pulled"
        return 0
    fi
    
    # Pull the model
    info "Pulling model from HuggingFace..."
    docker exec -it $OLLAMA_CONTAINER ollama pull "$MODEL_NAME"
    
    if [ $? -eq 0 ]; then
        log "Model pulled successfully!"
    else
        error "Failed to pull model"
        exit 1
    fi
}

# ── Project Setup ─────────────────────────────────────────────────────
setup_project() {
    header "Setting Up Project"
    
    cd "$PROJECT_DIR"
    
    # Update .env with correct model name
    info "Configuring environment variables..."
    if [ -f .env ]; then
        sed -i.bak "s|^LLM_MODEL=.*|LLM_MODEL=$MODEL_NAME|" .env
        sed -i.bak "s|^LLM_BASE_URL=.*|LLM_BASE_URL=http://ollama:11434/v1|" .env
        rm -f .env.bak
        log "Environment configured"
    else
        error ".env file not found"
        exit 1
    fi
    
    # Install frontend dependencies
    info "Installing frontend dependencies..."
    cd frontend
    if check_command npm; then
        npm install
        log "Frontend dependencies installed"
    else
        error "npm not found"
        exit 1
    fi
    cd ..
    
    # Install backend dependencies
    info "Installing backend dependencies..."
    cd backend
    if check_command pip3; then
        pip3 install -r requirements.txt
        log "Backend dependencies installed"
    else
        warn "pip3 not found - will install in Docker container"
    fi
    cd ..
}

# ── Build & Start Services ────────────────────────────────────────────
start_services() {
    header "Building and Starting Services"
    
    cd "$PROJECT_DIR"
    
    # Build Docker images
    info "Building Docker images..."
    docker-compose build --no-cache
    
    # Start services
    info "Starting services..."
    docker-compose up -d
    
    # Wait for services to be healthy
    info "Waiting for services to start..."
    sleep 10
    
    # Check health
    for i in {1..30}; do
        if curl -s http://localhost:8000/health >/dev/null 2>&1; then
            log "Backend service is healthy"
            break
        fi
        if [ $i -eq 30 ]; then
            warn "Backend service may not be ready yet. Check logs with: docker-compose logs backend"
        fi
        sleep 2
    done
    
    for i in {1..10}; do
        if curl -s http://localhost:3000 >/dev/null 2>&1; then
            log "Frontend service is healthy"
            break
        fi
        if [ $i -eq 10 ]; then
            warn "Frontend service may not be ready yet. Check logs with: docker-compose logs frontend"
        fi
        sleep 2
    done
}

# ── Verification ──────────────────────────────────────────────────────
verify_setup() {
    header "Verifying Setup"
    
    # Check Docker
    if docker ps | grep -q "$OLLAMA_CONTAINER"; then
        log "✓ Ollama container is running"
    else
        error "✗ Ollama container is not running"
        return 1
    fi
    
    # Check Backend
    if curl -s http://localhost:8000/health | grep -q "ok"; then
        log "✓ Backend API is accessible"
    else
        warn "! Backend API may not be ready yet"
    fi
    
    # Check Frontend
    if curl -s http://localhost:3000 >/dev/null 2>&1; then
        log "✓ Frontend is accessible"
    else
        warn "! Frontend may not be ready yet"
    fi
    
    # Check Model
    if docker exec $OLLAMA_CONTAINER ollama list 2>/dev/null | grep -q "HauhauCS"; then
        log "✓ LLM model is loaded"
    else
        warn "! LLM model may not be loaded yet"
    fi
    
    echo ""
}

# ── Main Setup Flow ───────────────────────────────────────────────────
main() {
    # Clear log file
    > "$LOG_FILE"
    
    header "Autonomous AI Agent - Automated Setup"
    
    echo -e "${CYAN}${BOLD}"
    cat << "EOF"
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║   🤖  AUTONOMOUS AI AGENT - AUTO SETUP                   ║
    ║                                                           ║
    ║   This script will:                                       ║
    ║   1. Install Docker (if not installed)                   ║
    ║   2. Install Node.js (if not installed)                  ║
    ║   3. Pull Gemma4-12B Uncensored Model                    ║
    ║   4. Build and start all services                        ║
    ║   5. Verify everything is working                        ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
    
    # Detect OS
    detect_os
    
    # Install dependencies
    install_docker
    install_nodejs
    install_ollama
    
    # Setup project
    setup_project
    
    # Build and start
    start_services
    
    # Pull model (after Ollama is running)
    pull_model
    
    # Verify
    verify_setup
    
    # Final message
    header "Setup Complete!"
    
    echo -e "${GREEN}${BOLD}"
    cat << "EOF"
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║   ✅  SETUP SUCCESSFUL!                                   ║
    ║                                                           ║
    ║   🌐  Frontend:  http://localhost:3000                   ║
    ║   🔧  Backend:   http://localhost:8000                   ║
    ║   📚  API Docs:  http://localhost:8000/docs              ║
    ║   🤖  Ollama:    http://localhost:11434                  ║
    ║                                                           ║
    ║   📖  Open your browser and go to:                       ║
    ║       http://localhost:3000                              ║
    ║                                                           ║
    ║   📝  To view logs:                                      ║
    ║       docker-compose logs -f                             ║
    ║                                                           ║
    ║   🛑  To stop:                                           ║
    ║       docker-compose down                                ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
    
    # Open browser (if possible)
    if [[ "$OS" == "macos" ]]; then
        open http://localhost:3000 2>/dev/null || true
    elif [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "fedora" ]] || [[ "$OS" == "arch" ]]; then
        if check_command xdg-open; then
            xdg-open http://localhost:3000 2>/dev/null || true
        fi
    fi
}

# Run main function
main "$@"

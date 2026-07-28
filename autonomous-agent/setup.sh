#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# Autonomous AI Agent - Setup untuk Linux (Ubuntu/Debian, Fedora, Arch)
#
# Yang dilakukan:
#   1. Cek/instal Docker Engine + plugin compose
#   2. Siapkan file .env (model: dolphin-llama3:8b)
#   3. Pre-pull image ubuntu:22.04 untuk sandbox
#   4. Build & jalankan semua service
#   5. Pull model dolphin-llama3:8b (~4.7GB)
#   6. Verifikasi end-to-end (Ollama -> Backend -> Frontend -> Sandbox)
# ──────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"
cd "$SCRIPT_DIR"

SKIP_MODEL=0
for arg in "$@"; do
  case "$arg" in
    --skip-model) SKIP_MODEL=1 ;;
    -h|--help)
      echo "Usage: ./setup.sh [--skip-model]"
      exit 0
      ;;
  esac
done

echo -e "${BLUE}${BOLD}"
cat << "EOF"
    ╔═══════════════════════════════════════════════════════════╗
    ║        🐬  AUTONOMOUS AI AGENT - SETUP (LINUX)            ║
    ║        Model: dolphin-llama3:8b via Ollama                ║
    ╚═══════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# ── 1. Deteksi OS ─────────────────────────────────────────────────────
header "1/6 Deteksi sistem"
if [[ "$(uname -s)" != "Linux" ]]; then
  error "Skrip ini khusus Linux. Terdeteksi: $(uname -s)"
  exit 1
fi

OS="linux"
if has apt-get; then OS="debian"
elif has dnf; then OS="fedora"
elif has pacman; then OS="arch"
fi
log "OS: $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -sr) (family: $OS)"
log "Arsitektur: $(uname -m)"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if has sudo; then SUDO="sudo"; else
    error "Butuh root atau sudo untuk instalasi paket."
    exit 1
  fi
fi

# ── 2. Docker ─────────────────────────────────────────────────────────
header "2/6 Docker Engine & Compose"
if has docker; then
  log "Docker terpasang: $(docker --version)"
else
  info "Menginstal Docker Engine..."
  case "$OS" in
    debian)
      $SUDO apt-get update -qq
      $SUDO apt-get install -y -qq ca-certificates curl gnupg
      $SUDO install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | $SUDO gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
      $SUDO chmod a+r /etc/apt/keyrings/docker.gpg
      . /etc/os-release
      DISTRO_ID="${ID}"
      [ "$DISTRO_ID" != "ubuntu" ] && [ "$DISTRO_ID" != "debian" ] && DISTRO_ID="ubuntu"
      CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-jammy}}"
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${DISTRO_ID} ${CODENAME} stable" \
        | $SUDO tee /etc/apt/sources.list.d/docker.list > /dev/null
      $SUDO apt-get update -qq
      $SUDO apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
      ;;
    fedora)
      $SUDO dnf -y install dnf-plugins-core
      $SUDO dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
      $SUDO dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
      ;;
    arch)
      $SUDO pacman -Sy --noconfirm docker docker-compose
      ;;
    *)
      error "Distro tidak dikenal. Instal Docker manual: https://docs.docker.com/engine/install/"
      exit 1
      ;;
  esac
  $SUDO systemctl enable --now docker || true
  log "Docker terinstal"
fi

if ! docker info >/dev/null 2>&1; then
  info "Menyalakan service docker..."
  $SUDO systemctl start docker || true
  sleep 2
fi

if ! docker info >/dev/null 2>&1; then
  warn "User $(whoami) belum bisa akses Docker daemon."
  info "Menambahkan user ke grup docker..."
  $SUDO usermod -aG docker "$USER" || true
  error "Logout/login ulang (atau jalankan: newgrp docker) lalu ulangi ./setup.sh"
  exit 1
fi
log "Docker daemon OK"

DOCKER_COMPOSE="$(detect_compose)"
if [ -z "$DOCKER_COMPOSE" ]; then
  info "Menginstal docker compose plugin..."
  case "$OS" in
    debian) $SUDO apt-get install -y -qq docker-compose-plugin ;;
    fedora) $SUDO dnf -y install docker-compose-plugin ;;
    arch)   $SUDO pacman -Sy --noconfirm docker-compose ;;
  esac
  DOCKER_COMPOSE="$(detect_compose)"
fi
[ -z "$DOCKER_COMPOSE" ] && { error "docker compose tidak tersedia"; exit 1; }
log "Compose: $DOCKER_COMPOSE"

# ── 3. Konfigurasi ────────────────────────────────────────────────────
header "3/6 Konfigurasi (.env)"
if [ ! -f .env ]; then
  cp .env.example .env
  log ".env dibuat dari .env.example"
else
  log ".env sudah ada (dipertahankan)"
fi
load_env
MODEL="$(model_name)"
info "Model LLM      : $MODEL"
info "Sandbox image  : ${SANDBOX_IMAGE:-ubuntu:22.04}"

# ── 4. Image sandbox ──────────────────────────────────────────────────
header "4/6 Menyiapkan image sandbox"
SANDBOX_IMG="${SANDBOX_IMAGE:-ubuntu:22.04}"
if docker image inspect "$SANDBOX_IMG" >/dev/null 2>&1; then
  log "Image $SANDBOX_IMG sudah tersedia"
else
  info "Pull $SANDBOX_IMG ..."
  docker pull "$SANDBOX_IMG"
  log "Image sandbox siap"
fi

# ── 5. Build & start ──────────────────────────────────────────────────
header "5/6 Build & menjalankan service"
$DOCKER_COMPOSE build
$DOCKER_COMPOSE up -d ollama
info "Menunggu Ollama siap..."
for i in $(seq 1 60); do
  if docker exec "$OLLAMA_CONTAINER" ollama list >/dev/null 2>&1; then
    log "Ollama siap"
    break
  fi
  [ "$i" -eq 60 ] && { error "Ollama tidak siap"; $DOCKER_COMPOSE logs --tail 40 ollama; exit 1; }
  sleep 2
done

if [ "$SKIP_MODEL" -eq 0 ]; then
  if docker exec "$OLLAMA_CONTAINER" ollama list 2>/dev/null | grep -q "dolphin-llama3"; then
    log "Model $MODEL sudah ada"
  else
    info "Pull model $MODEL (~4.7GB) — bisa 5-30 menit..."
    docker exec "$OLLAMA_CONTAINER" ollama pull "$MODEL"
    log "Model siap"
  fi
else
  warn "Pull model dilewati (--skip-model). Jalankan ./pull-model.sh nanti."
fi

$DOCKER_COMPOSE up -d backend frontend
info "Menunggu backend & frontend..."
sleep 5

# ── 6. Verifikasi ─────────────────────────────────────────────────────
header "6/6 Verifikasi"
"${SCRIPT_DIR}/test.sh" || warn "Beberapa test gagal — cek ./logs.sh"

echo -e "${GREEN}${BOLD}"
cat << "EOF"
    ╔═══════════════════════════════════════════════════════════╗
    ║   ✅  SETUP SELESAI                                       ║
    ║                                                           ║
    ║   🌐  Frontend : http://localhost:3000                    ║
    ║   🔧  Backend  : http://localhost:8000/health             ║
    ║   🤖  Ollama   : http://localhost:11434                   ║
    ║                                                           ║
    ║   ./quick-start.sh  start      ./stop.sh   stop           ║
    ║   ./status.sh       status     ./logs.sh   logs           ║
    ║   ./test.sh         self-test  ./pull-model.sh  model     ║
    ╚═══════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# 📦 Panduan Instalasi Detail (Linux)

## Opsi A — Otomatis (disarankan)
```bash
chmod +x *.sh
./setup.sh              # atau: ./setup.sh --skip-model
```

## Opsi B — Manual

### 1. Docker Engine
Ubuntu/Debian:
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $UBUNTU_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER && newgrp docker
```

### 2. Konfigurasi
```bash
cp .env.example .env
$EDITOR .env
```

### 3. Build & jalankan
```bash
docker pull ubuntu:22.04
docker compose build
docker compose up -d ollama
docker exec agent-ollama ollama pull dolphin-llama3:8b
docker compose up -d backend frontend
```

### 4. Verifikasi
```bash
./test.sh
curl -s localhost:8000/health | jq
xdg-open http://localhost:3000
```

## Development tanpa Docker

Backend:
```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r backend/requirements.txt
export LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=dolphin-llama3:8b
cd backend && uvicorn main:app --reload --port 8000
```
(Docker daemon host harus dapat diakses user yang menjalankan backend.)

Frontend:
```bash
cd frontend
npm install
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000 NEXT_PUBLIC_WS_URL=ws://localhost:8000 npm run dev
```

Ollama native (tanpa container):
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull dolphin-llama3:8b
ollama serve
```

## Uninstall
```bash
./stop.sh --volumes
docker rmi autonomous-agent-backend autonomous-agent-frontend ollama/ollama ubuntu:22.04
```

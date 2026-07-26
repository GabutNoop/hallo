# 🚀 Quick Start Guide

## autonomous AI Agent dengan Auto-Setup

Sistem ini sudah **100% otomatis** - tinggal jalankan satu perintah dan semuanya akan ter-install dan ter-configure sendiri!

---

## 📋 Persyaratan

Sebelum memulai, pastikan Anda memiliki:

- **OS**: Linux (Ubuntu/Debian/Fedora/Arch) atau macOS
- **RAM**: Minimal 8GB (16GB recommended)
- **Storage**: Minimal 20GB free space
- **Internet**: Untuk download model (~7.5GB)
- **GPU**: Optional, tapi sangat recommended untuk performa

---

## 🎯 Quick Start (3 Langkah)

### 1️⃣ Install Otomatis

```bash
cd autonomous-agent
./setup.sh
```

Script ini akan **otomatis**:
- ✅ Install Docker (jika belum ada)
- ✅ Install Node.js (jika belum ada)
- ✅ Pull model LLM (~7.5GB)
- ✅ Build semua Docker containers
- ✅ Start semua services
- ✅ Verify semua berjalan

**Durasi**: 15-45 menit (tergantung kecepatan internet)

### 2️⃣ Tunggu Selesai

Setup akan menampilkan progress:
```
═══════════════════════════════════════════════════════════
  🤖  AUTONOMOUS AI AGENT - AUTO SETUP
═══════════════════════════════════════════════════════════

[✓] Detected OS: ubuntu
[✓] Docker already installed
[✓] Node.js already installed
[i] Installing frontend dependencies...
[✓] Frontend dependencies installed
[i] Building Docker images...
[✓] Backend service is healthy
[✓] Frontend service is healthy
[i] Pulling model (this may take 10-30 minutes)...
[✓] Model pulled successfully!
[✓] ✓ Ollama container is running
[✓] ✓ Backend API is accessible
[✓] ✓ Frontend is accessible
[✓] ✓ LLM model is loaded

═══════════════════════════════════════════════════════════
  ✅  SETUP SUCCESSFUL!
═══════════════════════════════════════════════════════════

  🌐  Frontend:  http://localhost:3000
  🔧  Backend:   http://localhost:8000
  📚  API Docs:  http://localhost:8000/docs
  🤖  Ollama:    http://localhost:11434

  📖  Open your browser and go to:
      http://localhost:3000
```

### 3️⃣ Buka Browser

```
http://localhost:3000
```

**Selesai!** Anda sudah bisa menggunakan AI Agent! 🎉

---

## 🎮 Cara Menggunakan

### Berikan Task ke AI Agent

Di panel chat (kiri), ketik task dalam bahasa natural:

**Contoh Task:**
```
1. "Install Node.js dan buat Express server dengan REST API"
2. "Setup PostgreSQL database dan buat tabel users"
3. "Install Python Flask dan buat web scraper"
4. "Configure Nginx sebagai reverse proxy"
5. "Deploy a simple React app with npm"
```

### Lihat Real-Time Logs

Di panel kanan (terminal), Anda akan melihat:
- 🧠 **Reasoning** - AI sedang berpikir
- 🔍 **Search** - AI mencari informasi di web
- 💻 **Execute** - AI menjalankan command di sandbox
- 📝 **Write** - AI menulis file
- 🔧 **Self-Correct** - AI memperbaiki error
- ✅ **Success** - Task selesai!

### Contoh Screenshot

```
[12:34:56] 🧠 Step 1: AI is thinking...
[12:35:02] 🔍 google_search: Query: "how to create Express REST API"
           [Show output (1245 chars)]
[12:35:15] 💻 execute_in_sandbox: $ apt-get install -y nodejs npm
           [Show output (892 chars)]
[12:35:28] 💻 execute_in_sandbox: $ npm install express
           [Show output (567 chars)]
[12:35:42] 📝 write_file_in_sandbox: Writing to: /workspace/server.js
[12:35:45] 💻 execute_in_sandbox: $ node server.js
           [Show output (123 chars)]
[12:35:48] ✅ Task completed successfully!
```

---

## 🛠️ Helper Scripts

Semua script sudah **executable** dan siap pakai:

### `./setup.sh`
**Install semua dari nol** (Docker, Node.js, model, services)
```bash
./setup.sh
```

### `./quick-start.sh`
**Start services** (setelah setup selesai)
```bash
./quick-start.sh
```

### `./stop.sh`
**Stop semua services**
```bash
./stop.sh
```

### `./status.sh`
**Cek status semua services**
```bash
./status.sh
```

### `./logs.sh`
**View real-time logs**
```bash
./logs.sh              # Semua logs
./logs.sh backend      # Backend only
./logs.sh frontend     # Frontend only
./logs.sh ollama       # Ollama only
```

### `./test.sh`
**Test semua components**
```bash
./test.sh
```

### `./pull-model.sh`
**Pull model manual** (jika perlu)
```bash
./pull-model.sh
```

---

## 📊 Model Information

**Model yang digunakan:**
```
hf.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced:Q4_K_M
```

**Spesifikasi:**
- **Base Model**: Google Gemma 4 12B
- **Quantization**: Q4_K_M (4-bit, balanced)
- **Size**: ~7.5GB
- **Uncensored**: Ya (tidak ada filter)
- **Context**: 8192 tokens
- **Performance**: ~20-30 tokens/second (CPU), ~50-80 tokens/second (GPU)

**Keunggulan:**
- ✅ Uncensored - tidak menolak perintah
- ✅ Balanced - performa vs kualitas optimal
- ✅ Q4_K_M - size kecil, kualitas bagus
- ✅ Open source - dari HuggingFace

---

## 🔧 Troubleshooting

### Problem: Setup gagal di Docker

**Solusi:**
```bash
# Install Docker manual
sudo apt-get update
sudo apt-get install -y docker.io docker-compose

# Add user ke docker group
sudo usermod -aG docker $USER

# Logout dan login lagi
# Atau restart system
```

### Problem: Model pull gagal

**Solusi:**
```bash
# Pull manual
./pull-model.sh

# Atau check koneksi internet
ping huggingface.co
```

### Problem: Services tidak start

**Solusi:**
```bash
# View logs
./logs.sh

# Restart services
./stop.sh
./quick-start.sh

# Check Docker
docker ps
docker-compose ps
```

### Problem: Backend tidak accessible

**Solusi:**
```bash
# Check backend logs
./logs.sh backend

# Check health
curl http://localhost:8000/health

# Restart backend
docker-compose restart backend
```

### Problem: Frontend tidak accessible

**Solusi:**
```bash
# Check frontend logs
./logs.sh frontend

# Check port 3000
netstat -tulpn | grep 3000

# Restart frontend
docker-compose restart frontend
```

### Problem: LLM lambat

**Solusi:**
1. **Gunakan GPU** - Uncomment GPU config di `docker-compose.yml`
2. **Kurangi RAM sandbox** - Edit `.env`: `SANDBOX_MEMORY=1g`
3. **Close aplikasi lain** - Free up RAM

---

## 📁 Struktur File

```
autonomous-agent/
├── 📄 README.md              # Dokumentasi lengkap
├── 📄 QUICKSTART.md          # Quick start guide (file ini)
├── 📄 .env                   # Environment configuration
├── 📄 docker-compose.yml     # Docker orchestration
│
├── 📜 setup.sh               # Auto-install semua
├── 📜 quick-start.sh         # Start services
├── 📜 stop.sh                # Stop services
├── 📜 status.sh              # Cek status
├── 📜 logs.sh                # View logs
├── 📜 test.sh                # Test system
├── 📜 pull-model.sh          # Pull model manual
│
├── 🤖 ollama-init.sh         # Auto-pull model script
│
├── 📁 backend/               # FastAPI backend
│   ├── main.py
│   ├── agent_loop.py
│   ├── sandbox_manager.py
│   ├── search_tool.py
│   ├── llm_client.py
│   └── requirements.txt
│
└── 📁 frontend/              # Next.js frontend
    ├── app/
    │   ├── page.tsx
    │   ├── layout.tsx
    │   └── globals.css
    └── components/
        ├── ChatPanel.tsx
        └── LiveTerminalLog.tsx
```

---

## 🎯 Penggunaan Lanjutan

### Custom Configuration

Edit `.env` untuk custom settings:

```bash
# Model configuration
LLM_MODEL=hf.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced:Q4_K_M

# Sandbox configuration
SANDBOX_MEMORY=4g          # Increase RAM
SANDBOX_CPU=4.0            # Increase CPU cores
COMMAND_TIMEOUT=120        # Increase timeout

# Agent configuration
MAX_RETRIES=10             # More retries
SEARCH_MAX_RESULTS=10      # More search results
```

### GPU Acceleration

Edit `docker-compose.yml`, uncomment GPU section:

```yaml
ollama:
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: all
            capabilities: [gpu]
```

Then restart:
```bash
./stop.sh
./quick-start.sh
```

### Access API Directly

**Backend API:**
```bash
# Health check
curl http://localhost:8000/health

# Create session
curl -X POST http://localhost:8000/sessions

# Check session status
curl http://localhost:8000/sessions/{session_id}/status
```

**API Documentation:**
```
http://localhost:8000/docs
```

### View Container Logs

```bash
# All containers
docker-compose logs -f

# Specific container
docker logs -f agent-ollama
docker logs -f agent-backend
docker logs -f agent-frontend
```

### Manual Model Management

```bash
# List models
docker exec agent-ollama ollama list

# Remove model
docker exec agent-ollama ollama rm hf.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced:Q4_K_M

# Pull again
docker exec -it agent-ollama ollama pull hf.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced:Q4_K_M
```

---

## 📈 Performance Tips

### 1. Gunakan GPU
Jika punya NVIDIA GPU, enable di `docker-compose.yml` untuk 3-5x speedup.

### 2. Optimize RAM
- Minimum: 8GB RAM
- Recommended: 16GB RAM
- Optimal: 32GB RAM (untuk multitasking)

### 3. SSD Storage
Gunakan SSD untuk faster model loading dan container startup.

### 4. Close Unnecessary Apps
Free up RAM dan CPU untuk better performance.

### 5. Network
Stable internet connection untuk model pull dan web search.

---

## 🔒 Security Notes

⚠️ **WARNING**: Sistem ini menjalankan AI-generated code dengan root access!

**Safety Measures:**
- ✅ Isolated Docker containers
- ✅ Memory/CPU limits
- ✅ Automatic cleanup
- ✅ Command timeout

**Risks:**
- ⚠️ Agent bisa execute ANY command (dalam container)
- ⚠️ Network access untuk download code
- ⚠️ Uncensored model bisa generate dangerous commands

**Recommendations:**
- 🛡️ Run di isolated environment (VM, cloud)
- 🛡️ Monitor agent activities
- 🛡️ Limit network access jika tidak perlu
- 🛡️ Gunakan untuk development/testing saja

---

## 🆘 Support

**Documentation:**
- `README.md` - Complete documentation
- `QUICKSTART.md` - Quick start guide (file ini)

**Logs:**
```bash
./logs.sh              # Real-time logs
./status.sh            # System status
./test.sh              # Test all components
```

**Common Issues:**
- Check `README.md` → Troubleshooting section
- View logs: `./logs.sh`
- Test system: `./test.sh`

---

## 🎉 You're All Set!

Sekarang Anda sudah punya **Autonomous AI Agent** yang fully functional!

**Next Steps:**
1. ✅ Run `./setup.sh` (jika belum)
2. ✅ Run `./quick-start.sh`
3. ✅ Open `http://localhost:3000`
4. ✅ Start giving tasks to the AI!

**Enjoy!** 🚀

---

**Built with ❤️ by Arena.ai**

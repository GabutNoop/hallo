# 🤖 Autonomous AI Agent

**Sistem AI Agent otonom dengan web interface, Docker sandbox, dan self-correcting loop.**

![Architecture](https://img.shields.io/badge/Architecture-ReAct%20Loop-blue)
![Sandbox](https://img.shields.io/badge/Sandbox-Docker%20Isolated-green)
![LLM](https://img.shields.io/badge/LLM-Gemma4--12B--Uncensored-purple)
![Auto-Setup](https://img.shields.io/badge/Setup-100%25%20Automatic-brightgreen)

---

## 🚀 Quick Start (30 Detik!)

### One-Liner Installation

```bash
cd autonomous-agent && ./setup.sh
```

**Itu saja!** Script akan otomatis:
- ✅ Install Docker & Node.js (jika perlu)
- ✅ Pull model LLM (~7.5GB)
- ✅ Build & start semua services
- ✅ Buka browser di http://localhost:3000

**Selesai!** Anda bisa langsung gunakan AI Agent! 🎉

---

## 📖 Dokumentasi

| File | Deskripsi |
|------|-----------|
| **[QUICKSTART.md](QUICKSTART.md)** | 🚀 **MULAI DARI SINI** - Panduan lengkap quick start |
| [README.md](README.md) | 📘 Dokumentasi teknis lengkap (file ini) |

---

## 🎯 Fitur Utama

### 🧠 Self-Correcting Agentic Loop
- **Reason** → **Search** → **Execute** → **Observe** → **Self-Correct**
- Hingga 5x retry otomatis saat error
- Web search untuk solusi error
- State tracking per session

### 🐳 Docker Sandbox
- Isolated container per session
- Root access penuh
- Resource limits (2GB RAM, 2 CPU)
- Automatic cleanup

### 🌐 Real-Time Web Interface
- Split-screen: Chat + Live Terminal
- Streaming logs dengan emoji indicators
- Auto-scroll dengan manual override
- Responsive design

### 🔧 Tools yang Tersedia
- `google_search()` - Web search (DuckDuckGo)
- `execute_in_sandbox()` - Shell execution
- `write_file_in_sandbox()` - File creation
- `read_file_in_sandbox()` - File reading

---

## 🏗️ Arsitektur

```
┌─────────────────────────────────────────────────────────────┐
│                      USER BROWSER                            │
│  ┌──────────────┐              ┌──────────────────────┐    │
│  │  Chat Panel  │              │  Live Terminal Log   │    │
│  │  (Left)      │              │  (Right)             │    │
│  └──────┬───────┘              └──────────▲───────────┘    │
└─────────┼─────────────────────────────────┼─────────────────┘
          │ WebSocket                       │ Socket.IO Stream
          │                                 │
┌─────────▼─────────────────────────────────┼─────────────────┐
│                 BACKEND (FastAPI)                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Agent Loop (ReAct Pattern)                  │   │
│  │  Reason → Search → Execute → Observe → Self-Correct  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────────┐    │
│  │ LLM      │  │ Search   │  │ Sandbox Manager        │    │
│  │ Client   │  │ Tool     │  │ (Docker SDK)           │    │
│  └──────────┘  └──────────┘  └────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
                                                    │
                                                    ▼
                                            ┌──────────────┐
                                            │   Docker     │
                                            │   Container  │
                                            │  (Ubuntu +   │
                                            │   Root)      │
                                            └──────────────┘
```

---

## 📁 Struktur Proyek

```
autonomous-agent/
├── 📄 README.md              # Dokumentasi ini
├── 📄 QUICKSTART.md          # 🚀 Quick start guide
├── 📄 .env                   # Environment config
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
├── 🤖 ollama-init.sh         # Auto-pull model
│
├── 📁 backend/               # FastAPI
│   ├── main.py               # Entry point + WebSocket
│   ├── agent_loop.py         # ⭐ Self-correcting loop
│   ├── sandbox_manager.py    # Docker wrapper
│   ├── search_tool.py        # DuckDuckGo search
│   ├── llm_client.py         # OpenAI-compatible client
│   └── requirements.txt
│
└── 📁 frontend/              # Next.js
    ├── app/
    │   ├── page.tsx          # Main UI
    │   ├── layout.tsx
    │   └── globals.css
    └── components/
        ├── ChatPanel.tsx     # Chat interface
        └── LiveTerminalLog.tsx  # Terminal log
```

---

## 🎮 Cara Menggunakan

### 1. Start Services

```bash
./quick-start.sh
```

### 2. Buka Browser

```
http://localhost:3000
```

### 3. Berikan Task

Di chat panel, ketik task:

```
"Install Node.js dan buat Express server dengan REST API"
```

### 4. Lihat Progress

Di terminal panel, lihat real-time logs:
- 🧠 Reasoning
- 🔍 Searching
- 💻 Executing
- 📝 Writing files
- 🔧 Self-correcting
- ✅ Success!

---

## 🛠️ Helper Scripts

| Script | Fungsi |
|--------|--------|
| `./setup.sh` | Install semua dari nol |
| `./quick-start.sh` | Start services |
| `./stop.sh` | Stop services |
| `./status.sh` | Cek status system |
| `./logs.sh [service]` | View logs (all/backend/frontend/ollama) |
| `./test.sh` | Test semua components |
| `./pull-model.sh` | Pull model manual |

---

## 🔧 Configuration

Edit `.env` untuk custom settings:

```bash
# Model
LLM_MODEL=hf.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced:Q4_K_M

# Sandbox
SANDBOX_MEMORY=4g
SANDBOX_CPU=4.0
COMMAND_TIMEOUT=120

# Agent
MAX_RETRIES=10
```

---

## 📊 Model Information

**Model:** `hf.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced:Q4_K_M`

- **Base:** Google Gemma 4 12B
- **Quantization:** Q4_K_M (4-bit)
- **Size:** ~7.5GB
- **Uncensored:** ✅ Yes
- **Context:** 8192 tokens

---

## 🔒 Security

⚠️ **WARNING:** Sistem ini menjalankan AI-generated code dengan root access!

**Safety:**
- ✅ Isolated Docker containers
- ✅ Resource limits
- ✅ Automatic cleanup
- ✅ Command timeout

**Recommendations:**
- 🛡️ Run di isolated environment
- 🛡️ Monitor agent activities
- 🛡️ Untuk development/testing saja

---

## 🐛 Troubleshooting

### Setup gagal?
```bash
# Check logs
./logs.sh

# Test system
./test.sh

# View status
./status.sh
```

### Services tidak start?
```bash
# Restart
./stop.sh
./quick-start.sh
```

### Model tidak loaded?
```bash
# Pull manual
./pull-model.sh
```

**Lihat [QUICKSTART.md](QUICKSTART.md) untuk troubleshooting lengkap.**

---

## 📈 Performance

**Typical Task Time:**
- Simple (install package): 10-30s
- Medium (create server): 1-3min
- Complex (full app): 5-10min

**Resource Usage:**
- LLM: 8-12GB RAM (CPU), 4-6GB VRAM (GPU)
- Backend: ~200MB RAM
- Sandbox: ~500MB RAM per container
- Frontend: ~100MB RAM

---

## 🚧 Roadmap

- [ ] Multi-agent collaboration
- [ ] Persistent file system
- [ ] Custom tool creation
- [ ] Task templates
- [ ] Browser automation
- [ ] Code review suggestions

---

## 📝 License

MIT License - Use at your own risk.

---

## 🙏 Acknowledgments

- **HauhauCS** - Uncensored Gemma4-12B model
- **Ollama** - LLM deployment
- **Docker** - Sandbox isolation
- **DuckDuckGo** - Free web search

---

**Built with ❤️ by Arena.ai**

# 🐬 Autonomous AI Agent — Dolphin 2.9 Llama 3

Agent AI otonom yang **berpikir → mencari → mengeksekusi perintah di sandbox Docker Ubuntu → mengoreksi diri sendiri saat error**, dengan UI chat real-time dan terminal log live.

| Layer | Teknologi |
|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind + Framer Motion |
| Backend | FastAPI + WebSocket native + Docker SDK |
| LLM | **Ollama — `dolphin-llama3:8b`** |
| Sandbox | Container Docker `ubuntu:22.04` (root, terisolasi per session) |
| Search | DuckDuckGo (tanpa API key) |

---

## 🤖 Model: Dolphin 2.9 Llama 3

Dolphin 2.9 adalah model dari **Eric Hartford, Lucas Atkins, Fernando Fernandes & Cognitive Computations**, berbasis **Llama 3**, dengan kemampuan instruksi, percakapan, dan coding, plus kemampuan agentic awal & function calling.

| Atribut | Nilai |
|---|---|
| Tag | `dolphin-llama3:8b` |
| Arsitektur | llama |
| Parameter | 8.03B |
| Kuantisasi | Q4_0 |
| Ukuran | 4.7 GB |
| Template | ChatML (`<|im_start|>` / `<|im_end|>`) |
| System prompt | "You are Dolphin, a helpful AI assistant." |
| Lisensi | META LLAMA 3 COMMUNITY LICENSE |

**Ukuran lain:** `dolphin-llama3:8b` · `dolphin-llama3:70b`

**Context window 256K** (butuh RAM ≥ 64 GB):

```bash
# CLI
ollama run dolphin-llama3:8b-256k
>>> /set parameter num_ctx 256000
```

```bash
# API
curl http://localhost:11434/api/generate -d '{
  "model": "dolphin-llama3:8b-256k",
  "prompt": "Why is the sky blue?",
  "options": { "num_ctx": 256000 }
}'
```

Untuk memakai varian 256k di proyek ini, ubah `.env`:

```ini
LLM_MODEL=dolphin-llama3:8b-256k
LLM_NUM_CTX=256000
```

Referensi: [HuggingFace — cognitivecomputations/dolphin-2.9-llama3-8b](https://huggingface.co/cognitivecomputations/dolphin-2.9-llama3-8b) · [Ollama library](https://ollama.com/library/dolphin-llama3)

> ⚠️ Dolphin adalah model **uncensored** — dataset difilter dari alignment/bias sehingga lebih patuh. Kamu bertanggung jawab penuh atas apa pun yang dihasilkan dan dijalankannya. Selalu jalankan di mesin/VM yang kamu kontrol.

---

## 🚀 Instalasi Cepat (Ubuntu / Debian / Fedora / Arch)

```bash
git clone <repo-url>
cd autonomous-agent
chmod +x *.sh
./setup.sh
```

`setup.sh` akan: instal Docker + compose → siapkan `.env` → pull `ubuntu:22.04` → build image → jalankan Ollama → pull `dolphin-llama3:8b` (4.7 GB) → jalankan backend & frontend → verifikasi end-to-end.

Buka **http://localhost:3000**

Kalau ingin menyiapkan stack dulu tanpa mengunduh model:

```bash
./setup.sh --skip-model
./pull-model.sh          # nanti, saat siap
```

---

## 🧭 Skrip Operasional

| Skrip | Fungsi |
|---|---|
| `./setup.sh` | Instalasi penuh dari nol |
| `./quick-start.sh` | Jalankan semua service |
| `./stop.sh` | Hentikan service (+ bersihkan sandbox); `--volumes` juga hapus model |
| `./status.sh` | Status Docker, Ollama, model, backend, frontend, sandbox, resource |
| `./logs.sh [all\|backend\|frontend\|ollama]` | Log real-time |
| `./pull-model.sh [model]` | Pull/ganti model LLM |
| `./test.sh` | Test end-to-end seluruh rantai |

---

## 🔌 Arsitektur & Alur Koneksi

```
Browser (Next.js :3000)
   │  1. POST /sessions            → backend membuat sandbox Ubuntu
   │  2. WebSocket ws://:8000/ws/{session_id}
   ▼
Backend FastAPI (:8000)
   ├── AgentLoop  ──HTTP /v1/chat/completions──►  Ollama (:11434)  [dolphin-llama3:8b]
   ├── SandboxManager ──/var/run/docker.sock──►  Container ubuntu:22.04 (root)
   └── SearchTool ─────────────────────────────►  DuckDuckGo
```

Semua progres (thought, tool call, output perintah, retry, jawaban akhir) di-stream sebagai event JSON lewat satu WebSocket, lalu ditampilkan di panel chat dan terminal log.

### Protokol WebSocket

Client → Server:
```json
{"type": "task",   "task": "Install nginx dan tampilkan versinya"}
{"type": "cancel"}
{"type": "ping"}
```

Server → Client:
```json
{"type": "session_ready", "session_id": "...", "sandbox": true, "message": "..."}
{"type": "status",  "state": "reasoning", "message": "🧠 ..."}
{"type": "thought", "step": 1, "content": "..."}
{"type": "tool_execution", "step": 1, "tool": "execute_in_sandbox",
 "input": {"command": "..."}, "output": "...", "success": true, "exit_code": 0}
{"type": "final_answer", "answer": "...", "total_steps": 4, "retries": 1}
{"type": "error", "message": "..."}
```

### REST API

| Method | Endpoint | Fungsi |
|---|---|---|
| GET | `/health` | Status LLM + Docker + jumlah session |
| GET | `/config` | Konfigurasi aktif |
| POST | `/sessions` | Buat session + sandbox |
| GET | `/sessions` | Daftar session & sandbox |
| GET | `/sessions/{id}/status` | Status agent |
| GET | `/sessions/{id}/sandbox` | Info container |
| POST | `/sessions/{id}/exec` | Jalankan perintah manual di sandbox |
| POST | `/tasks` | Jalankan task sinkron (tanpa WebSocket) |
| DELETE | `/sessions/{id}` | Hapus session + sandbox |

---

## 🛠️ Tool yang Dimiliki Agent

| Tool | Fungsi |
|---|---|
| `google_search(query)` | Cari informasi/solusi error di web |
| `execute_in_sandbox(command)` | Jalankan bash sebagai root di Ubuntu sandbox |
| `write_file_in_sandbox(path, content)` | Buat/timpa file (via tar, aman untuk semua karakter) |
| `read_file_in_sandbox(path)` | Baca file |
| `list_files_in_sandbox(path)` | Listing direktori |

**Self-correction:** ketika perintah gagal (exit code ≠ 0), agent otomatis membaca error → mencari solusinya di web → mencoba pendekatan lain, hingga `MAX_RETRIES` (default 5).

**Dual protocol:** kalau server/model mendukung native tool calling, itu yang dipakai; kalau tidak (kasus `dolphin-llama3` dengan template ChatML), agent otomatis fallback ke protokol JSON:

```json
{"thought": "...", "action": "execute_in_sandbox", "action_input": {"command": "ls -la"}}
{"thought": "...", "final_answer": "..."}
```

---

## ⚙️ Konfigurasi (`.env`)

```ini
LLM_BASE_URL=http://ollama:11434/v1
LLM_MODEL=dolphin-llama3:8b
LLM_API_KEY=ollama
LLM_MAX_TOKENS=2048
LLM_NUM_CTX=0              # >0 memaksa context window (mis. 256000)

SANDBOX_IMAGE=ubuntu:22.04
SANDBOX_MEMORY=2g
SANDBOX_CPU=2.0
COMMAND_TIMEOUT=120

MAX_RETRIES=5
MAX_STEPS=25
SEARCH_MAX_RESULTS=5

NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

> Mengakses dari mesin lain? Ganti `localhost` pada `NEXT_PUBLIC_*` dengan IP server, lalu `docker compose up -d --build frontend` (nilai `NEXT_PUBLIC_*` ikut di-bake saat build).

### GPU NVIDIA (opsional)

Instal `nvidia-container-toolkit`, lalu buka komentar blok `deploy.resources` pada service `ollama` di `docker-compose.yml` dan jalankan `./quick-start.sh`.

---

## 💻 Kebutuhan Sistem

| | Minimum | Rekomendasi |
|---|---|---|
| OS | Linux x86_64 (Ubuntu 20.04+) | Ubuntu 22.04 / 24.04 |
| RAM | 8 GB | 16 GB+ |
| Disk | 20 GB | 40 GB+ |
| CPU | 4 core | 8 core / GPU NVIDIA |

`dolphin-llama3:8b` (Q4_0) butuh ± 6 GB RAM saat inferensi. Varian 256k butuh ≥ 64 GB.

---

## 🧪 Testing

```bash
# End-to-end (butuh stack berjalan)
./test.sh

# Unit + integration test backend (tanpa Docker & Ollama)
python3 -m venv .venv && . .venv/bin/activate
pip install -r backend/requirements.txt pytest pytest-asyncio
pytest backend/tests -q

# Frontend
cd frontend && npm install && npm run typecheck && npm run build
```

---

## 🐞 Troubleshooting

| Gejala | Solusi |
|---|---|
| `permission denied /var/run/docker.sock` | `sudo usermod -aG docker $USER && newgrp docker` |
| Health `docker.healthy=false` | Pastikan `/var/run/docker.sock` ter-mount di service backend |
| Health `llm.healthy=false`, `server_alive=true` | Model belum ada → `./pull-model.sh` |
| UI "Terputus — reconnect…" | Backend belum siap: `./logs.sh backend`; cek `NEXT_PUBLIC_WS_URL` |
| Model jawab tanpa memanggil tool | Wajar untuk model 8B; ulangi dengan instruksi lebih spesifik |
| Perintah timeout | Naikkan `COMMAND_TIMEOUT` di `.env`, lalu `./quick-start.sh` |
| Ollama OOM | Kurangi `LLM_MAX_TOKENS` / gunakan mesin dengan RAM lebih besar |

---

## 📁 Struktur

```
autonomous-agent/
├── backend/
│   ├── main.py              # FastAPI: REST + WebSocket
│   ├── agent_loop.py        # ReAct loop + self-correction + parser JSON/native
│   ├── llm_client.py        # Client Ollama (dolphin-llama3:8b)
│   ├── sandbox_manager.py   # Docker SDK: create/exec/write/read/destroy
│   ├── search_tool.py       # DuckDuckGo + fallback HTML
│   └── tests/               # pytest (tanpa Docker/Ollama)
├── frontend/
│   ├── app/page.tsx         # Split view: chat + terminal live
│   ├── components/          # ChatPanel, LiveTerminalLog
│   └── lib/                 # useAgentSocket (WebSocket native), types
├── docker-compose.yml
├── lib.sh                   # helper bersama semua skrip
└── setup.sh quick-start.sh stop.sh status.sh logs.sh pull-model.sh test.sh
```

---

## ⚖️ Lisensi & Tanggung Jawab

Model tunduk pada **META LLAMA 3 COMMUNITY LICENSE**. Agent ini menjalankan perintah shell sebagai root di dalam container — jangan pernah memaparkan port 8000/3000 ke internet publik tanpa autentikasi, dan jalankan hanya di lingkungan yang kamu kontrol.

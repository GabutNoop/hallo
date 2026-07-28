# ⚡ Quick Start — 5 Menit

## 1. Prasyarat
Linux x86_64 (Ubuntu 22.04 disarankan), RAM ≥ 8 GB, disk ≥ 20 GB, koneksi internet.

## 2. Jalankan
```bash
cd autonomous-agent
chmod +x *.sh
./setup.sh
```

Setup akan otomatis:
1. Instal Docker Engine + compose plugin (kalau belum ada)
2. Membuat `.env` dari `.env.example`
3. Pull image sandbox `ubuntu:22.04`
4. Build backend + frontend
5. Pull model **`dolphin-llama3:8b`** (~4.7 GB)
6. Menjalankan `./test.sh` untuk verifikasi

Buka **http://localhost:3000**

## 3. Coba tugas pertama
Ketik di panel chat:

```
Cek versi Ubuntu, CPU, dan memori di sandbox
```

```
Install Python FastAPI, buat app hello world, jalankan, lalu tes dengan curl
```

Panel kanan menampilkan setiap langkah agent: 🧠 berpikir · 🔍 mencari · 💻 menjalankan perintah · 🔧 memperbaiki error · ✅ selesai.

## 4. Perintah harian
```bash
./quick-start.sh   # start
./status.sh        # cek kesehatan semua service
./logs.sh backend  # lihat log
./stop.sh          # stop
./test.sh          # test end-to-end
```

## 5. Kalau ada masalah
```bash
./status.sh                 # lihat komponen mana yang merah
curl -s localhost:8000/health | jq
./logs.sh backend
```

| Masalah | Perbaikan |
|---|---|
| Docker permission denied | `sudo usermod -aG docker $USER && newgrp docker` |
| Model belum ada | `./pull-model.sh` |
| Backend degraded | `./logs.sh backend` lalu `./quick-start.sh` |
| Port bentrok | Ubah mapping port di `docker-compose.yml` |

## 6. Ganti model
```bash
# 70B (butuh RAM/GPU besar)
./pull-model.sh dolphin-llama3:70b

# Context 256K (butuh RAM >= 64GB) - lalu set di .env:
#   LLM_MODEL=dolphin-llama3:8b-256k
#   LLM_NUM_CTX=256000
./pull-model.sh dolphin-llama3:8b-256k
```
Setelah mengubah `.env`: `./quick-start.sh`

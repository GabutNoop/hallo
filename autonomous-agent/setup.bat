@echo off
setlocal enabledelayedexpansion

REM ──────────────────────────────────────────────────────────────────────
REM Autonomous AI Agent - Automated Setup Script for Windows
REM Auto-install semua dependencies, pull model, dan jalankan sistem
REM ──────────────────────────────────────────────────────────────────────

set "MODEL_NAME=hf.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced:Q4_K_M"
set "OLLAMA_CONTAINER=agent-ollama"
set "PROJECT_DIR=%~dp0"
set "LOG_FILE=%PROJECT_DIR%setup.log"

REM ── Colors (Windows 10+) ─────────────────────────────────────────────
for /F %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "GREEN=%ESC%[92m"
set "YELLOW=%ESC%[93m"
set "RED=%ESC%[91m"
set "BLUE=%ESC%[94m"
set "PURPLE=%ESC%[95m"
set "CYAN=%ESC%[96m"
set "NC=%ESC%[0m"
set "BOLD=%ESC%[1m"

REM ── Helper Functions ─────────────────────────────────────────────────
:log
echo %GREEN%[✓]%NC% %~1 >> "%LOG_FILE%"
echo %GREEN%[✓]%NC% %~1
goto :eof

:warn
echo %YELLOW%[!]%NC% %~1 >> "%LOG_FILE%"
echo %YELLOW%[!]%NC% %~1
goto :eof

:error
echo %RED%[✗]%NC% %~1 >> "%LOG_FILE%"
echo %RED%[✗]%NC% %~1
goto :eof

:info
echo %BLUE%[i]%NC% %~1 >> "%LOG_FILE%"
echo %BLUE%[i]%NC% %~1
goto :eof

:header
echo. >> "%LOG_FILE%"
echo %PURPLE%%BOLD%═══════════════════════════════════════════════════════════%NC% >> "%LOG_FILE%"
echo %PURPLE%%BOLD%  %~1%NC% >> "%LOG_FILE%"
echo %PURPLE%%BOLD%═══════════════════════════════════════════════════════════%NC% >> "%LOG_FILE%"
echo.
echo %PURPLE%%BOLD%═══════════════════════════════════════════════════════════%NC%
echo %PURPLE%%BOLD%  %~1%NC%
echo %PURPLE%%BOLD%═══════════════════════════════════════════════════════════%NC%
goto :eof

REM ── Main Setup Flow ──────────────────────────────────────────────────
call :header "Autonomous AI Agent - Automated Setup (Windows)"

echo %CYAN%%BOLD%
echo ╔═══════════════════════════════════════════════════════════╗
echo ║                                                           ║
echo ║   🤖  AUTONOMOUS AI AGENT - AUTO SETUP (WINDOWS)         ║
echo ║                                                           ║
echo ║   This script will:                                       ║
echo ║   1. Check Docker Desktop installation                   ║
echo ║   2. Check Node.js installation                          ║
echo ║   3. Pull Gemma4-12B Uncensored Model                    ║
echo ║   4. Build and start all services                        ║
echo ║   5. Verify everything is working                        ║
echo ║                                                           ║
echo ╚═══════════════════════════════════════════════════════════╝
echo %NC%

REM ── Check Docker ─────────────────────────────────────────────────────
call :header "Checking Docker"

where docker >nul 2>nul
if %ERRORLEVEL% neq 0 (
    call :error "Docker not found!"
    call :info "Please install Docker Desktop from: https://www.docker.com/products/docker-desktop"
    echo.
    echo Press any key to download Docker Desktop...
    pause >nul
    start https://www.docker.com/products/docker-desktop
    exit /b 1
)

for /f "tokens=*" %%i in ('docker --version') do set DOCKER_VERSION=%%i
call :log "Docker found: %DOCKER_VERSION%"

REM Check if Docker is running
docker ps >nul 2>nul
if %ERRORLEVEL% neq 0 (
    call :warn "Docker is not running. Starting Docker Desktop..."
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    call :info "Waiting for Docker to start (this may take 30-60 seconds)..."
    timeout /t 30 /nobreak >nul
    
    REM Check again
    docker ps >nul 2>nul
    if %ERRORLEVEL% neq 0 (
        call :error "Docker still not running. Please start Docker Desktop manually."
        exit /b 1
    )
)

call :log "Docker is running"

REM ── Check Node.js ────────────────────────────────────────────────────
call :header "Checking Node.js"

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    call :warn "Node.js not found!"
    call :info "Downloading Node.js installer..."
    start https://nodejs.org/dist/v20.10.0/node-v20.10.0-x64.msi
    echo.
    echo Please install Node.js and then run this script again.
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
call :log "Node.js found: %NODE_VERSION%"

REM ── Check Docker Compose ─────────────────────────────────────────────
call :header "Checking Docker Compose"

docker-compose version >nul 2>nul
if %ERRORLEVEL% neq 0 (
    call :warn "Docker Compose not found. It should be included with Docker Desktop."
    call :info "Please reinstall Docker Desktop with Docker Compose enabled."
    exit /b 1
)

for /f "tokens=*" %%i in ('docker-compose --version') do set COMPOSE_VERSION=%%i
call :log "Docker Compose found: %COMPOSE_VERSION%"

REM ── Setup Project ────────────────────────────────────────────────────
call :header "Setting Up Project"

cd /d "%PROJECT_DIR%"

REM Update .env
call :info "Configuring environment variables..."
powershell -Command "(Get-Content .env) -replace '^LLM_MODEL=.*','LLM_MODEL=%MODEL_NAME%' | Set-Content .env"
call :log "Environment configured"

REM Install frontend dependencies
call :info "Installing frontend dependencies..."
cd frontend
call npm install
if %ERRORLEVEL% neq 0 (
    call :error "Failed to install frontend dependencies"
    exit /b 1
)
call :log "Frontend dependencies installed"
cd ..

REM ── Build & Start Services ───────────────────────────────────────────
call :header "Building and Starting Services"

call :info "Building Docker images..."
call docker-compose build --no-cache

call :info "Starting services..."
call docker-compose up -d

call :info "Waiting for services to start..."
timeout /t 15 /nobreak >nul

REM Check health
call :info "Checking backend health..."
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:8000/health' -TimeoutSec 5 -ErrorAction Stop; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if %ERRORLEVEL% equ 0 (
    call :log "Backend service is healthy"
) else (
    call :warn "Backend service may not be ready yet"
)

call :info "Checking frontend health..."
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3000' -TimeoutSec 5 -ErrorAction Stop; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if %ERRORLEVEL% equ 0 (
    call :log "Frontend service is healthy"
) else (
    call :warn "Frontend service may not be ready yet"
)

REM ── Pull Model ───────────────────────────────────────────────────────
call :header "Pulling LLM Model"

call :info "Model: %BOLD%%MODEL_NAME%%NC%"
call :info "This may take 10-30 minutes depending on your internet speed..."
call :info "Model size: ~7.5GB (Q4_K_M quantization)"

REM Wait for Ollama
call :info "Waiting for Ollama service to be ready..."
set /a counter=0
:wait_loop
if %counter% geq 30 (
    call :error "Ollama service failed to start"
    exit /b 1
)
docker exec %OLLAMA_CONTAINER% ollama list >nul 2>nul
if %ERRORLEVEL% equ 0 goto :ollama_ready
timeout /t 2 /nobreak >nul
set /a counter+=1
goto :wait_loop

:ollama_ready
call :log "Ollama service is ready"

REM Check if model exists
docker exec %OLLAMA_CONTAINER% ollama list 2>nul | findstr "HauhauCS" >nul
if %ERRORLEVEL% equ 0 (
    call :log "Model already pulled"
    goto :model_done
)

REM Pull model
call :info "Pulling model from HuggingFace..."
docker exec -it %OLLAMA_CONTAINER% ollama pull "%MODEL_NAME%"

if %ERRORLEVEL% equ 0 (
    call :log "Model pulled successfully!"
) else (
    call :error "Failed to pull model"
    exit /b 1
)

:model_done

REM ── Verification ─────────────────────────────────────────────────────
call :header "Verifying Setup"

docker ps | findstr "%OLLAMA_CONTAINER%" >nul
if %ERRORLEVEL% equ 0 (
    call :log "✓ Ollama container is running"
) else (
    call :error "✗ Ollama container is not running"
)

powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:8000/health' -TimeoutSec 5 -ErrorAction Stop; if ($r.Content -match 'ok') { exit 0 } else { exit 1 } } catch { exit 1 }"
if %ERRORLEVEL% equ 0 (
    call :log "✓ Backend API is accessible"
) else (
    call :warn "! Backend API may not be ready yet"
)

powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3000' -TimeoutSec 5 -ErrorAction Stop; exit 0 } catch { exit 1 }"
if %ERRORLEVEL% equ 0 (
    call :log "✓ Frontend is accessible"
) else (
    call :warn "! Frontend may not be ready yet"
)

docker exec %OLLAMA_CONTAINER% ollama list 2>nul | findstr "HauhauCS" >nul
if %ERRORLEVEL% equ 0 (
    call :log "✓ LLM model is loaded"
) else (
    call :warn "! LLM model may not be loaded yet"
)

echo.

REM ── Final Message ────────────────────────────────────────────────────
call :header "Setup Complete!"

echo %GREEN%%BOLD%
echo ╔═══════════════════════════════════════════════════════════╗
echo ║                                                           ║
echo ║   ✅  SETUP SUCCESSFUL!                                   ║
echo ║                                                           ║
echo ║   🌐  Frontend:  http://localhost:3000                   ║
echo ║   🔧  Backend:   http://localhost:8000                   ║
echo ║   📚  API Docs:  http://localhost:8000/docs              ║
echo ║   🤖  Ollama:    http://localhost:11434                  ║
echo ║                                                           ║
echo ║   📖  Open your browser and go to:                       ║
echo ║       http://localhost:3000                              ║
echo ║                                                           ║
echo ║   📝  To view logs:                                      ║
echo ║       docker-compose logs -f                             ║
echo ║                                                           ║
echo ║   🛑  To stop:                                           ║
echo ║       docker-compose down                                ║
echo ║                                                           ║
echo ╚═══════════════════════════════════════════════════════════╝
echo %NC%

REM Open browser
call :info "Opening browser..."
start http://localhost:3000

echo.
echo Press any key to exit...
pause >nul

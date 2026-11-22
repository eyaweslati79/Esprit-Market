@echo off
title ESPRIT Market — All AI/ML Services
color 0A

echo.
echo  ============================================================
echo   ESPRIT Market — Starting All AI/ML Services
echo  ============================================================
echo.

:: ── Detect Python ────────────────────────────────────────────────────────────
py --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python launcher "py" not found.
    echo         Install Python from https://python.org
    pause
    exit /b 1
)
for /f "delims=" %%i in ('py -c "import sys; print(sys.executable)"') do set PYTHON=%%i
echo   Python: %PYTHON%
echo.

set ROOT=%~dp0

:: ── 1. ml-service — port 8007 ───────────────────────────────────────────────
echo [1/5] ml-service on port 8007...
start "ML-Service [8007]" cmd /k ^
    ""%PYTHON%" -m uvicorn main:app --host 0.0.0.0 --port 8007 --reload --app-dir "%ROOT%ml-service""
echo   [OK]
echo.

:: ── 2. ai-delivery-eta — port 8004 ──────────────────────────────────────────
echo [2/5] ai-delivery-eta on port 8004...
start "AI-Delivery-ETA [8004]" cmd /k ^
    ""%PYTHON%" -m uvicorn app.main:app --host 127.0.0.1 --port 8004 --reload --app-dir "%ROOT%ai-delivery-eta""
echo   [OK]
echo.

:: ── 3. ai-forum-recommendation — port 8001 ──────────────────────────────────
echo [3/5] ai-forum-recommendation on port 8001...
start "AI-Forum [8001]" cmd /k ^
    "cd /d "%ROOT%ai-forum-recommendation" && (if exist .env for /f "usebackq tokens=1,* delims==" %%a in (".env") do set "%%a=%%b") && "%PYTHON%" -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload --app-dir "%ROOT%ai-forum-recommendation""
echo   [OK]
echo.

:: ── 4. ai-cart — port 8002 ──────────────────────────────────────────────────
echo [4/5] ai-cart on port 8002...
start "AI-Cart [8002]" cmd /k ^
    ""%PYTHON%" -m uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload --app-dir "%ROOT%ai-cart""
echo   [OK]
echo.

:: ── 5. marketplace-ml — port 8003 ───────────────────────────────────────────
echo [5/5] marketplace-ml on port 8003...
start "Marketplace-ML [8003]" cmd /k ^
    ""%PYTHON%" -m uvicorn main:app --host 0.0.0.0 --port 8003 --reload --app-dir "%ROOT%marketplace-ml""
echo   [OK]
echo.

echo  ============================================================
echo   All services launched using system Python.
echo.
echo   Ports:
echo     8007  ml-service        (negotiation + carpooling AI)
echo     8004  ai-delivery-eta
echo     8001  ai-forum-recommendation
echo     8002  ai-cart
echo     8003  marketplace-ml
echo  ============================================================
echo.
pause

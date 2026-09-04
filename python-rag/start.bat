@echo off
echo Starting RepoGPT Python RAG service...
cd /d "%~dp0"

if not exist "venv\Scripts\activate.bat" (
    echo [ERROR] Virtual environment not found. Run setup first:
    echo   python -m venv venv
    echo   venv\Scripts\pip install -r requirements.txt
    exit /b 1
)

if not exist ".env" (
    echo [ERROR] .env file not found. Copy .env.example and fill in your credentials:
    echo   copy .env.example .env
    exit /b 1
)

call venv\Scripts\activate.bat
venv\Scripts\uvicorn main:app --reload --host 0.0.0.0 --port 8000

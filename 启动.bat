@echo off
setlocal
cd /d "%~dp0"

python -m mineru_pipeline.gui
if errorlevel 1 (
  echo.
  echo GUI startup failed. Make sure dependencies are installed:
  echo   pip install -e .
  echo.
  pause
)

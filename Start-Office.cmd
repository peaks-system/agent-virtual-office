@echo off
chcp 65001 >nul
setlocal
title AI CORPORATION - Office
set "OFFICE_NODE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined OFFICE_NODE set "OFFICE_NODE=%%N"
if not defined OFFICE_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "OFFICE_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined OFFICE_NODE (
  echo Node.js が見つかりません。Node.js 22 以上を準備してから、もう一度開いてください。
  pause
  exit /b 1
)
"%OFFICE_NODE%" "%~dp0scripts\office-launcher.cjs" start
if errorlevel 1 pause

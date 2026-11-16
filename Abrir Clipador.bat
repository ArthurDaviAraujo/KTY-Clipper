@echo off
rem Abre o Clipador KTY em modo de desenvolvimento (com recarga automática)
cd /d "%~dp0app"
call npm run dev

@echo off
rem Abre o Clipador KTY em modo de desenvolvimento (com recarga automática); usa os dados de <projeto>\dados
cd /d "%~dp0app"
call npm run dev

@echo off
rem Abre o Clipador KTY instalado (menu Iniciar). Se ainda não estiver instalado, abre o modo de desenvolvimento.
for %%P in ("%LOCALAPPDATA%\Programs\Clipador KTY\Clipador KTY.exe" "D:\Clipador KTY\Programa\Clipador KTY.exe") do (
  if exist %%P (
    start "" %%P
    exit /b
  )
)
cd /d "%~dp0app"
call npm run dev

@echo off
REM Spusti herni server SpaceGame na Windows (dedikovany server). Vyzaduje Node.js 20+.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js neni nainstalovany. Stahni ho z https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Prvni spusteni - instaluji zavislosti...
  call npm install || (pause & exit /b 1)
)
REM doinstalovat pripadne nove zavislosti (s aktualnim package-lock.json je to rychle)
call npm install --no-audit --no-fund
call npm start
pause

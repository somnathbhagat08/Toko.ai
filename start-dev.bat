@echo off
echo Starting Toko development environment...
echo.
echo This will start both the backend server and frontend dev server.
echo.
echo Backend: http://localhost:5000
echo Frontend: http://localhost:5173
echo.

:: Start the servers in separate windows
start cmd /k "echo Starting backend server... && npm run dev:server"
start cmd /k "echo Starting frontend dev server... && npm run dev:client"

echo Servers started! Check the command windows for progress.
echo.
echo Press any key to exit this window...
pause > nul

@echo off
echo Starting Toko development environment with Google OAuth support...
echo.
echo This script will start the backend on port 5001 and frontend on port 5000
echo.

:: Start backend server
start cmd /k "echo Starting backend server on port 5001... && cd server && npm run dev"

:: Wait a moment for backend to start
timeout /t 3 > nul

:: Start frontend server with port 5000
start cmd /k "echo Starting frontend server on port 5000... && cd client && npm run dev"

echo.
echo Servers started! Access the application at http://localhost:5000
echo.
echo Note: This port (5000) should be registered in Google Cloud Console
echo for Google OAuth to work properly.
echo.
echo Press any key to exit this window (servers will continue running)
pause > nul

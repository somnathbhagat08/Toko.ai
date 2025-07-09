@echo off
echo Starting Toko with Google OAuth on port 5173...
echo.
echo This script will start the frontend on port 5173 (already added to Google Cloud Console)
echo.

:: Check if port 5000 is in use
netstat -an | findstr ":5000" > nul
if %errorlevel% equ 0 (
  echo Warning: Port 5000 is already in use by another application.
  echo This is fine since we're now using port 5173 instead.
  echo.
)

:: Start backend server if needed
netstat -an | findstr ":5001" > nul
if %errorlevel% neq 0 (
  echo Starting backend server on port 5001...
  start cmd /k "cd server && npm run dev"
  
  :: Wait a moment for backend to start
  timeout /t 3 > nul
) else (
  echo Backend server already running on port 5001.
)

:: Start frontend server on port 5173
echo Starting frontend server on port 5173...
cd client
npm run dev

echo.
echo Access the application at http://localhost:5173
echo.

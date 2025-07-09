@echo off
echo Google OAuth Diagnostic Tool
echo =========================
echo.

echo Checking environment...
echo Current directory: %CD%
echo.

echo Checking available ports...
echo Checking port 5173 (Vite default):
netstat -ano | findstr ":5173"
echo.
echo Checking port 5000 (Alternative port):
netstat -ano | findstr ":5000"
if %errorlevel% equ 0 (
  echo WARNING: Port 5000 is in use. This may cause conflicts.
  echo Finding process using port 5000:
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5000') do (
    set PID=%%a
    wmic process where "ProcessId=%%a" get Name,ProcessId
    goto :continue
  )
  :continue
)
echo.
echo Checking port 5001 (Backend port):
netstat -ano | findstr ":5001"
echo.

echo Checking if .env file exists in client directory...
if exist "%~dp0client\.env" (
  echo Client .env file found
  type "%~dp0client\.env"
) else (
  echo No .env file found in client directory
)
echo.

echo Testing domain resolution...
ping -n 1 localhost
ping -n 1 127.0.0.1
echo.

echo Your current authorized origins should include:
echo - http://localhost:5173
echo - http://localhost:5000
echo - http://localhost:5001
echo - http://127.0.0.1:5173
echo - http://127.0.0.1:5000
echo - http://127.0.0.1:5001
echo.

echo Browser test recommendations:
echo 1. Open Chrome DevTools (F12) before attempting Google login
echo 2. Go to Network tab and filter for "google"
echo 3. Try logging in and check for any failed requests
echo 4. Look for console errors related to "unregistered_origin"
echo.

echo Next steps:
echo 1. Try running the application with "npm run dev" in the client directory
echo 2. Try using the test-oauth-on-5173.bat script to test on port 5173
echo 3. Try using the start-with-google-oauth.bat script to use port 5000
echo.

echo Press any key to exit...
pause > nul

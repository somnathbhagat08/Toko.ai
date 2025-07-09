@echo off
echo ======================================================
echo Google Sign-In Origin Test
echo ======================================================
echo.
echo This script will open a test page to check if your origin
echo is correctly registered in Google Cloud Console.
echo.

echo Testing with different origins to identify which ones are registered...
echo.

REM Try to start a simple HTTP server for testing
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Starting a Python HTTP server on port 5000...
    start "Python HTTP Server" cmd /c "cd %~dp0 && python -m http.server 5000"
    echo.
    echo Please wait 3 seconds for the server to start...
    timeout /t 3 >nul
    
    echo Opening test page at http://localhost:5000/google-signin-test.html
    start "" http://localhost:5000/google-signin-test.html
    
    echo Also opening test page with IP address at http://127.0.0.1:5000/google-signin-test.html
    start "" http://127.0.0.1:5000/google-signin-test.html
    
    echo.
    echo Press any key to stop the server when you're done testing...
    pause >nul
    
    echo Stopping the HTTP server...
    taskkill /FI "WINDOWTITLE eq Python HTTP Server*" /F >nul 2>&1
) else (
    echo Python not found. You'll need to serve the test file manually.
    echo.
    echo Options:
    echo 1. Install Python to use this script
    echo 2. Use another web server like http-server (npm install -g http-server)
    echo 3. Open the file directly in your browser (but be aware this uses file:// protocol
    echo    which won't work the same as http:// for testing origins)
    echo.
    echo Opening test file directly, but this may not accurately test origin registration...
    start "" "%~dp0google-signin-test.html"
)

echo.
echo ======================================================
echo Instructions:
echo ======================================================
echo.
echo 1. On the test page, check if your current origin is shown correctly
echo 2. Click "Test Google Sign-In" to see if your origin is registered
echo 3. If you get an "unregistered_origin" error, you need to add that origin
echo    to your Google Cloud Console configuration
echo.
echo If testing with both localhost and 127.0.0.1, you may find that one works
echo while the other doesn't. This confirms that you need to add both to your
echo authorized origins in Google Cloud Console.
echo.

pause

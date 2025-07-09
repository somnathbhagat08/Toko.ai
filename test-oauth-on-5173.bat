@echo off
echo Testing Google Sign-In with http://localhost:5173 origin...
echo.

:: Start a simple HTTP server on port 5173
start cmd /k "echo Starting HTTP server on port 5173... && cd %~dp0 && npx http-server -p 5173"

:: Wait a moment for server to start
timeout /t 3 > nul

:: Open the test page in browser
start http://localhost:5173/google-signin-test.html

echo.
echo Test page opened in browser. Check if Google Sign-In works.
echo If it works, it confirms your origin is properly registered.
echo.
echo Press any key to exit this window (server will continue running)
pause > nul

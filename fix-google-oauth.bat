@echo off
echo ======================================================
echo Google OAuth Configuration Checker
echo ======================================================
echo.
echo This script will help you verify and fix Google OAuth configuration
echo.

REM Check if frontend environment file exists
if exist "client\.env" (
  echo [✓] Frontend .env file found
) else (
  echo [✗] Frontend .env file not found
  echo Creating client\.env file with Google client ID...
  echo VITE_GOOGLE_CLIENT_ID=1073237357352-7ngur8kmp8vftgfkbu3p5fnvtrdb9kng.apps.googleusercontent.com > client\.env
  echo [✓] Created client\.env file
)

REM Check if backend environment file exists
if exist ".env" (
  echo [✓] Backend .env file found
) else (
  echo [✗] Backend .env file not found
  echo Creating .env file with Google configuration...
  (
    echo GOOGLE_CLIENT_ID=1073237357352-7ngur8kmp8vftgfkbu3p5fnvtrdb9kng.apps.googleusercontent.com
    echo GOOGLE_CLIENT_SECRET=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
    echo GOOGLE_REDIRECT_URI=http://localhost:5001/api/v1/auth/google/callback
    echo JWT_SECRET=toko-secret-key-should-be-changed-in-production
    echo PORT=5001
    echo NODE_ENV=development
    echo CORS_ORIGIN=http://localhost:5000,http://localhost:5001
  ) > .env
  echo [✓] Created .env file
)

echo.
echo ======================================================
echo Google OAuth Configuration Instructions
echo ======================================================
echo.
echo 1. Go to Google Cloud Console: https://console.cloud.google.com/
echo 2. Navigate to "APIs & Services" > "Credentials"
echo 3. Find your OAuth 2.0 Client ID and click "Edit"
echo 4. Update the configuration with the following settings:
echo.
echo    Application type: Web application
echo.
echo    Authorized JavaScript origins:
echo    - http://localhost:5000
echo    - http://localhost:5001
echo.
echo    Authorized redirect URIs:
echo    - http://localhost:5001/api/v1/auth/google/callback
echo.
echo 5. Save the changes
echo 6. If your app is in "Testing" mode, make sure your email is in the test users list
echo 7. If needed, switch to "Production" mode to allow any Google user to sign in
echo.
echo ======================================================
echo Current Configuration
echo ======================================================
echo.
echo Frontend Client ID: 1073237357352-7ngur8kmp8vftgfkbu3p5fnvtrdb9kng.apps.googleusercontent.com
echo Backend Client ID: 1073237357352-7ngur8kmp8vftgfkbu3p5fnvtrdb9kng.apps.googleusercontent.com
echo Backend Client Secret: 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
echo Backend Redirect URI: http://localhost:5001/api/v1/auth/google/callback
echo.
echo ======================================================
echo.
echo After updating the Google Cloud Console configuration, restart your application:
echo.
echo 1. Stop any running servers
echo 2. Start the backend: npm run server
echo 3. Start the frontend: npm run client
echo.
echo If you see "Can't continue with google.com" error, it means your Google Cloud Console
echo configuration still needs to be updated. Follow the instructions above.
echo.
pause

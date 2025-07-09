@echo off
echo ======================================================
echo Google OAuth Origin Fix Script
echo ======================================================
echo.
echo The error "Google Sign-In prompt not displayed: unregistered_origin"
echo means that the domain where your app is running isn't registered
echo in the Google Cloud Console.
echo.

echo Current application settings:
echo - Frontend runs on: http://localhost:5000 (default Vite port)
echo - Backend runs on: http://localhost:5001 (from .env configuration)
echo.

echo ======================================================
echo Required Google Cloud Console Settings
echo ======================================================
echo.
echo You need to register the following origins in your Google Cloud Console:
echo.
echo 1. http://localhost:5000
echo 2. http://localhost:5001
echo 3. http://localhost:3000 (if you're using this port)
echo 4. http://127.0.0.1:5000 (IP address equivalent)
echo 5. http://127.0.0.1:5001 (IP address equivalent)
echo.

echo ======================================================
echo Steps to fix the issue:
echo ======================================================
echo.
echo 1. Go to Google Cloud Console: https://console.cloud.google.com/
echo 2. Navigate to "APIs & Services" > "Credentials"
echo 3. Find your OAuth 2.0 Client ID and click "Edit"
echo 4. Under "Authorized JavaScript origins" add ALL of these:
echo    - http://localhost:5000
echo    - http://localhost:5001
echo    - http://127.0.0.1:5000
echo    - http://127.0.0.1:5001
echo    - http://localhost:3000 (if you're using this port)
echo.
echo 5. Under "Authorized redirect URIs" ensure you have:
echo    - http://localhost:5001/api/v1/auth/google/callback
echo    - http://127.0.0.1:5001/api/v1/auth/google/callback
echo.
echo 6. Click SAVE at the bottom of the page
echo 7. Wait a few minutes for changes to propagate
echo.

echo ======================================================
echo Current Configuration:
echo ======================================================
echo.
echo Client ID: 1073237357352-7ngur8kmp8vftgfkbu3p5fnvtrdb9kng.apps.googleusercontent.com
echo.

echo ======================================================
echo If you're testing on a different port or URL:
echo ======================================================
echo.
echo If you're running the application on a different port or URL,
echo you need to add that origin to the authorized JavaScript origins.
echo.
echo For example:
echo - http://localhost:{your-port}
echo - http://{your-domain}
echo.
echo Then restart your application after saving changes.
echo.

echo ======================================================
echo Debug information:
echo ======================================================
echo.
echo To see which origin is being rejected, check your browser's developer console
echo (F12 in most browsers), and look for messages containing "unregistered_origin".
echo.
echo The message should show which exact origin is being rejected.
echo.

echo ======================================================
echo Google OAuth Authentication Flow:
echo ======================================================
echo.
echo 1. Your application loads the Google Sign-In API
echo 2. The API checks if your origin is authorized
echo 3. If authorized, it shows the sign-in popup
echo 4. If not authorized, it returns "unregistered_origin" error
echo.
echo The most common cause is that your exact origin URL is not in the
echo authorized list in Google Cloud Console.
echo.

pause

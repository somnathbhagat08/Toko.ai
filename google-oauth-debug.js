// Google OAuth Debug Script
// Use this script to verify your Google OAuth client ID configuration

// 1. Check if your Google OAuth client ID is correctly configured in the Google Cloud Console
// 2. Verify that the client ID matches in both frontend and backend
// 3. Ensure that authorized origins and redirect URIs are set correctly in Google Cloud Console

// Authorized JavaScript origins for your OAuth client should include:
// - http://localhost:5000 (frontend)
// - http://localhost:5001 (backend)

// Authorized redirect URIs should include:
// - http://localhost:5001/api/v1/auth/google/callback

// Common issues:
// 1. Mismatch between client ID in frontend and backend
// 2. Missing authorized JavaScript origins
// 3. Missing authorized redirect URIs
// 4. Google OAuth client still in testing mode with limited users
// 5. Popup blocker preventing the Google sign-in window

// To debug the Google OAuth flow:
// 1. Check browser console for any errors
// 2. Verify network requests to Google OAuth endpoints
// 3. Ensure CORS is properly configured
// 4. Check server logs for token verification errors

// Current Configuration:
// - Frontend Client ID: 1073237357352-7ngur8kmp8vftgfkbu3p5fnvtrdb9kng.apps.googleusercontent.com
// - Backend Client ID: 1073237357352-7ngur8kmp8vftgfkbu3p5fnvtrdb9kng.apps.googleusercontent.com
// - Backend Client Secret: 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
// - Backend redirect URI: http://localhost:5001/api/v1/auth/google/callback

// Instructions to fix the Google OAuth configuration:
// 1. Go to Google Cloud Console: https://console.cloud.google.com/
// 2. Navigate to "APIs & Services" > "Credentials"
// 3. Find your OAuth 2.0 Client ID and click "Edit"
// 4. Under "Authorized JavaScript origins" add:
//    - http://localhost:5000
//    - http://localhost:5001
// 5. Under "Authorized redirect URIs" add:
//    - http://localhost:5001/api/v1/auth/google/callback
// 6. Save the changes
// 7. If your app is in "Testing" mode, make sure your email is in the test users list
// 8. If needed, switch to "Production" mode to allow any Google user to sign in

// After making these changes, restart your application and try again

# Google OAuth Configuration Guide

## Error: "Can't continue with google.com" or "unregistered_origin"

If you're encountering errors like "Can't continue with google.com" or "Google Sign-In prompt not displayed: unregistered_origin" when trying to use Google Sign-In, follow these steps to fix the issue:

## Quick Fix

1. Run the helper script `fix-google-oauth.bat` which will:
   - Verify environment files are set up correctly
   - Provide instructions for Google Cloud Console configuration

## Manual Configuration Steps

### 1. Verify Environment Files

Ensure your environment variables are set correctly:

#### Frontend Environment (client/.env)
```
VITE_GOOGLE_CLIENT_ID=1073237357352-7ngur8kmp8vftgfkbu3p5fnvtrdb9kng.apps.googleusercontent.com
```

#### Backend Environment (.env)
```
GOOGLE_CLIENT_ID=1073237357352-7ngur8kmp8vftgfkbu3p5fnvtrdb9kng.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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
GOOGLE_REDIRECT_URI=http://localhost:5001/api/v1/auth/google/callback
JWT_SECRET=toko-secret-key-should-be-changed-in-production
PORT=5001
NODE_ENV=development
CORS_ORIGIN=http://localhost:5000,http://localhost:5001
```

### 2. Update Google Cloud Console Configuration

The most common cause of the "Can't continue with google.com" error is incorrect configuration in the Google Cloud Console:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to "APIs & Services" > "Credentials"
3. Find your OAuth 2.0 Client ID and click "Edit"
4. Update the configuration with the following settings:

   **Application type:** Web application

   **Authorized JavaScript origins:** (add ALL of these)
   - http://localhost:5000
   - http://localhost:5001
   - http://127.0.0.1:5000
   - http://127.0.0.1:5001
   - http://localhost:3000 (if you're using this port)

   **Authorized redirect URIs:** (add ALL of these)
   - http://localhost:5001/api/v1/auth/google/callback
   - http://127.0.0.1:5001/api/v1/auth/google/callback

5. Save the changes
6. If your app is in "Testing" mode, make sure your email is in the test users list
7. If needed, switch to "Production" mode to allow any Google user to sign in

### 3. Restart Your Application

After making these changes:

1. Stop any running servers
2. Start the backend: `npm run server`
3. Start the frontend: `npm run client`

### 4. Debug Chrome Issues

If you're still having issues:

1. Check if you're logged into multiple Google accounts in Chrome
2. Try using an Incognito window
3. Clear browser cookies for google.com
4. Disable any browser extensions that might interfere with authentication

### 5. Troubleshooting

If you're still experiencing issues:

1. Check the browser console for detailed error messages
2. Look at the server logs for authentication errors
3. Verify that the Google Sign-In script is loading properly
4. Ensure your application is using HTTPS or localhost (required for OAuth)

## Understanding the "unregistered_origin" Error

The error message "Google Sign-In prompt not displayed: unregistered_origin" means that the domain (origin) where your application is running is not registered in your Google Cloud Console as an authorized JavaScript origin.

### What is an "origin"?

An origin is defined by the combination of protocol, hostname, and port. For example:
- `http://localhost:5000`
- `http://127.0.0.1:5000`
- `https://example.com`

These are all different origins, and each must be separately authorized in the Google Cloud Console.

### How to Fix:

1. Identify the exact origin where your application is running by checking the browser console
2. In Google Cloud Console, add that exact origin to the "Authorized JavaScript origins" list
3. To be safe, add multiple variations (localhost, 127.0.0.1, with different common ports)
4. After saving, wait 5-10 minutes for changes to propagate through Google's systems

### Testing Origin Registration

You can use the included `google-signin-test.html` file to test if your origin is properly registered:

1. Open the file in a browser
2. Check the current origin information displayed
3. Click "Test Google Sign-In"
4. If successful, you'll see the Google Sign-In prompt
5. If you see "unregistered_origin" error, follow the instructions to fix it

## Reference

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Google Sign-In for Websites](https://developers.google.com/identity/sign-in/web/sign-in)
- [Common OAuth 2.0 Scenarios](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)

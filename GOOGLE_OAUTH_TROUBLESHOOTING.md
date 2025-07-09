# Google OAuth Troubleshooting Guide

## Common Errors

### "Google Sign-In prompt not displayed: unregistered_origin"

This error occurs when you're trying to use Google Sign-In from an origin (domain/port) that is not registered in your Google Cloud Console project.

## Important: Changes Take Time to Propagate

If you've already added your origin (e.g., `http://localhost:5173`) to the Google Cloud Console but still see this error, please note:

- **Google Cloud changes can take up to 30 minutes to propagate**
- You may need to clear your browser cache or try in an incognito window
- Restart your application completely (both frontend and backend)

## Solution Options

### Option 1: Add Your Current Origin to Google Cloud Console

1. **Go to Google Cloud Console**:
   - Visit [https://console.cloud.google.com/](https://console.cloud.google.com/)
   - Select your project

2. **Navigate to Credentials**:
   - In the left sidebar, click on "APIs & Services" > "Credentials"

3. **Edit your OAuth Client ID**:
   - Find the OAuth 2.0 Client ID you're using for the application
   - Click on it to edit

4. **Add the new origin**:
   - In the "Authorized JavaScript origins" section, click "ADD URI"
   - Add your origin (e.g., `http://localhost:5173`)
   - Make sure to keep any existing URIs
   - The following origins are already configured:
     - `http://localhost:5000`
     - `http://localhost:5001`
     - `http://127.0.0.1:5000`
     - `http://127.0.0.1:5001`

5. **Save the changes**:
   - Click "SAVE" at the bottom of the page
   - Changes may take a few minutes to propagate

### Option 2: Use an Already Registered Port

We've updated the Vite configuration to use port 5000 instead of the default 5173. To use this:

1. Run the application using the provided script:
   ```
   start-with-google-oauth.bat
   ```

2. Access the application at `http://localhost:5000`

## Verifying Your Current Origin

You can check what origin your application is using by opening the browser console and typing:
```javascript
console.log(window.location.origin);
```

## Common Issues and Solutions

### Port Already in Use

If you see this error when starting your application:
```
Port 5000 is already in use
```

This means another application on your system is using port 5000. You have two options:

1. **Stop the other application** using port 5000
   - You can find what's using it with: `netstat -ano | findstr :5000`
   - Then stop that process

2. **Use a different port** (recommended)
   - We've provided a script that uses port 5173 instead:
   ```
   start-on-port-5173.bat
   ```
   - Make sure `http://localhost:5173` is added to your authorized origins in Google Cloud Console

### Port Conflicts Between Frontend and Backend

If your frontend and backend try to use the same port, you'll see errors. Our configuration:
- Frontend: Should run on port 5173 (or 5000)
- Backend: Should run on port 5001

Always make sure these ports are not conflicting with each other or other applications.

## Additional Troubleshooting

If you're still having issues after adding your origin to Google Cloud Console:

1. **Check Browser Console**: Look for detailed error messages

2. **Verify Client ID**: Make sure the client ID in your `.env` file matches the one in Google Cloud Console

3. **Clear Browser Cache**: Sometimes old configuration gets cached
   - Try opening an incognito/private window
   - Or clear site data completely: Settings > Privacy and Security > Clear browsing data

4. **Check Network Tab**: In browser developer tools, look for requests to Google's authentication servers
   - Look for requests to `accounts.google.com`
   - Check if there are any blocked requests

5. **Restart Application Completely**: 
   - Stop all running servers (frontend and backend)
   - Close and reopen your terminal/command prompt
   - Restart your application using the provided script

6. **Check for Browser Extensions**: Some privacy extensions might block Google authentication
   - Try disabling extensions temporarily
   - Or test in incognito mode where extensions are disabled by default

7. **Test with Different Browser**: Sometimes browser-specific issues can occur

8. **Verify Redirect URI**: If using redirect flow, check that the redirect URI is also registered

9. **Check for Cookies Issues**: Google authentication uses cookies
   - Ensure third-party cookies are not blocked
   - Check if you have privacy settings that might interfere

10. **Verify Consent Screen Configuration**: Make sure your OAuth consent screen is properly configured
    - Check that it's not in "Testing" mode with restricted users
    - Verify the app is not under review or restricted

## Testing Your OAuth Configuration

### Using Google's OAuth Playground

To verify if your OAuth credentials are working correctly:

1. Visit [Google OAuth Playground](https://developers.google.com/oauthplayground/)
2. Click the gear icon in the top right corner
3. Check "Use your own OAuth credentials"
4. Enter your Client ID and Client Secret
5. Select the appropriate scopes (usually "profile" and "email")
6. Click "Authorize APIs"

If this works, your credentials are valid, and the issue might be with your application configuration or the origin settings.

### Creating a Simple Test HTML File

You can create a minimal test file to verify your Google Sign-In:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Google Sign-In Test</title>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
</head>
<body>
  <h1>Google Sign-In Test</h1>
  <p>Current origin: <span id="origin"></span></p>
  
  <div id="g_id_onload"
     data-client_id="YOUR_CLIENT_ID"
     data-callback="handleCredentialResponse">
  </div>
  <div class="g_id_signin" data-type="standard"></div>

  <script>
    document.getElementById('origin').textContent = window.location.origin;
    
    function handleCredentialResponse(response) {
      console.log("Google response:", response);
      alert("Sign-in successful! Check console for details.");
    }
  </script>
</body>
</html>
```

Replace `YOUR_CLIENT_ID` with your actual Google client ID.

Save this as `google-signin-test.html` and open it directly in your browser to test.

## Contact Support

If you continue to face issues, please contact support with:
- The exact error message
- Your application's origin (URL)
- Screenshots of your Google Cloud Console configuration

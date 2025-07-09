import React, { useState, useEffect } from 'react';
import { MessageCircle, Mail, Lock, User, Eye, EyeOff, Star, Circle, Square, Triangle } from 'lucide-react';
import { authService } from '../services/authService';
import TokoLogo from './TokoLogo';

// Google OAuth types
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: {credential: string}) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
            ux_mode?: 'popup' | 'redirect';
            use_fedcm_for_prompt?: boolean;
          }) => void;
          prompt: () => void;
          renderButton: (
            element: HTMLElement, 
            config: {
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'large' | 'medium' | 'small';
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
              shape?: 'rectangular' | 'pill' | 'circle' | 'square';
              logo_alignment?: 'left' | 'center';
              width?: number;
              locale?: string;
            }
          ) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

interface LoginPageProps {
  onLogin: (user: any) => void;
}

// Helper function to generate a valid MongoDB ObjectId format
const generateObjectId = () => {
  const timestamp = Math.floor(Date.now() / 1000).toString(16);
  const randomHex = Math.random().toString(16).substr(2, 16);
  return (timestamp + randomHex).padEnd(24, '0').substr(0, 24);
};

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: ''
  });

  useEffect(() => {
    // Initialize Google OAuth when the component mounts
    const initGoogle = () => {
      if (window.google) {
        initializeGoogleAuth();
      } else {
        // Retry after a short delay if Google isn't loaded yet
        setTimeout(initGoogle, 100);
      }
    };
    
    initGoogle();
    
    // Debug helper to check environment variables
    const debugEnvVars = () => {
      console.log('Environment variables check:');
      console.log('- VITE_GOOGLE_CLIENT_ID:', import.meta.env.VITE_GOOGLE_CLIENT_ID || 'Not set');
      
      if (!import.meta.env.VITE_GOOGLE_CLIENT_ID) {
        console.warn('Google OAuth Client ID is not set in environment variables');
        console.log('Make sure you have a .env file in the client directory with:');
        console.log('VITE_GOOGLE_CLIENT_ID=1073237357352-7ngur8kmp8vftgfkbu3p5fnvtrdb9kng.apps.googleusercontent.com');
      }
    };
    
    // Run debug check
    debugEnvVars();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    
    try {
      console.log(`Attempting to ${isSignUp ? 'register' : 'login'} with:`, {
        email: formData.email,
        name: formData.name
      });
      
      if (isSignUp) {
        const user = await authService.register({
          email: formData.email,
          password: formData.password,
          name: formData.name,
          provider: 'local'
        });
        console.log('Registration successful:', user);
        onLogin(user);
      } else {
        const user = await authService.login({
          email: formData.email,
          password: formData.password
        });
        console.log('Login successful:', user);
        onLogin(user);
      }
    } catch (err: any) {
      console.error(`${isSignUp ? 'Registration' : 'Login'} error:`, err);
      setError(err.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  const initializeGoogleAuth = () => {
    if (window.google && window.google.accounts) {
      try {
        // Use the environment variable for Google OAuth client ID
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        
        if (!clientId) {
          console.error('Google OAuth client ID not found in environment variables');
          setError('Google Sign-In configuration error. Please contact support.');
          return;
        }
        
        console.log('Initializing Google Auth with client ID:', clientId.substring(0, 10) + '...');
        
        // Enhanced debug logging for origin issue troubleshooting
        const currentOrigin = window.location.origin;
        console.log('Google auth initialization - detailed environment:', {
          host: window.location.host,
          origin: currentOrigin,
          protocol: window.location.protocol,
          hostname: window.location.hostname,
          port: window.location.port,
          pathname: window.location.pathname,
          href: window.location.href,
          isDevelopment: import.meta.env.DEV,
          isProduction: import.meta.env.PROD
        });
        
        console.log('IMPORTANT: Make sure this origin is registered in Google Cloud Console:');
        console.log('- ' + currentOrigin);
        console.log('Also add these variations to be safe:');
        console.log('- http://localhost:5000');
        console.log('- http://localhost:5001');
        console.log('- http://127.0.0.1:5000');
        console.log('- http://127.0.0.1:5001');
        
        // Initialize Google Sign-In with debugging options
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleGoogleCallback,
          auto_select: false,
          cancel_on_tap_outside: true,
          ux_mode: 'popup',
          // Add this to handle problems with first-party cookies
          use_fedcm_for_prompt: false,
          // Log level for more detailed information
          log_level: 'debug'
        });
        
        // Test if the origin is registered by trying to render a button
        try {
          const testContainer = document.createElement('div');
          testContainer.style.display = 'none';
          document.body.appendChild(testContainer);
          
          window.google.accounts.id.renderButton(testContainer, {
            theme: 'outline',
            size: 'large'
          });
          
          console.log('Google Auth button rendered successfully - origin appears to be valid');
          document.body.removeChild(testContainer);
        } catch (renderError) {
          console.warn('Google Auth button render test failed:', renderError);
          // Don't throw here, just log the warning
        }
        
        console.log('Google Auth initialized successfully');
      } catch (error) {
        console.error('Google Auth initialization error:', error);
        setError(`Google Sign-In initialization failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      console.warn('Google accounts API not available yet');
      // We'll retry through the useEffect
    }
  };

  const handleGoogleLogin = () => {
    setIsLoading(true);
    setError('');
    
    if (window.google && window.google.accounts) {
      try {
        console.log('Triggering Google Sign-In prompt');
        
        // Enhanced debug logging
        console.log('Google auth configuration:', {
          clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID?.substring(0, 10) + '...',
          clientIdLength: import.meta.env.VITE_GOOGLE_CLIENT_ID?.length || 0,
          hasClientId: !!import.meta.env.VITE_GOOGLE_CLIENT_ID,
          host: window.location.host,
          origin: window.location.origin,
          protocol: window.location.protocol
        });
        
        // Add event listener for storage changes (cross-tab communication)
        const handleStorageChange = (e: StorageEvent) => {
          if (e.key === 'google_auth_error') {
            console.warn('Google Auth error from another tab:', e.newValue);
            setError(e.newValue || 'Google Sign-In failed. Please try again.');
            setIsLoading(false);
          }
        };
        
        window.addEventListener('storage', handleStorageChange);
        
        // Store current timestamp to help detect popup blocks
        localStorage.setItem('google_auth_start', Date.now().toString());
        
        // Capture any console errors that might occur during the sign-in process
        const originalConsoleError = console.error;
        console.error = function(...args) {
          // Still call the original function
          originalConsoleError.apply(console, args);
          
          // Check if this is a Google-related error
          const errorString = args.map(arg => String(arg)).join(' ');
          if (errorString.includes('google') || errorString.includes('oauth') || errorString.includes('sign')) {
            localStorage.setItem('google_auth_console_error', errorString);
          }
        };
        
        // The prompt method doesn't accept a callback in this version
        window.google.accounts.id.prompt((notification: any) => {
          // Log the notification from Google's prompt
          console.log('Google Sign-In prompt notification:', notification);
          
          if (notification.isNotDisplayed()) {
            const reason = notification.getNotDisplayedReason();
            console.error('Google Sign-In prompt not displayed:', reason);
            console.error('Current origin:', window.location.origin);
            console.error('Origin details:', {
              protocol: window.location.protocol,
              hostname: window.location.hostname,
              port: window.location.port,
              pathname: window.location.pathname,
              href: window.location.href,
            });
            setError(`Google Sign-In prompt not displayed: ${reason}. Check Google Cloud Console configuration and add ${window.location.origin} to authorized origins.`);
            setIsLoading(false);
            
            // Log additional information to help debug the issue
            if (reason === 'unregistered_origin') {
              console.warn('SOLUTION: Add the following origins to Google Cloud Console:');
              console.warn('- ' + window.location.origin);
              console.warn('- http://localhost:5000');
              console.warn('- http://localhost:5001');
              console.warn('- http://127.0.0.1:5000');
              console.warn('- http://127.0.0.1:5001');
            }
          } else if (notification.isSkippedMoment()) {
            const reason = notification.getSkippedReason();
            console.warn('Google Sign-In prompt skipped:', reason);
            setError(`Google Sign-In prompt skipped: ${reason}`);
            setIsLoading(false);
          } else if (notification.isDismissedMoment()) {
            const reason = notification.getDismissedReason();
            console.warn('Google Sign-In prompt dismissed:', reason);
            setError(`Google Sign-In prompt dismissed: ${reason}`);
            setIsLoading(false);
          }
        });
        
        // Restore original console.error after a delay
        setTimeout(() => {
          console.error = originalConsoleError;
        }, 5000);
        
        // Wait a bit and then check if signin was successful
        setTimeout(() => {
          // If we're still in loading state after 3 seconds, 
          // assume something went wrong with the prompt
          if (isLoading) {
            console.warn('Google Sign-In prompt may have been blocked');
            
            // Check for any console errors that were captured
            const consoleError = localStorage.getItem('google_auth_console_error');
            if (consoleError) {
              setError(`Google Sign-In error: ${consoleError}`);
              localStorage.removeItem('google_auth_console_error');
            } else {
              setError('Google Sign-In may have been blocked by browser settings or the Google Cloud Console configuration is incorrect. Please enable popups or use another login method.');
            }
            
            setIsLoading(false);
          }
          
          // Clean up
          window.removeEventListener('storage', handleStorageChange);
        }, 5000);
      } catch (error) {
        console.error('Google Sign-In prompt error:', error);
        setError(`Google Sign-In error: ${error instanceof Error ? error.message : String(error)}`);
        setIsLoading(false);
      }
    } else {
      console.warn('Google Sign-In not available');
      setError('Google Sign-In is not available. Please use username/password.');
      setIsLoading(false);
    }
  };

  const renderGoogleButton = () => {
    const container = document.getElementById('google-signin-container');
    if (!container) {
      console.error('Google Sign-In container not found');
      return;
    }
    
    if (window.google && window.google.accounts) {
      // Clear previous content
      container.innerHTML = '';
      
      window.google.accounts.id.renderButton(container, {
        theme: 'outline',
        size: 'large',
        width: 300,
        text: 'continue_with',
        logo_alignment: 'center'
      });
      
      // Auto-click the button
      setTimeout(() => {
        const googleButton = container.querySelector('div[role="button"]') as HTMLElement;
        if (googleButton) {
          googleButton.click();
        }
      }, 100);
    } else {
      console.error('Google Sign-In API not loaded');
    }
  };

  const handleGoogleCallback = async (response: any) => {
    try {
      console.log('Google Sign-In successful, processing response', response);
      setIsLoading(true);
      setError('');
      
      if (!response.credential) {
        console.error('Missing credential in Google response');
        setError('Invalid Google authentication response');
        setIsLoading(false);
        return;
      }
      
      // Store a timestamp of successful token receipt
      localStorage.setItem('google_auth_success', Date.now().toString());
      
      // Use the credential token with our backend API
      console.log('Sending Google credential to backend');
      
      try {
        // Call our Google authentication endpoint
        const googleAuthResponse = await fetch('/api/v1/auth/google', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ credential: response.credential }),
          credentials: 'include' // Include cookies if any
        });
        
        // Log response status and headers for debugging
        console.log('Google auth response status:', googleAuthResponse.status);
        console.log('Google auth response headers:', {
          contentType: googleAuthResponse.headers.get('content-type'),
          server: googleAuthResponse.headers.get('server')
        });
        
        if (!googleAuthResponse.ok) {
          let errorMessage = `Server error: ${googleAuthResponse.status}`;
          
          try {
            const errorData = await googleAuthResponse.json();
            console.error('Google authentication failed:', errorData);
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch (jsonError) {
            console.error('Could not parse error response:', jsonError);
          }
          
          throw new Error(errorMessage);
        }
        
        const result = await googleAuthResponse.json();
        console.log('Google authentication successful:', result);
        
        // Store the token
        if (result.token) {
          authService.setToken(result.token);
          
          // Verify we have a user object
          if (!result.user || !result.user.id) {
            throw new Error('Invalid user data received from server');
          }
          
          setIsLoading(false);
          onLogin(result.user);
        } else {
          throw new Error('No authentication token received');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error during Google authentication';
        console.error('Error during Google authentication with backend:', error);
        
        // Store error for cross-tab communication
        localStorage.setItem('google_auth_error', errorMessage);
        
        setError(`Authentication failed: ${errorMessage}`);
        setIsLoading(false);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error processing Google login:', error);
      
      // Store error for cross-tab communication
      localStorage.setItem('google_auth_error', errorMessage);
      
      setError(`Failed to process Google sign-in: ${errorMessage}`);
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Animated Hello Text Lines */}
        <div className="absolute top-[15%] left-0 w-full opacity-10">
          <div className="whitespace-nowrap text-2xl font-normal text-gray-800 animate-scroll-right">
            Hello • Hola • Bonjour • Hallo • Ciao • Olá • Привет • こんにちは • 안녕하세요 • 你好 • مرحبا • नमस्ते • Γεια σας • Shalom • Sawubona • Jambo •
          </div>
        </div>
        <div className="absolute top-[30%] left-0 w-full opacity-10">
          <div className="whitespace-nowrap text-2xl font-normal text-gray-800 animate-scroll-left">
            Hej • Terve • Salam • Zdravo • Ahoj • Dzień dobry • Bună • Здравей • Pozdrav • Merhaba • سلام • Chào • สวัสดี • ជំរាបសួរ • Mingalaba •
          </div>
        </div>
        <div className="absolute top-[45%] left-0 w-full opacity-10">
          <div className="whitespace-nowrap text-2xl font-normal text-gray-800 animate-scroll-right">
            Halo • Kumusta • Talofa • Kia ora • Aloha • Habari • Sannu • Salaam • Hujambo • Dumela • Sawubona • Molweni • Avuxeni • Ndimadoda •
          </div>
        </div>
        <div className="absolute top-[60%] left-0 w-full opacity-10">
          <div className="whitespace-nowrap text-2xl font-normal text-gray-800 animate-scroll-left">
            Guten Tag • Bom dia • Buenos días • Buongiorno • Dobré ráno • Доброе утро • おはよう • 좋은 아침 • 早上好 • صباح الخير • सुप्रभात • Καλημέρα •
          </div>
        </div>
        <div className="absolute top-[75%] left-0 w-full opacity-10">
          <div className="whitespace-nowrap text-2xl font-normal text-gray-800 animate-scroll-right">
            Namaste • Selamat pagi • Chúc buổi sáng • السلام عليكم • शुभ प्रभात • Καλή μέρα • בוקר טוב • Subb sukh • Umuntu • Sawubona • Molweni •
          </div>
        </div>
        <div className="absolute top-[90%] left-0 w-full opacity-10">
          <div className="whitespace-nowrap text-2xl font-normal text-gray-800 animate-scroll-left">
            Goedemorgen • Dobro jutro • Bom dia • Buenos días • Buongiorno • Dobré ráno • Доброе утро • おはよう • 좋은 아침 • 早上好 • صباح الخير •
          </div>
        </div>
      </div>

      {/* Static Dotted Grid Background */}
      <div 
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage: `
            radial-gradient(circle, #000 1.5px, transparent 1.5px),
            linear-gradient(to right, #000 0.8px, transparent 0.8px),
            linear-gradient(to bottom, #000 0.8px, transparent 0.8px)
          `,
          backgroundSize: '25px 25px, 50px 50px, 50px 50px'
        }}
      />

      {/* Evenly Distributed Geometric Shapes Background */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Evenly Distributed Stars */}
        {[...Array(15)].map((_, i) => (
          <div
            key={`star-${i}`}
            className="absolute opacity-[0.12] animate-pulse"
            style={{
              left: `${(i % 5) * 20 + 10}%`,
              top: `${Math.floor(i / 5) * 25 + 10}%`,
              transform: `rotate(${i * 24}deg)`,
              fontSize: '20px',
              animationDelay: `${i * 0.2}s`
            }}
          >
            <Star className="fill-current text-green-500" />
          </div>
        ))}
        
        {/* Evenly Distributed Circles */}
        {[...Array(12)].map((_, i) => (
          <div
            key={`circle-${i}`}
            className="absolute opacity-[0.12] animate-bounce"
            style={{
              left: `${(i % 4) * 25 + 12.5}%`,
              top: `${Math.floor(i / 4) * 30 + 15}%`,
              fontSize: '24px',
              animationDelay: `${i * 0.3}s`,
              animationDuration: '3s'
            }}
          >
            <Circle className="fill-current text-blue-500" />
          </div>
        ))}

        {/* Evenly Distributed Squares */}
        {[...Array(10)].map((_, i) => (
          <div
            key={`square-${i}`}
            className="absolute opacity-[0.12] animate-spin"
            style={{
              left: `${(i % 5) * 20 + 15}%`,
              top: `${Math.floor(i / 5) * 40 + 20}%`,
              transform: `rotate(${i * 36}deg)`,
              fontSize: '18px',
              animationDelay: `${i * 0.4}s`,
              animationDuration: '4s'
            }}
          >
            <Square className="fill-current text-purple-500" />
          </div>
        ))}

        {/* Evenly Distributed Triangles */}
        {[...Array(8)].map((_, i) => (
          <div
            key={`triangle-${i}`}
            className="absolute opacity-[0.12] animate-ping"
            style={{
              left: `${(i % 4) * 25 + 20}%`,
              top: `${Math.floor(i / 4) * 35 + 25}%`,
              transform: `rotate(${i * 45}deg)`,
              fontSize: '16px',
              animationDelay: `${i * 0.5}s`,
              animationDuration: '2s'
            }}
          >
            <Triangle className="fill-current text-orange-500" />
          </div>
        ))}

        {/* Static People Icons */}
        {[...Array(15)].map((_, i) => (
          <div
            key={`user-${i}`}
            className="absolute opacity-[0.08] text-black"
            style={{
              left: `${10 + (i * 6)}%`,
              top: `${12 + (i * 5)}%`,
              transform: `rotate(${i * 24}deg)`,
              fontSize: '22px'
            }}
          >
            <User />
          </div>
        ))}
      </div>

      <div className="relative z-10 h-full flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md flex-shrink-0">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-3 bg-white border-4 border-black p-3 shadow-[6px_6px_0px_0px_#000] mb-4">
              <TokoLogo className="w-8 h-8" />
              <h1 className="text-3xl font-black text-black tracking-tight">TOKO</h1>
            </div>
            <h2 className="text-lg font-black text-gray-900 mb-1">
              {isSignUp ? 'CREATE ACCOUNT' : 'WELCOME BACK'}
            </h2>
            <p className="text-sm font-bold text-gray-700">
              {isSignUp ? 'Join the conversation revolution' : 'Connect with strangers worldwide'}
            </p>
          </div>

          {/* Login Form */}
          <div className="bg-white border-4 border-black p-4 shadow-[8px_8px_0px_0px_#000] mb-3">
            <form onSubmit={handleSubmit} className="space-y-3">
              {isSignUp && (
                <div>
                  <label className="block text-xs font-black text-gray-900 mb-1">
                    FULL NAME
                  </label>
                  <div className="relative">
                    <User className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-500" />
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full pl-8 pr-2 py-2 border-3 border-black font-bold bg-gray-50 shadow-[2px_2px_0px_0px_#000] focus:outline-none focus:bg-white focus:shadow-[3px_3px_0px_0px_#00FF88] focus:border-green-400 transition-all text-xs"
                      placeholder="Enter your name"
                      required={isSignUp}
                      disabled={isLoading}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-black text-gray-900 mb-1">
                  EMAIL
                </label>
                <div className="relative">
                  <Mail className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-500" />
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    className="w-full pl-8 pr-2 py-2 border-3 border-black font-bold bg-gray-50 shadow-[2px_2px_0px_0px_#000] focus:outline-none focus:bg-white focus:shadow-[3px_3px_0px_0px_#00FF88] focus:border-green-400 transition-all text-xs"
                    placeholder="Enter your email"
                    required
                    disabled={isLoading}
                  />
                </div>
              </div>

              {error && (
                <div className="text-red-600 text-xs font-bold bg-red-50 border-2 border-red-200 p-2 rounded">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-black text-gray-900 mb-1">
                  PASSWORD
                </label>
                <div className="relative">
                  <Lock className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                    className="w-full pl-8 pr-8 py-2 border-3 border-black font-bold bg-gray-50 shadow-[2px_2px_0px_0px_#000] focus:outline-none focus:bg-white focus:shadow-[3px_3px_0px_0px_#00FF88] focus:border-green-400 transition-all text-xs"
                    placeholder="Enter your password"
                    required
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    disabled={isLoading}
                  >
                    {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-black text-white border-3 border-black py-2 text-sm font-black transition-all shadow-[3px_3px_0px_0px_#666] hover:shadow-[4px_4px_0px_0px_#00FF88] hover:bg-green-400 hover:translate-x-[-1px] hover:translate-y-[-1px] active:shadow-[2px_2px_0px_0px_#8A2BE2] active:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:bg-black disabled:hover:shadow-[3px_3px_0px_0px_#666] flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full"></div>
                    PROCESSING...
                  </>
                ) : (
                  isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN'
                )}
              </button>
            </form>

            <div className="mt-3">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t-2 border-black"></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-2 bg-white font-black text-gray-900">OR</span>
                </div>
              </div>

              <button
                onClick={handleGoogleLogin}
                disabled={isLoading}
                className="w-full mt-2 bg-white text-black border-3 border-black py-2 text-sm font-black transition-all shadow-[3px_3px_0px_0px_#666] hover:shadow-[6px_6px_0px_0px_#4285F4] hover:translate-x-[-3px] hover:translate-y-[-3px] hover:bg-blue-50 hover:border-blue-500 active:shadow-[2px_2px_0px_0px_#8A2BE2] active:bg-purple-500 active:translate-x-[1px] active:translate-y-[1px] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed group relative overflow-hidden"
              >
                {/* Animated geometric shapes for hover effect */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="absolute -top-1 -left-1 opacity-60 animate-bounce">
                    <Star className="w-3 h-3 text-blue-500 fill-current" />
                  </div>
                  <div className="absolute -top-1 -right-1 opacity-60 animate-pulse">
                    <Circle className="w-2 h-2 text-green-500 fill-current" />
                  </div>
                  <div className="absolute -bottom-1 -left-1 opacity-60 animate-spin">
                    <Square className="w-2 h-2 text-red-500 fill-current" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 opacity-60 animate-ping">
                    <Triangle className="w-3 h-3 text-yellow-500 fill-current" />
                  </div>
                </div>
                
                {isLoading ? (
                  <>
                    <div className="animate-spin w-3 h-3 border-2 border-black border-t-transparent rounded-full relative z-10"></div>
                    <span className="relative z-10">CONNECTING...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 relative z-10" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    <span className="relative z-10">CONTINUE WITH GOOGLE</span>
                  </>
                )}
              </button>
              
              {/* Hidden div for Google's own button rendering */}
              <div id="google-signin-container" className="hidden"></div>
            </div>
          </div>

          {/* Toggle Sign Up/Sign In */}
          <div className="text-center">
            <p className="font-bold text-gray-700 text-xs">
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                onClick={() => setIsSignUp(!isSignUp)}
                disabled={isLoading}
                className="text-black font-black underline hover:no-underline hover:text-green-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSignUp ? 'SIGN IN' : 'SIGN UP'}
              </button>
            </p>
          </div>

          {/* Made by Humans using AI Footer - Fixed positioning */}
          <div className="text-center mt-12">
            <p className="text-sm font-black text-gray-700">
              Made by Humans using AI 🤖
            </p>
          </div>
        </div>
      </div>

      {/* Google OAuth Script */}
      <script src="https://accounts.google.com/gsi/client" async defer></script>
    </div>
  );
}
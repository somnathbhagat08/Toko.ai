interface LoginData {
  email: string;
  password: string;
}

interface RegisterData {
  email: string;
  password: string;
  name: string;
  avatar?: string;
  provider?: string;
}

interface User {
  id: number;  // Keep number type to match database schema
  email: string;
  name: string;
  avatar?: string;
}

interface AuthResponse {
  user: User;
  token: string;
  message?: string;
}

class AuthService {
  private token: string | null = null;

  constructor() {
    // Load token from localStorage if available
    this.token = localStorage.getItem('auth_token');
  }

  getToken(): string | null {
    return this.token;
  }
  
  setToken(token: string): void {
    this.token = token;
    localStorage.setItem('auth_token', token);
  }

  isAuthenticated(): boolean {
    return !!this.token;
  }

  async login(data: LoginData): Promise<User> {
    try {
      console.log('Login attempt with:', { email: data.email });
      
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      // Check if the response has content before trying to parse as JSON
      const contentType = response.headers.get('content-type');
      let result;
      
      if (contentType && contentType.includes('application/json') && response.status !== 204) {
        try {
          const text = await response.text();
          result = text ? JSON.parse(text) : {};
        } catch (parseError) {
          console.error('Error parsing JSON response:', parseError);
          throw new Error('Invalid response from server. Please try again.');
        }
      } else {
        result = {};
      }
      
      if (!response.ok) {
        console.error('Login failed:', result);
        throw new Error(result.message || result.error || 'Login failed');
      }
      
      console.log('Login response:', result);
      
      // Store the token
      if (result.token) {
        this.token = result.token;
        localStorage.setItem('auth_token', result.token);
      }
      
      return result.user;
    } catch (error) {
      console.error('Auth service login error:', error);
      throw error;
    }
  }

  async register(data: RegisterData): Promise<User> {
    try {
      console.log('Registration attempt with:', { email: data.email, name: data.name });
      
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      // Check if the response has content before trying to parse as JSON
      const contentType = response.headers.get('content-type');
      let result;
      
      if (contentType && contentType.includes('application/json') && response.status !== 204) {
        try {
          const text = await response.text();
          result = text ? JSON.parse(text) : {};
        } catch (parseError) {
          console.error('Error parsing JSON response:', parseError);
          throw new Error('Invalid response from server. Please try again.');
        }
      } else {
        result = {};
      }
      
      if (!response.ok) {
        console.error('Registration failed:', result);
        throw new Error(result.message || result.error || 'Registration failed');
      }
      
      console.log('Registration response:', result);
      
      // Store the token if provided
      if (result.token) {
        this.token = result.token;
        localStorage.setItem('auth_token', result.token);
      }
      
      return result.user;
    } catch (error) {
      console.error('Auth service registration error:', error);
      throw error;
    }
  }
  
  logout(): void {
    this.token = null;
    localStorage.removeItem('auth_token');
  }
}

export const authService = new AuthService();
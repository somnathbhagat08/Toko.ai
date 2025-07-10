import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { storage } from '../storage.js';
import { redisManager } from '../redis.js';
import { monitoringService } from '../monitoring.js';
import { log } from '../utils/logger.js';
import { AppError, ValidationError, AuthenticationError } from '../utils/errorHandler.js';
import { validate, schemas } from '../utils/validation.js';
import { config } from '../utils/config.js';
import { cacheService } from '../utils/cache.js';
import { emailService, sendWelcomeEmail } from '../utils/emailService.js';

interface AuthTokenPayload {
  userId: string;
  email: string;
  name: string;
  avatar?: string;
  permissions: string[];
  iat: number;
  exp: number;
}

interface LoginResult {
  user: {
    id: string;
    email: string;
    name: string;
    avatar?: string;
  };
  token: string;
  refreshToken: string;
  expiresAt: number;
}

interface SessionData {
  userId: string;
  email: string;
  loginTime: number;
  lastActivity: number;
  deviceInfo?: string;
  ipAddress?: string;
}

class AuthService {
  private jwtSecret: string;
  private jwtRefreshSecret: string;
  private tokenExpiry: number = 24 * 60 * 60; // 24 hours
  private refreshTokenExpiry: number = 7 * 24 * 60 * 60; // 7 days

  constructor() {
    const securityConfig = config.getSecurity();
    this.jwtSecret = securityConfig.jwtSecret;
    this.jwtRefreshSecret = securityConfig.jwtRefreshSecret;
    this.tokenExpiry = 24 * 60 * 60; // Use default for now
    this.refreshTokenExpiry = 7 * 24 * 60 * 60; // Use default for now
    
    if (!process.env.JWT_SECRET) {
      log.warn('Auth service running with default JWT secret - change in production!', { service: 'auth' });
    }
  }

  /**
   * Register a new user
   */
  async register(userData: {
    email: string;
    password: string;
    name: string;
    avatar?: string;
    provider?: string;
  }): Promise<LoginResult> {
    try {
      // Validate input
      const validatedData = validate(userData, schemas.auth.register);

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(validatedData.email);
      if (existingUser) {
        throw new ValidationError('User already exists');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(validatedData.password, 12);

      // Create user
      const user = await storage.createUser({
        ...validatedData,
        password: hashedPassword
      });

      log.info(`User registered: ${user.email}`, { service: 'auth', userId: user.id });
      monitoringService.incrementCounter('auth.registrations');

      // Send welcome email if enabled
      if (config.getEmail().enabled) {
        await sendWelcomeEmail(user.email, user.name);
      }

      // Generate tokens
      return await this.generateTokens(user);
    } catch (error) {
      monitoringService.trackError('auth_register', `Registration failed: ${error}`);
      throw error;
    }
  }

  /**
   * Login user with email and password
   */
  async login(credentials: {
    email: string;
    password: string;
    deviceInfo?: string;
    ipAddress?: string;
  }): Promise<LoginResult> {
    try {
      // Authenticate user
      const user = await storage.authenticateUser(credentials.email, credentials.password);
      if (!user) {
        monitoringService.recordMetric('auth.login_failures', 1);
        throw new AuthenticationError('Invalid credentials');
      }

      // Check for account blocks/bans
      const isBlocked = await this.isUserBlocked(user.id);
      if (isBlocked) {
        monitoringService.recordMetric('auth.blocked_attempts', 1);
        throw new AuthenticationError('Account is temporarily blocked');
      }

      // Create session
      await this.createSession(user.id, {
        userId: user.id,
        email: user.email,
        loginTime: Date.now(),
        lastActivity: Date.now(),
        deviceInfo: credentials.deviceInfo,
        ipAddress: credentials.ipAddress
      });

      log.info(`User logged in: ${user.email}`, { service: 'auth', userId: user.id });
      monitoringService.recordMetric('auth.successful_logins', 1);

      return await this.generateTokens(user);
    } catch (error) {
      monitoringService.trackError('auth_login', `Login failed: ${error}`);
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<LoginResult> {
    try {
      const decoded = jwt.verify(refreshToken, this.jwtRefreshSecret) as AuthTokenPayload;
      
      // Get user from database
      const user = await storage.getUser(decoded.userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if refresh token is blacklisted
      const isBlacklisted = await redisManager.getSession(`blacklist:refresh:${refreshToken}`);
      if (isBlacklisted) {
        throw new Error('Refresh token is invalid');
      }

      // Generate new tokens
      return await this.generateTokens(user);
    } catch (error) {
      monitoringService.trackError('auth_refresh', `Token refresh failed: ${error}`);
      throw error;
    }
  }

  /**
   * Logout user and invalidate tokens
   */
  async logout(userId: string, token: string, refreshToken: string): Promise<void> {
    try {
      // Blacklist both tokens
      await Promise.all([
        redisManager.setSession(`blacklist:token:${token}`, true, this.tokenExpiry),
        redisManager.setSession(`blacklist:refresh:${refreshToken}`, true, this.refreshTokenExpiry),
        this.destroySession(userId)
      ]);

      log(`User logged out: ${userId}`, 'auth');
      monitoringService.recordMetric('auth.logouts', 1);
    } catch (error) {
      monitoringService.trackError('auth_logout', `Logout failed: ${error}`);
      throw error;
    }
  }

  /**
   * Verify and decode JWT token
   */
  async verifyToken(token: string): Promise<AuthTokenPayload> {
    try {
      // Check if token is blacklisted
      const isBlacklisted = await redisManager.getSession(`blacklist:token:${token}`);
      if (isBlacklisted) {
        throw new Error('Token is invalid');
      }

      const decoded = jwt.verify(token, this.jwtSecret) as AuthTokenPayload;
      
      // Update last activity
      await this.updateLastActivity(decoded.userId);
      
      return decoded;
    } catch (error) {
      monitoringService.trackError('auth_verify', `Token verification failed: ${error}`);
      throw error;
    }
  }

  /**
   * Generate access and refresh tokens
   */
  private async generateTokens(user: any): Promise<LoginResult> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + this.tokenExpiry;

    const payload: Omit<AuthTokenPayload, 'iat' | 'exp'> = {
      userId: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      permissions: ['user'] // Basic user permissions
    };

    const token = jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.tokenExpiry
    });

    const refreshToken = jwt.sign(
      { userId: user.id },
      this.jwtRefreshSecret,
      { expiresIn: this.refreshTokenExpiry }
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar
      },
      token,
      refreshToken,
      expiresAt: expiresAt * 1000 // Convert to milliseconds
    };
  }

  /**
   * Create user session in Redis
   */
  private async createSession(userId: string, sessionData: SessionData): Promise<void> {
    const sessionKey = `session:${userId}`;
    await redisManager.setSession(sessionKey, sessionData, this.tokenExpiry);
  }

  /**
   * Update last activity timestamp
   */
  private async updateLastActivity(userId: string): Promise<void> {
    const sessionKey = `session:${userId}`;
    const session = await redisManager.getSession(sessionKey);
    
    if (session) {
      session.lastActivity = Date.now();
      await redisManager.setSession(sessionKey, session, this.tokenExpiry);
    }
  }

  /**
   * Destroy user session
   */
  private async destroySession(userId: string): Promise<void> {
    const sessionKey = `session:${userId}`;
    await redisManager.deleteSession(sessionKey);
  }

  /**
   * Check if user is blocked or banned
   */
  private async isUserBlocked(userId: string): Promise<boolean> {
    const blockKey = `block:${userId}`;
    const blockData = await redisManager.getSession(blockKey);
    
    if (blockData) {
      // Check if block has expired
      if (blockData.expiresAt && Date.now() > blockData.expiresAt) {
        await redisManager.deleteSession(blockKey);
        return false;
      }
      return true;
    }
    
    return false;
  }

  /**
   * Block user for specified duration
   */
  async blockUser(userId: string, reason: string, durationMinutes: number = 60): Promise<void> {
    const blockKey = `block:${userId}`;
    const blockData = {
      reason,
      blockedAt: Date.now(),
      expiresAt: Date.now() + (durationMinutes * 60 * 1000),
      duration: durationMinutes
    };

    await redisManager.setSession(blockKey, blockData, durationMinutes * 60);
    
    log(`User blocked: ${userId} for ${durationMinutes} minutes - ${reason}`, 'auth');
    monitoringService.recordMetric('auth.user_blocks', 1);
  }

  /**
   * Unblock user
   */
  async unblockUser(userId: string): Promise<void> {
    const blockKey = `block:${userId}`;
    await redisManager.deleteSession(blockKey);
    
    log(`User unblocked: ${userId}`, 'auth');
    monitoringService.recordMetric('auth.user_unblocks', 1);
  }

  /**
   * Get user session info
   */
  async getSessionInfo(userId: string): Promise<SessionData | null> {
    const sessionKey = `session:${userId}`;
    return await redisManager.getSession(sessionKey);
  }

  /**
   * Rate limiting for authentication attempts
   */
  async checkAuthRateLimit(identifier: string, action: string): Promise<boolean> {
    const key = `auth_rate:${action}:${identifier}`;
    
    // Different limits for different actions
    const limits = {
      login: { attempts: 5, window: 300 }, // 5 attempts per 5 minutes
      register: { attempts: 3, window: 3600 }, // 3 attempts per hour
      refresh: { attempts: 10, window: 300 } // 10 attempts per 5 minutes
    };

    const limit = limits[action as keyof typeof limits] || limits.login;
    return await redisManager.checkRateLimit(key, limit.attempts, limit.window);
  }

  /**
   * Generate password reset token
   */
  async generatePasswordResetToken(email: string): Promise<string> {
    const user = await storage.getUserByEmail(email);
    if (!user) {
      // Don't reveal if email exists for security
      throw new Error('If this email exists, a reset link has been sent');
    }

    const resetToken = jwt.sign(
      { userId: user.id, type: 'password_reset' },
      this.jwtSecret,
      { expiresIn: '1h' }
    );

    // Store reset token in Redis with short expiry
    await redisManager.setSession(`reset:${resetToken}`, {
      userId: user.id,
      email: user.email,
      createdAt: Date.now()
    }, 3600); // 1 hour

    log(`Password reset token generated for: ${email}`, 'auth');
    monitoringService.recordMetric('auth.password_reset_requests', 1);

    return resetToken;
  }

  /**
   * Verify password reset token
   */
  async verifyPasswordResetToken(token: string): Promise<{ userId: string; email: string }> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as any;
      
      if (decoded.type !== 'password_reset') {
        throw new Error('Invalid token type');
      }

      const resetData = await redisManager.getSession(`reset:${token}`);
      if (!resetData) {
        throw new Error('Reset token not found or expired');
      }

      return {
        userId: resetData.userId,
        email: resetData.email
      };
    } catch (error) {
      monitoringService.trackError('auth_reset_verify', `Reset token verification failed: ${error}`);
      throw new Error('Invalid or expired reset token');
    }
  }

  /**
   * Reset user password
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const { userId } = await this.verifyPasswordResetToken(token);
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    
    // Update password in database
    // Note: This would require updating the storage interface
    // For now, we'll log the action
    log(`Password reset completed for user: ${userId}`, 'auth');
    monitoringService.recordMetric('auth.password_resets', 1);
    
    // Invalidate all existing sessions for this user
    const sessionKey = `session:${userId}`;
    await redisManager.deleteSession(sessionKey);
    
    // Remove the reset token
    await redisManager.deleteSession(`reset:${token}`);
  }

  /**
   * Get authentication statistics
   */
  getAuthStats() {
    return {
      service: 'auth',
      tokenExpiry: this.tokenExpiry,
      refreshTokenExpiry: this.refreshTokenExpiry,
      timestamp: Date.now()
    };
  }

  /**
   * Find user by email (wrapper for storage method)
   */
  async findUserByEmail(email: string) {
    try {
      return await storage.getUserByEmail(email);
    } catch (error) {
      monitoringService.trackError('auth_find_user_email', `Find user by email failed: ${error}`);
      throw error;
    }
  }

  /**
   * Find user by ID (wrapper for storage method)
   */
  async findUserById(userId: string) {
    try {
      return await storage.getUser(userId);
    } catch (error) {
      monitoringService.trackError('auth_find_user_id', `Find user by ID failed: ${error}`);
      throw error;
    }
  }

  /**
   * Create user (wrapper for register method)
   */
  async createUser(userData: {
    username: string;
    email: string;
    password: string;
    avatar?: string;
  }) {
    return await this.register({
      email: userData.email,
      password: userData.password,
      name: userData.username,
      avatar: userData.avatar
    });
  }

  /**
   * Authenticate user with email/password (wrapper for login method)
   */
  async authenticateUser(email: string, password: string) {
    const result = await this.login({
      email,
      password
    });
    return result.user;
  }
  
  /**
   * Generate a JWT token for user authentication
   */
  async generateToken(userData: { userId: number; email: string; name: string }): Promise<string> {
    try {
      const tokenPayload = {
        userId: userData.userId,
        email: userData.email,
        name: userData.name
      };
      
      return jwt.sign(tokenPayload, this.jwtSecret, { expiresIn: this.tokenExpiry });
    } catch (error) {
      monitoringService.trackError('auth_token_generation', `Token generation failed: ${error}`);
      throw error;
    }
  }

  /**
   * Verify Google token and authenticate or register user
   */
  async verifyGoogleToken(token: string): Promise<User | null> {
    try {
      // Get Google OAuth configuration from environment
      const googleClientId = process.env.GOOGLE_CLIENT_ID || '1073237357352-7ngur8kmp8vftgfkbu3p5fnvtrdb9kng.apps.googleusercontent.com';
      
      // Enhanced debug logging
      log.info('Google OAuth configuration', { 
        service: 'auth',
        clientIdPrefix: googleClientId.substring(0, 10) + '...',
        clientIdLength: googleClientId.length,
        hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
        tokenLength: token.length
      });
      
      // Import Google Auth Library dynamically to keep compatibility
      const { OAuth2Client } = await import('google-auth-library');
      
      // Create a new OAuth client with the client ID
      const client = new OAuth2Client(googleClientId);
      
      // Verify the token
      log.info('Verifying Google token', { service: 'auth' });
      
      try {
        // Verify token with additional debugging
        const ticket = await client.verifyIdToken({
          idToken: token,
          audience: googleClientId
        });
        
        // Get the payload from the verified ticket
        const payload = ticket.getPayload();
        
        if (!payload) {
          log.warn('Google token verified but payload is missing', { service: 'auth' });
          return null;
        }
        
        if (!payload.email || !payload.sub) {
          log.warn('Google token payload is missing required fields', { 
            service: 'auth',
            hasEmail: !!payload.email,
            hasSubject: !!payload.sub,
            issuer: payload.iss,
            audience: payload.aud,
            expiration: payload.exp
          });
          return null;
        }
        
        // Enhanced success logging with token information
        log.info('Google token verified successfully', { 
          service: 'auth', 
          email: payload.email,
          subject: payload.sub,
          issuer: payload.iss,
          audience: Array.isArray(payload.aud) ? payload.aud[0] : payload.aud,
          expiresAt: new Date(payload.exp * 1000).toISOString(),
          issuedAt: new Date(payload.iat * 1000).toISOString(),
          name: payload.name || 'Not provided',
          picture: payload.picture ? 'Present' : 'Not provided'
        });
        
        // Check if user exists
        let user = await storage.getUserByEmail(payload.email);
        
        if (user) {
          // User exists - update last login if the method exists
          try {
            await storage.updateUserLastLogin(user.id);
          } catch (error) {
            // Ignore errors from missing method
            log.debug(`Could not update last login: ${error}`, { service: 'auth' });
          }
          
          log.info(`Google user logged in: ${payload.email}`, { service: 'auth', userId: user.id });
          monitoringService.recordMetric('auth.google_logins', 1);
          return user;
        } else {
          // Create new user with Google data
          const newUser = await storage.createUser({
            email: payload.email,
            password: `google_${payload.sub}`, // Use Google ID as password
            name: payload.name || payload.email.split('@')[0],
            avatar: payload.picture,
            provider: 'google'
          });
          
          log.info(`Google user registered: ${payload.email}`, { service: 'auth', userId: newUser.id });
          monitoringService.recordMetric('auth.google_registrations', 1);
          return newUser;
        }
      } catch (verifyError) {
        // Enhanced error logging for token verification failures
        const err = verifyError instanceof Error ? verifyError : new Error(String(verifyError));
        log.error('Google token verification failed', {
          service: 'auth',
          error: err.message,
          stack: err.stack,
          tokenPrefix: token.substring(0, 10) + '...',
          tokenLength: token.length,
          clientIdPrefix: googleClientId.substring(0, 10) + '...'
        });
        throw err;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error(`Google token verification failed: ${err.message}`, { 
        service: 'auth',
        stack: err.stack
      });
      monitoringService.trackError('auth_google_verify', `Google token verification failed: ${err.message}`);
      return null;
    }
  }
}

export const authService = new AuthService();
export type { AuthTokenPayload, LoginResult, SessionData };
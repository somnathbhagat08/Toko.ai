import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { storage } from '../storage.js';
import { redisManager } from '../redis.js';
import { monitoringService } from '../monitoring-fixed.js';
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

interface PasswordResetToken {
  email: string;
  token: string;
  expiresAt: number;
}

class AuthService {
  private jwtSecret: string;
  private jwtRefreshSecret: string;
  private tokenExpiry: number = 24 * 60 * 60; // 24 hours
  private refreshTokenExpiry: number = 7 * 24 * 60 * 60; // 7 days
  private isHealthy = true;

  constructor() {
    try {
      const securityConfig = config.getSecurity();
      this.jwtSecret = securityConfig.jwtSecret;
      this.jwtRefreshSecret = securityConfig.jwtRefreshSecret;
      
      if (!process.env.JWT_SECRET) {
        log.warn('Auth service running with default JWT secret - change in production!', { service: 'auth' });
      }

      this.setupHealthCheck();
      log.info('Auth service initialized', { service: 'auth' });
    } catch (error) {
      log.error('Failed to initialize auth service', { error: error instanceof Error ? error.message : String(error) });
      this.isHealthy = false;
    }
  }

  private setupHealthCheck() {
    monitoringService.addHealthCheck('auth', async () => {
      const startTime = performance.now();
      
      try {
        // Test JWT signing/verification
        const testToken = jwt.sign({ test: true }, this.jwtSecret, { expiresIn: '1s' });
        jwt.verify(testToken, this.jwtSecret);
        
        return {
          status: 'healthy' as const,
          responseTime: performance.now() - startTime,
          message: 'Auth service is functioning normally',
          details: {
            jwtEnabled: true,
            cacheEnabled: cacheService.isHealthy()
          }
        };
      } catch (error) {
        return {
          status: 'unhealthy' as const,
          responseTime: performance.now() - startTime,
          message: `Auth service error: ${error instanceof Error ? error.message : String(error)}`,
          details: { error: error instanceof Error ? error.message : String(error) }
        };
      }
    });
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
      monitoringService.recordMetric('auth.registrations', 1, { provider: userData.provider || 'local' });

      // Send welcome email if enabled
      if (config.getEmail().enabled) {
        try {
          await sendWelcomeEmail(user.email, user.name);
        } catch (emailError) {
          log.warn('Failed to send welcome email', { 
            error: emailError instanceof Error ? emailError.message : String(emailError),
            userId: user.id 
          });
        }
      }

      // Generate tokens
      return await this.generateTokens(user);
    } catch (error) {
      monitoringService.trackError('auth_register', `Registration failed: ${error instanceof Error ? error.message : String(error)}`);
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
      // Validate input
      const validatedCredentials = validate(credentials, schemas.auth.login);

      // Check for too many failed attempts
      const attemptKey = `login_attempts:${validatedCredentials.email}`;
      const attempts = await redisManager.get(attemptKey);
      
      if (attempts && parseInt(attempts) >= 5) {
        monitoringService.recordMetric('auth.blocked_attempts', 1);
        throw new AuthenticationError('Too many failed login attempts. Please try again later.');
      }

      // Get user and verify password
      const user = await storage.getUserByEmail(validatedCredentials.email);
      if (!user || !await bcrypt.compare(validatedCredentials.password, user.password)) {
        // Increment failed attempts
        await redisManager.setex(attemptKey, 15 * 60, (parseInt(attempts || '0') + 1).toString());
        monitoringService.recordMetric('auth.login_failures', 1);
        throw new AuthenticationError('Invalid credentials');
      }

      // Check if user is blocked
      const isBlocked = await this.isUserBlocked(user.id);
      if (isBlocked) {
        monitoringService.recordMetric('auth.blocked_users', 1);
        throw new AuthenticationError('Account is temporarily blocked');
      }

      // Clear failed attempts on successful login
      await redisManager.del(attemptKey);

      // Create session
      await this.createSession(user.id, {
        userId: user.id,
        email: user.email,
        loginTime: Date.now(),
        lastActivity: Date.now(),
        deviceInfo: validatedCredentials.deviceInfo,
        ipAddress: validatedCredentials.ipAddress
      });

      log.info(`User logged in: ${user.email}`, { service: 'auth', userId: user.id });
      monitoringService.recordMetric('auth.successful_logins', 1);

      return await this.generateTokens(user);
    } catch (error) {
      monitoringService.trackError('auth_login', `Login failed: ${error instanceof Error ? error.message : String(error)}`);
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
      const user = await storage.getUser(parseInt(decoded.userId));
      if (!user) {
        throw new AuthenticationError('User not found');
      }

      // Check if user is still active/not banned
      const isBlocked = await this.isUserBlocked(user.id);
      if (isBlocked) {
        throw new AuthenticationError('Account is blocked');
      }

      return await this.generateTokens(user);
    } catch (error) {
      monitoringService.trackError('auth_refresh', `Token refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Logout user
   */
  async logout(userId: string): Promise<void> {
    try {
      await this.deleteSession(userId);
      
      // Invalidate cached user data
      await cacheService.del(`user:${userId}`);
      
      log.info(`User logged out: ${userId}`, { service: 'auth', userId });
      monitoringService.recordMetric('auth.logouts', 1);
    } catch (error) {
      monitoringService.trackError('auth_logout', `Logout failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Verify JWT token
   */
  async verifyToken(token: string): Promise<AuthTokenPayload> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as AuthTokenPayload;
      
      // Check if user is still active
      const sessionExists = await this.sessionExists(decoded.userId);
      if (!sessionExists) {
        throw new AuthenticationError('Session not found');
      }

      return decoded;
    } catch (error) {
      monitoringService.trackError('auth_verify', `Token verification failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Generate access and refresh tokens
   */
  private async generateTokens(user: any): Promise<LoginResult> {
    const tokenPayload: AuthTokenPayload = {
      userId: user.id.toString(),
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      permissions: user.permissions || [],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + this.tokenExpiry
    };

    const accessToken = jwt.sign(tokenPayload, this.jwtSecret, {
      expiresIn: this.tokenExpiry
    });

    const refreshToken = jwt.sign(
      { userId: user.id.toString(), type: 'refresh' },
      this.jwtRefreshSecret,
      { expiresIn: this.refreshTokenExpiry }
    );

    return {
      user: {
        id: user.id.toString(),
        email: user.email,
        name: user.name,
        avatar: user.avatar
      },
      token: accessToken,
      refreshToken,
      expiresAt: Date.now() + (this.tokenExpiry * 1000)
    };
  }

  /**
   * Create user session
   */
  private async createSession(userId: string, sessionData: SessionData): Promise<void> {
    const sessionKey = `session:${userId}`;
    await redisManager.setex(sessionKey, this.tokenExpiry, JSON.stringify(sessionData));
  }

  /**
   * Delete user session
   */
  private async deleteSession(userId: string): Promise<void> {
    const sessionKey = `session:${userId}`;
    await redisManager.del(sessionKey);
  }

  /**
   * Check if session exists
   */
  private async sessionExists(userId: string): Promise<boolean> {
    const sessionKey = `session:${userId}`;
    const session = await redisManager.get(sessionKey);
    return !!session;
  }

  /**
   * Get user session data
   */
  async getSession(userId: string): Promise<SessionData | null> {
    try {
      const sessionKey = `session:${userId}`;
      const sessionData = await redisManager.get(sessionKey);
      
      if (!sessionData) {
        return null;
      }

      return JSON.parse(sessionData);
    } catch (error) {
      log.error('Failed to get session', { error: error instanceof Error ? error.message : String(error), userId });
      return null;
    }
  }

  /**
   * Update session activity
   */
  async updateSessionActivity(userId: string): Promise<void> {
    try {
      const session = await this.getSession(userId);
      if (session) {
        session.lastActivity = Date.now();
        await this.createSession(userId, session);
      }
    } catch (error) {
      log.error('Failed to update session activity', { error: error instanceof Error ? error.message : String(error), userId });
    }
  }

  /**
   * Block user temporarily
   */
  async blockUser(userId: string, durationMinutes: number, reason: string): Promise<void> {
    const blockKey = `user_block:${userId}`;
    const blockData = {
      reason,
      blockedAt: Date.now(),
      expiresAt: Date.now() + (durationMinutes * 60 * 1000),
      duration: durationMinutes
    };

    await redisManager.setex(blockKey, durationMinutes * 60, JSON.stringify(blockData));
    
    log.info(`User blocked: ${userId} for ${durationMinutes} minutes - ${reason}`, { service: 'auth', userId });
    monitoringService.recordMetric('auth.user_blocks', 1);
  }

  /**
   * Unblock user
   */
  async unblockUser(userId: string): Promise<void> {
    const blockKey = `user_block:${userId}`;
    await redisManager.del(blockKey);
    
    log.info(`User unblocked: ${userId}`, { service: 'auth', userId });
    monitoringService.recordMetric('auth.user_unblocks', 1);
  }

  /**
   * Check if user is blocked
   */
  async isUserBlocked(userId: string): Promise<boolean> {
    try {
      const blockKey = `user_block:${userId}`;
      const blockData = await redisManager.get(blockKey);
      
      if (!blockData) {
        return false;
      }

      const block = JSON.parse(blockData);
      
      // Check if block has expired
      if (Date.now() > block.expiresAt) {
        await this.unblockUser(userId);
        return false;
      }

      return true;
    } catch (error) {
      log.error('Failed to check user block status', { error: error instanceof Error ? error.message : String(error), userId });
      return false;
    }
  }

  /**
   * Get user permissions
   */
  async getUserPermissions(userId: string): Promise<string[]> {
    try {
      // Try cache first
      const cached = await cacheService.get(`permissions:${userId}`);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get from database
      const user = await storage.getUser(parseInt(userId));
      const permissions = user?.permissions || [];

      // Cache for 5 minutes
      await cacheService.setex(`permissions:${userId}`, 300, JSON.stringify(permissions));

      return permissions;
    } catch (error) {
      log.error('Failed to get user permissions', { error: error instanceof Error ? error.message : String(error), userId });
      return [];
    }
  }

  /**
   * Check if user has specific permission
   */
  async hasPermission(userId: string, permission: string): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);
    return permissions.includes(permission) || permissions.includes('admin');
  }

  /**
   * Generate password reset token
   */
  async generatePasswordResetToken(email: string): Promise<string> {
    try {
      const user = await storage.getUserByEmail(email);
      if (!user) {
        throw new ValidationError('User not found');
      }

      const token = jwt.sign(
        { email, type: 'password_reset' },
        this.jwtSecret,
        { expiresIn: '1h' }
      );

      const resetData: PasswordResetToken = {
        email,
        token,
        expiresAt: Date.now() + (60 * 60 * 1000) // 1 hour
      };

      await redisManager.setex(`password_reset:${email}`, 3600, JSON.stringify(resetData));

      log.info(`Password reset token generated for: ${email}`, { service: 'auth' });
      monitoringService.recordMetric('auth.password_reset_requests', 1);

      return token;
    } catch (error) {
      monitoringService.trackError('auth_password_reset', `Password reset failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Reset password using token
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as any;
      
      if (decoded.type !== 'password_reset') {
        throw new ValidationError('Invalid reset token');
      }

      const resetKey = `password_reset:${decoded.email}`;
      const resetData = await redisManager.get(resetKey);
      
      if (!resetData) {
        throw new ValidationError('Reset token expired or invalid');
      }

      const reset: PasswordResetToken = JSON.parse(resetData);
      
      if (reset.token !== token || Date.now() > reset.expiresAt) {
        throw new ValidationError('Reset token expired or invalid');
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Update user password
      await storage.updateUserPassword(decoded.email, hashedPassword);

      // Delete reset token
      await redisManager.del(resetKey);

      // Invalidate all sessions for this user
      const user = await storage.getUserByEmail(decoded.email);
      if (user) {
        await this.deleteSession(user.id.toString());
      }

      log.info(`Password reset completed for: ${decoded.email}`, { service: 'auth' });
      monitoringService.recordMetric('auth.password_resets', 1);

    } catch (error) {
      monitoringService.trackError('auth_password_reset_complete', `Password reset completion failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Health check for the auth service
   */
  isHealthy(): boolean {
    return this.isHealthy;
  }

  /**
   * Get service metrics
   */
  getMetrics() {
    return {
      name: 'auth',
      healthy: this.isHealthy,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  }
}

export const authService = new AuthService();
export { AuthService, type LoginResult, type AuthTokenPayload, type SessionData };

/**
 * Configuration manager for Toko application
 */

// Default configuration values
const defaultConfig = {
  server: {
    port: process.env.PORT || 5001, // Changed to 5001 as default, also respect PORT env var
    host: 'localhost',
    apiVersion: 'v1'
  },
  security: {
    jwtSecret: process.env.JWT_SECRET || 'toko-dev-secret-key-change-in-production',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'toko-dev-refresh-secret-key-change-in-production',
    sessionSecret: process.env.SESSION_SECRET || 'toko-dev-session-secret-key-change-in-production',
    tokenExpiry: 24 * 60 * 60, // 24 hours in seconds
    refreshTokenExpiry: 7 * 24 * 60 * 60, // 7 days in seconds
    passwordSaltRounds: 12,
    corsOrigins: ['http://localhost:5173', 'http://localhost:5000', 'http://localhost:5001'] // Frontend and backend URLs
  },
  database: {
    url: process.env.DATABASE_URL || '',
    useInMemory: !process.env.DATABASE_URL,
    poolSize: 10,
    connectionTimeout: 30000
  },
  redis: {
    url: process.env.REDIS_URL || '',
    enabled: !!process.env.REDIS_URL,
    keyPrefix: 'toko:',
    ttl: 3600 // Default TTL for cached items (1 hour)
  },
  email: {
    enabled: !!process.env.SMTP_HOST,
    host: process.env.SMTP_HOST || '',
    port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || ''
    },
    from: process.env.EMAIL_FROM || 'noreply@toko.chat'
  },
  upload: {
    maxFileSize: 5 * 1024 * 1024, // 5MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    storageDir: './uploads'
  },
  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '1073237357352-7ngur8kmp8vftgfkbu3p5fnvtrdb9kng.apps.googleusercontent.com',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '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',
      redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5001/api/v1/auth/google/callback'
    }
  },
  matchmaking: {
    timeoutSeconds: 30,
    maxQueueSize: 100
  }
};

/**
 * Configuration manager class
 */
class ConfigManager {
  constructor() {
    this.config = defaultConfig;
    
    // Load environment-specific overrides
    this.loadEnvironmentConfig();
  }
  
  /**
   * Load configuration overrides based on current environment
   */
  loadEnvironmentConfig() {
    const env = process.env.NODE_ENV || 'development';
    
    // Log configuration mode
    console.info(`Loading ${env} configuration`);
    
    // Add environment-specific overrides here
    if (env === 'production') {
      // Stricter security settings for production
      this.config.security.corsOrigins = process.env.CORS_ORIGINS ? 
        process.env.CORS_ORIGINS.split(',') : 
        ['https://toko.chat'];
    }
    
    // Validate critical configuration
    this.validateConfig();
  }
  
  /**
   * Validate that critical configuration is properly set
   */
  validateConfig() {
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Check for security issues in production
    if (isProduction) {
      if (this.config.security.jwtSecret === defaultConfig.security.jwtSecret) {
        console.warn('WARNING: Using default JWT secret in production!');
      }
      
      if (!this.config.database.url) {
        console.warn('WARNING: No database URL configured for production!');
      }
    }
  }
  
  /**
   * Get server configuration
   */
  getServer() {
    return this.config.server;
  }
  
  /**
   * Get security configuration
   */
  getSecurity() {
    return this.config.security;
  }
  
  /**
   * Get database configuration
   */
  getDatabase() {
    return this.config.database;
  }
  
  /**
   * Get Redis configuration
   */
  getRedis() {
    return this.config.redis;
  }
  
  /**
   * Get email configuration
   */
  getEmail() {
    return this.config.email;
  }
  
  /**
   * Get upload configuration
   */
  getUpload() {
    return this.config.upload;
  }
  
  /**
   * Get OAuth configuration
   */
  getOAuth() {
    return this.config.oauth;
  }

  /**
   * Get matchmaking configuration
   */
  getMatchmaking() {
    return this.config.matchmaking;
  }
  
  /**
   * Check if running in development mode
   */
  isDevelopment() {
    return process.env.NODE_ENV !== 'production';
  }
}

export const config = new ConfigManager();
export default config;

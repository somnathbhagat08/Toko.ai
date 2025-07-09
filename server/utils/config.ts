import { log } from '../vite.js';
import fs from 'fs';
import path from 'path';

interface ConfigSchema {
  [key: string]: {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    required?: boolean;
    default?: any;
    validation?: (value: any) => boolean;
    description?: string;
  };
}

interface AppConfig {
  // Server configuration
  server: {
    port: number;
    host: string;
    env: string;
    clustering: boolean;
    trustProxy: boolean;
    cors: {
      origins: string[];
      credentials: boolean;
    };
  };

  // Database configuration
  database: {
    url: string;
    maxConnections: number;
    idleTimeout: number;
    connectionTimeout: number;
    retryAttempts: number;
    retryDelay: number;
  };

  // Redis configuration
  redis: {
    url?: string;
    enabled: boolean;
    maxRetries: number;
    retryDelay: number;
  };

  // Security configuration
  security: {
    jwtSecret: string;
    jwtRefreshSecret: string;
    sessionSecret: string;
    bcryptRounds: number;
    rateLimits: {
      general: { requests: number; window: number };
      auth: { requests: number; window: number };
      api: { requests: number; window: number };
    };
  };

  // LiveKit configuration
  livekit: {
    apiKey: string;
    apiSecret: string;
    serverUrl: string;
    enabled: boolean;
  };

  // Monitoring configuration
  monitoring: {
    enabled: boolean;
    metricsInterval: number;
    healthCheckInterval: number;
    retentionDays: number;
  };

  // File upload configuration
  upload: {
    maxFileSize: number;
    allowedTypes: string[];
    storagePath: string;
  };

  // Email configuration
  email: {
    enabled: boolean;
    provider: string;
    smtp?: {
      host: string;
      port: number;
      secure: boolean;
      auth: {
        user: string;
        pass: string;
      };
    };
  };

  // Logging configuration
  logging: {
    level: string;
    format: string;
    fileLogging: boolean;
    maxFiles: number;
    maxSize: string;
  };

  // Feature flags
  features: {
    userRegistration: boolean;
    videoChat: boolean;
    fileSharing: boolean;
    moderationEnabled: boolean;
    analyticsEnabled: boolean;
  };
}

class ConfigManager {
  private config: AppConfig;
  private configPath: string;
  private schema: ConfigSchema;

  constructor() {
    this.configPath = path.join(process.cwd(), 'config.json');
    this.schema = this.defineSchema();
    this.config = this.loadConfig();
    this.validateConfig();
  }

  private defineSchema(): ConfigSchema {
    return {
      'server.port': {
        type: 'number',
        required: true,
        default: 5000,
        validation: (val) => val > 0 && val < 65536,
        description: 'Server port number'
      },
      'server.host': {
        type: 'string',
        required: true,
        default: '0.0.0.0',
        description: 'Server host address'
      },
      'server.env': {
        type: 'string',
        required: true,
        default: 'development',
        validation: (val) => ['development', 'production', 'staging'].includes(val),
        description: 'Application environment'
      },
      'database.url': {
        type: 'string',
        required: true,
        description: 'Database connection URL'
      },
      'database.maxConnections': {
        type: 'number',
        required: false,
        default: 20,
        validation: (val) => val > 0 && val <= 100,
        description: 'Maximum database connections'
      },
      'security.jwtSecret': {
        type: 'string',
        required: true,
        validation: (val) => val.length >= 32,
        description: 'JWT secret key (minimum 32 characters)'
      },
      'security.bcryptRounds': {
        type: 'number',
        required: false,
        default: 12,
        validation: (val) => val >= 10 && val <= 15,
        description: 'BCrypt salt rounds'
      },
      'livekit.apiKey': {
        type: 'string',
        required: false,
        description: 'LiveKit API key'
      },
      'livekit.apiSecret': {
        type: 'string',
        required: false,
        description: 'LiveKit API secret'
      },
      'livekit.serverUrl': {
        type: 'string',
        required: false,
        description: 'LiveKit server URL'
      },
      'upload.maxFileSize': {
        type: 'number',
        required: false,
        default: 10 * 1024 * 1024, // 10MB
        validation: (val) => val > 0,
        description: 'Maximum file upload size in bytes'
      },
      'logging.level': {
        type: 'string',
        required: false,
        default: 'info',
        validation: (val) => ['error', 'warn', 'info', 'debug', 'trace'].includes(val),
        description: 'Logging level'
      }
    };
  }

  private loadConfig(): AppConfig {
    const envConfig = this.loadFromEnvironment();
    const fileConfig = this.loadFromFile();
    
    // Merge configurations (environment variables take precedence)
    const mergedConfig = this.mergeConfigs(fileConfig, envConfig);
    
    return mergedConfig;
  }

  private loadFromEnvironment(): Partial<AppConfig> {
    return {
      server: {
        port: this.parseEnvInt('PORT', 5000),
        host: process.env.HOST || '0.0.0.0',
        env: process.env.NODE_ENV || 'development',
        clustering: process.env.DISABLE_CLUSTERING !== 'true',
        trustProxy: process.env.TRUST_PROXY === 'true',
        cors: {
          origins: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
          credentials: true
        }
      },
      database: {
        url: process.env.DATABASE_URL || 'postgresql://localhost:5432/toko_dev',
        maxConnections: this.parseEnvInt('DB_MAX_CONNECTIONS', 20),
        idleTimeout: this.parseEnvInt('DB_IDLE_TIMEOUT', 30000),
        connectionTimeout: this.parseEnvInt('DB_CONNECTION_TIMEOUT', 10000),
        retryAttempts: this.parseEnvInt('DB_RETRY_ATTEMPTS', 3),
        retryDelay: this.parseEnvInt('DB_RETRY_DELAY', 5000)
      },
      redis: {
        url: process.env.REDIS_URL,
        enabled: !!process.env.REDIS_URL,
        maxRetries: this.parseEnvInt('REDIS_MAX_RETRIES', 3),
        retryDelay: this.parseEnvInt('REDIS_RETRY_DELAY', 1000)
      },
      security: {
        jwtSecret: process.env.JWT_SECRET || 'toko-jwt-secret-change-in-production',
        jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'toko-refresh-secret-change-in-production',
        sessionSecret: process.env.SESSION_SECRET || 'toko-session-secret-change-in-production',
        bcryptRounds: this.parseEnvInt('BCRYPT_ROUNDS', 12),
        rateLimits: {
          general: {
            requests: this.parseEnvInt('RATE_LIMIT_GENERAL_REQUESTS', 1000),
            window: this.parseEnvInt('RATE_LIMIT_GENERAL_WINDOW', 900) // 15 minutes
          },
          auth: {
            requests: this.parseEnvInt('RATE_LIMIT_AUTH_REQUESTS', 10),
            window: this.parseEnvInt('RATE_LIMIT_AUTH_WINDOW', 900) // 15 minutes
          },
          api: {
            requests: this.parseEnvInt('RATE_LIMIT_API_REQUESTS', 100),
            window: this.parseEnvInt('RATE_LIMIT_API_WINDOW', 60) // 1 minute
          }
        }
      },
      livekit: {
        apiKey: process.env.LIVEKIT_API_KEY || '',
        apiSecret: process.env.LIVEKIT_API_SECRET || '',
        serverUrl: process.env.LIVEKIT_SERVER_URL || 'wss://toko-livekit.livekit.cloud',
        enabled: !!(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET)
      },
      monitoring: {
        enabled: process.env.MONITORING_ENABLED !== 'false',
        metricsInterval: this.parseEnvInt('METRICS_INTERVAL', 30000),
        healthCheckInterval: this.parseEnvInt('HEALTH_CHECK_INTERVAL', 60000),
        retentionDays: this.parseEnvInt('METRICS_RETENTION_DAYS', 7)
      },
      upload: {
        maxFileSize: this.parseEnvInt('MAX_FILE_SIZE', 10 * 1024 * 1024),
        allowedTypes: process.env.ALLOWED_FILE_TYPES?.split(',') || ['image/jpeg', 'image/png', 'image/gif'],
        storagePath: process.env.STORAGE_PATH || './uploads'
      },
      email: {
        enabled: process.env.EMAIL_ENABLED === 'true',
        provider: process.env.EMAIL_PROVIDER || 'smtp',
        smtp: {
          host: process.env.SMTP_HOST || 'localhost',
          port: this.parseEnvInt('SMTP_PORT', 587),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER || '',
            pass: process.env.SMTP_PASS || ''
          }
        }
      },
      logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: process.env.LOG_FORMAT || 'json',
        fileLogging: process.env.FILE_LOGGING !== 'false',
        maxFiles: this.parseEnvInt('LOG_MAX_FILES', 5),
        maxSize: process.env.LOG_MAX_SIZE || '10MB'
      },
      features: {
        userRegistration: process.env.FEATURE_USER_REGISTRATION !== 'false',
        videoChat: process.env.FEATURE_VIDEO_CHAT !== 'false',
        fileSharing: process.env.FEATURE_FILE_SHARING === 'true',
        moderationEnabled: process.env.FEATURE_MODERATION !== 'false',
        analyticsEnabled: process.env.FEATURE_ANALYTICS !== 'false'
      }
    };
  }

  private loadFromFile(): Partial<AppConfig> {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(configData);
        log('Configuration loaded from file', 'config');
        return parsed;
      }
    } catch (error) {
      log(`Failed to load config file: ${error}`, 'config');
    }
    return {};
  }

  private mergeConfigs(base: Partial<AppConfig>, override: Partial<AppConfig>): AppConfig {
    const merged = { ...base };
    
    // Deep merge objects
    for (const key in override) {
      if (override[key as keyof AppConfig] !== undefined) {
        if (typeof override[key as keyof AppConfig] === 'object' && !Array.isArray(override[key as keyof AppConfig])) {
          merged[key as keyof AppConfig] = {
            ...merged[key as keyof AppConfig],
            ...override[key as keyof AppConfig]
          } as any;
        } else {
          merged[key as keyof AppConfig] = override[key as keyof AppConfig] as any;
        }
      }
    }
    
    return merged as AppConfig;
  }

  private validateConfig(): void {
    const errors: string[] = [];

    // Validate required fields and types
    for (const [path, schema] of Object.entries(this.schema)) {
      const value = this.getNestedValue(this.config, path);
      
      if (schema.required && (value === undefined || value === null)) {
        errors.push(`Required configuration missing: ${path}`);
        continue;
      }

      if (value !== undefined && schema.validation && !schema.validation(value)) {
        errors.push(`Invalid configuration value for ${path}: ${value}`);
      }
    }

    // Custom validations
    if (this.config.server.env === 'production') {
      if (this.config.security.jwtSecret.includes('change-in-production')) {
        errors.push('JWT secret must be changed in production');
      }
      if (this.config.security.sessionSecret.includes('change-in-production')) {
        errors.push('Session secret must be changed in production');
      }
    }

    if (errors.length > 0) {
      log('Configuration validation errors:', 'config');
      errors.forEach(error => log(`  - ${error}`, 'config'));
      throw new Error('Configuration validation failed');
    }

    log('Configuration validation passed', 'config');
  }

  private parseEnvInt(envVar: string, defaultValue: number): number {
    const value = process.env[envVar];
    if (value === undefined) return defaultValue;
    
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  // Public API
  get(): AppConfig {
    return this.config;
  }

  getServer() {
    return this.config.server;
  }

  getDatabase() {
    return this.config.database;
  }

  getRedis() {
    return this.config.redis;
  }

  getSecurity() {
    return this.config.security;
  }

  getLiveKit() {
    return this.config.livekit;
  }

  getMonitoring() {
    return this.config.monitoring;
  }

  getUpload() {
    return this.config.upload;
  }

  getEmail() {
    return this.config.email;
  }

  getLogging() {
    return this.config.logging;
  }

  getFeatures() {
    return this.config.features;
  }

  // Runtime configuration updates
  updateConfig(updates: Partial<AppConfig>): void {
    this.config = this.mergeConfigs(this.config, updates);
    this.validateConfig();
    log('Configuration updated', 'config');
  }

  // Save current configuration to file
  saveToFile(): void {
    try {
      const configData = JSON.stringify(this.config, null, 2);
      fs.writeFileSync(this.configPath, configData, 'utf8');
      log('Configuration saved to file', 'config');
    } catch (error) {
      log(`Failed to save config file: ${error}`, 'config');
    }
  }

  // Get configuration summary for debugging
  getSummary(): any {
    return {
      environment: this.config.server.env,
      port: this.config.server.port,
      databaseConnected: !!this.config.database.url,
      redisEnabled: this.config.redis.enabled,
      livekitEnabled: this.config.livekit.enabled,
      monitoringEnabled: this.config.monitoring.enabled,
      features: this.config.features
    };
  }
}

// Create singleton instance
export const config = new ConfigManager();

// Export individual getters for convenience
export const getConfig = () => config.get();
export const getServerConfig = () => config.getServer();
export const getDatabaseConfig = () => config.getDatabase();
export const getRedisConfig = () => config.getRedis();
export const getSecurityConfig = () => config.getSecurity();
export const getLiveKitConfig = () => config.getLiveKit();
export const getMonitoringConfig = () => config.getMonitoring();
export const getUploadConfig = () => config.getUpload();
export const getEmailConfig = () => config.getEmail();
export const getLoggingConfig = () => config.getLogging();
export const getFeatureFlags = () => config.getFeatures();

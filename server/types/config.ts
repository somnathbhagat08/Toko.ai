// TypeScript interface for ConfigManager
export interface ConfigManager {
  server: {
    port: number;
    host: string;
    apiVersion: string;
  };
  security: {
    jwtSecret: string;
    jwtRefreshSecret: string;
    sessionSecret: string;
    tokenExpiry: number;
    refreshTokenExpiry: number;
    passwordSaltRounds: number;
    corsOrigins: string[];
  };
  database: {
    url: string;
    useInMemory: boolean;
    poolSize: number;
    connectionTimeout: number;
  };
  redis: {
    url: string;
    enabled: boolean;
    keyPrefix: string;
    ttl: number;
  };
  email: {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
    from: string;
  };
  upload: {
    maxFileSize: number;
    allowedTypes: string[];
    storageDir: string;
  };
  oauth: {
    google: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    };
  };
  matchmaking: {
    timeoutSeconds: number;
    maxQueueSize: number;
  };
  getServer(): ConfigManager['server'];
  getSecurity(): ConfigManager['security'];
  getDatabase(): ConfigManager['database'];
  getRedis(): ConfigManager['redis'];
  getEmail(): ConfigManager['email'];
  getUpload(): ConfigManager['upload'];
  getOAuth(): ConfigManager['oauth'];
  getMatchmaking(): ConfigManager['matchmaking'];
  isDevelopment(): boolean;
}

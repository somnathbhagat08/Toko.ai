// @ts-ignore - External package types may not be available
import { Pool, neonConfig } from '@neondatabase/serverless';
// @ts-ignore - External package types may not be available
import { drizzle } from 'drizzle-orm/neon-serverless';
// @ts-ignore - Types are installed but may not be resolved correctly
import ws from "ws";
import * as schema from "../shared/schema.js";
import { log } from './utils/logger.js';
import { AppError } from './utils/errorHandler.js';
import { createHash } from 'crypto';
import { performance } from 'perf_hooks';

// @ts-ignore - WebSocket constructor assignment
neonConfig.webSocketConstructor = ws;

interface DatabaseConfig {
  connectionString: string;
  maxConnections?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  retryAttempts?: number;
  retryDelay?: number;
  enableMetrics?: boolean;
  enableQueryLogging?: boolean;
  slowQueryThreshold?: number;
  enableCircuitBreaker?: boolean;
}

interface QueryMetrics {
  queryCount: number;
  totalDuration: number;
  avgDuration: number;
  slowQueries: number;
  errors: number;
  lastError?: string;
  lastErrorTime?: Date;
}

interface CircuitBreakerState {
  isOpen: boolean;
  failureCount: number;
  lastFailureTime: Date | null;
  nextAttemptTime: Date | null;
}

interface QueryCacheEntry {
  result: any;
  timestamp: number;
  ttl: number;
}

export class DatabaseError extends AppError {
  constructor(message: string, originalError?: Error) {
    super(message, 500, 'DATABASE_ERROR');
    this.name = 'DatabaseError';
    if (originalError) {
      this.stack = originalError.stack;
    }
  }
}

class DatabaseManager {
  private pool: Pool | null = null;
  private db: ReturnType<typeof drizzle> | null = null;
  private isConnected = false;
  private retryAttempts = 0;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly enableMetrics: boolean;
  private readonly enableQueryLogging: boolean;
  private readonly slowQueryThreshold: number;
  private readonly enableCircuitBreaker: boolean;
  
  // Performance tracking
  private metrics: QueryMetrics = {
    queryCount: 0,
    totalDuration: 0,
    avgDuration: 0,
    slowQueries: 0,
    errors: 0
  };
  
  // Circuit breaker
  private circuitBreaker: CircuitBreakerState = {
    isOpen: false,
    failureCount: 0,
    lastFailureTime: null,
    nextAttemptTime: null
  };
  
  // Query cache
  private queryCache = new Map<string, QueryCacheEntry>();
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute
  private readonly CACHE_DEFAULT_TTL = 300000; // 5 minutes
  
  // Connection monitoring
  private connectionHealthInterval: NodeJS.Timeout | null = null;
  private lastHealthCheck = Date.now();

  constructor(private config: DatabaseConfig) {
    this.maxRetries = config.retryAttempts || 3;
    this.retryDelay = config.retryDelay || 5000;
    this.enableMetrics = config.enableMetrics ?? true;
    this.enableQueryLogging = config.enableQueryLogging ?? false;
    this.slowQueryThreshold = config.slowQueryThreshold || 1000;
    this.enableCircuitBreaker = config.enableCircuitBreaker ?? true;
    
    if (!config.connectionString || config.connectionString === 'postgresql://localhost:5432/toko_dev') {
      log.db("DATABASE_URL not set. Application will fall back to memory storage.");
    } else {
      this.initializeConnection();
      this.startHealthMonitoring();
    }
  }

  private async initializeConnection() {
    try {
      // Check circuit breaker
      if (this.enableCircuitBreaker && this.isCircuitBreakerOpen()) {
        throw new DatabaseError('Circuit breaker is open. Database connection attempts are blocked.');
      }

      this.pool = new Pool({
        connectionString: this.config.connectionString,
        max: this.config.maxConnections || 20,
        idleTimeoutMillis: this.config.idleTimeoutMillis || 30000,
        connectionTimeoutMillis: this.config.connectionTimeoutMillis || 10000,
      });

      this.db = drizzle({ 
        client: this.pool, 
        schema,
        logger: this.enableQueryLogging && process.env.NODE_ENV === 'development'
      });

      // Test the connection
      await this.testConnection();
      this.isConnected = true;
      this.retryAttempts = 0;
      this.resetCircuitBreaker();
      
      log.db('Database connected successfully', {
        maxConnections: this.config.maxConnections,
        enableMetrics: this.enableMetrics,
        enableCircuitBreaker: this.enableCircuitBreaker
      });

    } catch (error) {
      log.error(`Database connection failed: ${error}`);
      this.isConnected = false;
      this.recordFailure();
      
      if (this.retryAttempts < this.maxRetries) {
        this.retryAttempts++;
        log.db(`Retrying database connection in ${this.retryDelay}ms (attempt ${this.retryAttempts}/${this.maxRetries})`);
        
        setTimeout(() => {
          this.initializeConnection();
        }, this.retryDelay);
      } else {
        log.error('Max database connection retries exceeded. Falling back to memory storage.');
        this.openCircuitBreaker();
      }
    }
  }

  private async testConnection() {
    if (!this.pool) throw new DatabaseError('Pool not initialized');
    
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  }

  private startHealthMonitoring() {
    this.connectionHealthInterval = setInterval(async () => {
      try {
        if (this.isConnected) {
          await this.testConnection();
          this.lastHealthCheck = Date.now();
        }
      } catch (error) {
        log.error(`Health check failed: ${error}`);
        this.isConnected = false;
        this.recordFailure();
        this.initializeConnection();
      }
    }, 30000); // Check every 30 seconds
  }

  // Circuit breaker methods
  private isCircuitBreakerOpen(): boolean {
    if (!this.circuitBreaker.isOpen) return false;
    
    const now = Date.now();
    if (this.circuitBreaker.nextAttemptTime && now >= this.circuitBreaker.nextAttemptTime.getTime()) {
      this.circuitBreaker.isOpen = false;
      this.circuitBreaker.failureCount = 0;
      log.db('Circuit breaker reset - attempting reconnection');
      return false;
    }
    
    return true;
  }

  private recordFailure() {
    if (!this.enableCircuitBreaker) return;
    
    this.circuitBreaker.failureCount++;
    this.circuitBreaker.lastFailureTime = new Date();
    
    if (this.circuitBreaker.failureCount >= this.CIRCUIT_BREAKER_THRESHOLD) {
      this.openCircuitBreaker();
    }
  }

  private openCircuitBreaker() {
    if (!this.enableCircuitBreaker) return;
    
    this.circuitBreaker.isOpen = true;
    this.circuitBreaker.nextAttemptTime = new Date(Date.now() + this.CIRCUIT_BREAKER_TIMEOUT);
    
    log.warn('Circuit breaker opened - database access blocked', {
      failureCount: this.circuitBreaker.failureCount,
      nextAttemptTime: this.circuitBreaker.nextAttemptTime
    });
  }

  private resetCircuitBreaker() {
    this.circuitBreaker.isOpen = false;
    this.circuitBreaker.failureCount = 0;
    this.circuitBreaker.lastFailureTime = null;
    this.circuitBreaker.nextAttemptTime = null;
  }

  // Query caching methods
  private getCacheKey(queryFn: Function, params?: any): string {
    const fnString = queryFn.toString();
    const paramString = params ? JSON.stringify(params) : '';
    return createHash('sha256').update(fnString + paramString).digest('hex');
  }

  private getCachedResult<T>(cacheKey: string): T | null {
    const entry = this.queryCache.get(cacheKey);
    if (!entry) return null;
    
    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.queryCache.delete(cacheKey);
      return null;
    }
    
    return entry.result;
  }

  private setCachedResult<T>(cacheKey: string, result: T, ttl: number = this.CACHE_DEFAULT_TTL) {
    this.queryCache.set(cacheKey, {
      result,
      timestamp: Date.now(),
      ttl
    });
  }

  // Metrics tracking
  private recordQueryMetrics(duration: number, error?: Error) {
    if (!this.enableMetrics) return;
    
    this.metrics.queryCount++;
    this.metrics.totalDuration += duration;
    this.metrics.avgDuration = this.metrics.totalDuration / this.metrics.queryCount;
    
    if (duration > this.slowQueryThreshold) {
      this.metrics.slowQueries++;
      log.warn(`Slow query detected: ${duration}ms`, { duration, threshold: this.slowQueryThreshold });
    }
    
    if (error) {
      this.metrics.errors++;
      this.metrics.lastError = error.message;
      this.metrics.lastErrorTime = new Date();
    }
  }

  // Get database instance
  getDb() {
    if (!this.isConnected || !this.db) {
      throw new DatabaseError('Database not connected');
    }
    return this.db;
  }

  // Check if database is connected
  isDbConnected(): boolean {
    return this.isConnected;
  }

  // Execute query with comprehensive error handling and metrics
  async executeQuery<T>(
    queryFn: (db: ReturnType<typeof drizzle>) => Promise<T>,
    options?: { 
      cache?: boolean; 
      cacheTtl?: number; 
      timeout?: number;
      retries?: number;
    }
  ): Promise<T> {
    const startTime = performance.now();
    let error: Error | undefined;
    
    try {
      if (!this.isConnected || !this.db) {
        throw new DatabaseError('Database not available');
      }

      // Check circuit breaker
      if (this.enableCircuitBreaker && this.isCircuitBreakerOpen()) {
        throw new DatabaseError('Circuit breaker is open');
      }

      // Check cache if enabled
      if (options?.cache) {
        const cacheKey = this.getCacheKey(queryFn);
        const cached = this.getCachedResult<T>(cacheKey);
        if (cached) {
          log.debug('Query result returned from cache', { cacheKey });
          return cached;
        }
      }

      // Execute query with timeout
      const timeout = options?.timeout || 30000;
      const result = await Promise.race([
        queryFn(this.db),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new DatabaseError('Query timeout')), timeout)
        )
      ]);

      // Cache result if enabled
      if (options?.cache) {
        const cacheKey = this.getCacheKey(queryFn);
        this.setCachedResult(cacheKey, result, options.cacheTtl);
      }

      return result;

    } catch (err) {
      error = err as Error;
      log.error(`Database query error: ${error.message}`);
      
      // Check if it's a connection error
      if (this.isConnectionError(error)) {
        this.isConnected = false;
        this.recordFailure();
        this.initializeConnection();
      }
      
      throw new DatabaseError(error.message, error);

    } finally {
      const duration = performance.now() - startTime;
      this.recordQueryMetrics(duration, error);
      
      if (this.enableQueryLogging) {
        log.performance('Database query', duration, { 
          success: !error,
          error: error?.message 
        });
      }
    }
  }

  // Enhanced query execution with retry logic
  async executeQueryWithRetry<T>(
    queryFn: (db: ReturnType<typeof drizzle>) => Promise<T>,
    maxRetries: number = 3,
    timeout: number = 30000,
    options?: { cache?: boolean; cacheTtl?: number }
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeQuery(queryFn, { ...options, timeout });
      } catch (error) {
        lastError = error as Error;
        log.error(`Database query attempt ${attempt}/${maxRetries} failed: ${error}`);
        
        // If not the last attempt and it's a retryable error, wait before retrying
        if (attempt < maxRetries && this.isRetryableError(error as Error)) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        } else {
          break;
        }
      }
    }
    
    throw lastError!;
  }

  // Transaction support with enhanced error handling
  async executeTransaction<T>(
    transactionFn: (tx: any) => Promise<T>,
    options?: { timeout?: number; isolationLevel?: string }
  ): Promise<T> {
    const startTime = performance.now();
    let error: Error | undefined;
    
    try {
      if (!this.isConnected || !this.db) {
        throw new DatabaseError('Database not available');
      }

      const timeout = options?.timeout || 30000;
      const result = await Promise.race([
        this.db.transaction(transactionFn),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new DatabaseError('Transaction timeout')), timeout)
        )
      ]);

      return result;

    } catch (err) {
      error = err as Error;
      log.error(`Transaction failed: ${error.message}`);
      throw new DatabaseError(error.message, error);

    } finally {
      const duration = performance.now() - startTime;
      this.recordQueryMetrics(duration, error);
      
      if (this.enableQueryLogging) {
        log.performance('Database transaction', duration, { 
          success: !error,
          error: error?.message 
        });
      }
    }
  }

  // Batch operations with parallel execution
  async executeBatch<T>(
    queries: Array<() => Promise<T>>,
    options?: { concurrency?: number; failFast?: boolean }
  ): Promise<T[]> {
    const startTime = performance.now();
    let error: Error | undefined;
    
    try {
      if (!this.isConnected || !this.db) {
        throw new DatabaseError('Database not available');
      }

      const concurrency = options?.concurrency || 5;
      const failFast = options?.failFast ?? true;
      
      // Execute in batches to control concurrency
      const results: T[] = [];
      for (let i = 0; i < queries.length; i += concurrency) {
        const batch = queries.slice(i, i + concurrency);
        
        if (failFast) {
          const batchResults = await Promise.all(batch.map(query => query()));
          results.push(...batchResults);
        } else {
          const batchResults = await Promise.allSettled(batch.map(query => query()));
          results.push(...batchResults.map(result => {
            if (result.status === 'fulfilled') {
              return result.value;
            } else {
              throw new DatabaseError(result.reason.message);
            }
          }));
        }
      }
      
      return results;

    } catch (err) {
      error = err as Error;
      log.error(`Batch execution failed: ${error.message}`);
      throw new DatabaseError(error.message, error);

    } finally {
      const duration = performance.now() - startTime;
      this.recordQueryMetrics(duration, error);
      
      if (this.enableQueryLogging) {
        log.performance('Database batch operation', duration, { 
          queryCount: queries.length,
          success: !error,
          error: error?.message 
        });
      }
    }
  }

  // Connection warming and keep-alive
  async warmConnection(): Promise<void> {
    if (!this.isConnected) return;
    
    try {
      await this.testConnection();
      log.db('Database connection warmed');
    } catch (error) {
      log.error(`Connection warming failed: ${error}`);
      this.isConnected = false;
      this.recordFailure();
      this.initializeConnection();
    }
  }

  // Query performance analysis
  getQueryAnalytics() {
    return {
      ...this.metrics,
      cacheSize: this.queryCache.size,
      circuitBreaker: this.circuitBreaker,
      connectionAge: Date.now() - this.lastHealthCheck,
      poolStats: this.getPoolStats()
    };
  }

  // Performance monitoring
  getPerformanceMetrics() {
    const stats = this.getPoolStats();
    if (!stats) return null;

    return {
      ...stats,
      connectionUtilization: stats.totalCount > 0 ? 
        ((stats.totalCount - stats.idleCount) / stats.totalCount) * 100 : 0,
      queuePressure: stats.waitingCount > 0 ? 'high' : 'normal',
      healthScore: this.calculateHealthScore(stats),
      metrics: this.metrics,
      circuitBreaker: this.circuitBreaker
    };
  }

  private calculateHealthScore(stats: any): number {
    if (!this.isConnected) return 0;
    
    let score = 100;
    
    // Penalize high utilization
    if (stats.totalCount > 0) {
      const utilization = ((stats.totalCount - stats.idleCount) / stats.totalCount) * 100;
      if (utilization > 90) score -= 30;
      else if (utilization > 70) score -= 15;
    }
    
    // Penalize waiting connections
    if (stats.waitingCount > 0) {
      score -= Math.min(stats.waitingCount * 10, 40);
    }
    
    // Penalize high error rate
    if (this.metrics.queryCount > 0) {
      const errorRate = (this.metrics.errors / this.metrics.queryCount) * 100;
      if (errorRate > 10) score -= 20;
      else if (errorRate > 5) score -= 10;
    }
    
    // Penalize slow queries
    if (this.metrics.queryCount > 0) {
      const slowQueryRate = (this.metrics.slowQueries / this.metrics.queryCount) * 100;
      if (slowQueryRate > 20) score -= 15;
      else if (slowQueryRate > 10) score -= 10;
    }
    
    return Math.max(score, 0);
  }

  // Error classification
  private isConnectionError(error: any): boolean {
    const connectionErrors = [
      'connection terminated',
      'connection closed',
      'connection timeout',
      'connection refused',
      'connection reset',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EPIPE',
      'ENOTFOUND'
    ];
    
    const errorMessage = error.message?.toLowerCase() || '';
    return connectionErrors.some(msg => errorMessage.includes(msg));
  }

  private isRetryableError(error: Error): boolean {
    const retryableErrors = [
      'connection terminated',
      'connection timeout',
      'query timeout',
      'connection reset',
      'ECONNRESET',
      'ETIMEDOUT',
      'temporary failure'
    ];
    
    const errorMessage = error.message?.toLowerCase() || '';
    return retryableErrors.some(msg => errorMessage.includes(msg));
  }

  // Get connection pool stats
  getPoolStats() {
    if (!this.pool) return null;
    
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      isConnected: this.isConnected
    };
  }

  // Comprehensive health check
  async healthCheck() {
    try {
      if (!this.isConnected) {
        return { 
          status: 'unhealthy', 
          message: 'Database disconnected',
          circuitBreaker: this.circuitBreaker
        };
      }
      
      const startTime = performance.now();
      await this.testConnection();
      const responseTime = performance.now() - startTime;
      
      const stats = this.getPoolStats();
      const healthScore = this.calculateHealthScore(stats);
      
      return {
        status: healthScore > 70 ? 'healthy' : healthScore > 40 ? 'degraded' : 'unhealthy',
        message: 'Database health check completed',
        responseTime,
        healthScore,
        stats,
        metrics: this.metrics,
        circuitBreaker: this.circuitBreaker,
        lastHealthCheck: new Date(this.lastHealthCheck)
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Database health check failed: ${error}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // Cache management
  clearCache() {
    this.queryCache.clear();
    log.db('Query cache cleared');
  }

  getCacheStats() {
    return {
      size: this.queryCache.size,
      entries: Array.from(this.queryCache.entries()).map(([key, entry]) => ({
        key,
        age: Date.now() - entry.timestamp,
        ttl: entry.ttl
      }))
    };
  }

  // Graceful shutdown
  async shutdown() {
    try {
      if (this.connectionHealthInterval) {
        clearInterval(this.connectionHealthInterval);
        this.connectionHealthInterval = null;
      }
      
      if (this.pool) {
        await this.pool.end();
        log.db('Database connection pool closed');
      }
      
      this.queryCache.clear();
      this.isConnected = false;
      
      log.db('Database manager shutdown completed');
    } catch (error) {
      log.error(`Error during database shutdown: ${error}`);
    }
  }
}

// Create singleton instance with environment configuration
const databaseManager = new DatabaseManager({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/toko_dev',
  maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20'),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000'),
  retryAttempts: parseInt(process.env.DB_RETRY_ATTEMPTS || '3'),
  retryDelay: parseInt(process.env.DB_RETRY_DELAY || '5000'),
  enableMetrics: process.env.DB_ENABLE_METRICS !== 'false',
  enableQueryLogging: process.env.DB_ENABLE_QUERY_LOGGING === 'true',
  slowQueryThreshold: parseInt(process.env.DB_SLOW_QUERY_THRESHOLD || '1000'),
  enableCircuitBreaker: process.env.DB_ENABLE_CIRCUIT_BREAKER !== 'false'
});

// Export the manager instance
export { databaseManager };

// Safe getters that don't throw if database is unavailable
export const getDb = () => {
  try {
    return databaseManager.getDb();
  } catch {
    return null;
  }
};

export const getPool = () => {
  try {
    return databaseManager.getDb();
  } catch {
    return null;
  }
};

// Legacy exports for backward compatibility
export const pool = getDb();
export const db = getDb();

// Export core database functions
export const isDbConnected = () => databaseManager.isDbConnected();

export const executeQuery = <T>(
  queryFn: (db: ReturnType<typeof drizzle>) => Promise<T>,
  options?: { cache?: boolean; cacheTtl?: number; timeout?: number; retries?: number }
) => databaseManager.executeQuery(queryFn, options);

export const executeQueryWithRetry = <T>(
  queryFn: (db: ReturnType<typeof drizzle>) => Promise<T>,
  maxRetries?: number,
  timeout?: number,
  options?: { cache?: boolean; cacheTtl?: number }
) => databaseManager.executeQueryWithRetry(queryFn, maxRetries, timeout, options);

export const executeTransaction = <T>(
  transactionFn: (tx: any) => Promise<T>,
  options?: { timeout?: number; isolationLevel?: string }
) => databaseManager.executeTransaction(transactionFn, options);

export const executeBatch = <T>(
  queries: Array<() => Promise<T>>,
  options?: { concurrency?: number; failFast?: boolean }
) => databaseManager.executeBatch(queries, options);

// Export monitoring and management functions
export const getDbHealthStatus = () => databaseManager.healthCheck();
export const shutdownDb = () => databaseManager.shutdown();
export const getDbStats = () => databaseManager.getPoolStats();
export const warmConnection = () => databaseManager.warmConnection();
export const getPerformanceMetrics = () => databaseManager.getPerformanceMetrics();
export const getQueryAnalytics = () => databaseManager.getQueryAnalytics();
export const clearQueryCache = () => databaseManager.clearCache();
export const getCacheStats = () => databaseManager.getCacheStats();

// Database utilities for advanced usage
export const withRetry = <T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  backoffMs: number = 1000
): Promise<T> => {
  return new Promise(async (resolve, reject) => {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        resolve(result);
        return;
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) {
          reject(new DatabaseError(`Operation failed after ${maxRetries} attempts: ${lastError.message}`));
          return;
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, backoffMs * Math.pow(2, attempt - 1)));
      }
    }
  });
};

// Database migration utilities placeholder
export const runMigrations = async () => {
  log.db('Running database migrations...');
  // Implementation would depend on your migration strategy
  // This is a placeholder for future migration functionality
};

// Export the DatabaseManager class for advanced usage
export { DatabaseManager };

// Connection event handlers for graceful shutdown
process.on('SIGINT', async () => {
  log.db('Received SIGINT signal. Shutting down database connections gracefully...');
  await databaseManager.shutdown();
});

process.on('SIGTERM', async () => {
  log.db('Received SIGTERM signal. Shutting down database connections gracefully...');
  await databaseManager.shutdown();
});

// Unhandled rejection handler for database errors
process.on('unhandledRejection', (reason, promise) => {
  if (reason instanceof DatabaseError) {
    log.error('Unhandled database rejection:', { reason: reason.message, stack: reason.stack });
  }
});

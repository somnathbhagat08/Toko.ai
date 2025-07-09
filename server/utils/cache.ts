import { redisManager } from '../redis.js';
import { log } from '../vite.js';

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  prefix?: string;
  serialize?: boolean;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class CacheService {
  private memoryCache = new Map<string, CacheEntry<any>>();
  private readonly defaultTTL = 3600; // 1 hour
  private readonly maxMemoryEntries = 1000;

  constructor() {
    // Clean up expired entries every 5 minutes
    setInterval(() => this.cleanupExpiredEntries(), 5 * 60 * 1000);
  }

  // Get from cache
  async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    const { prefix = 'cache' } = options;
    const fullKey = `${prefix}:${key}`;

    try {
      // Try Redis first
      const redisValue = await redisManager.get(fullKey);
      if (redisValue) {
        return options.serialize !== false ? JSON.parse(redisValue) : redisValue;
      }

      // Fallback to memory cache
      const memoryEntry = this.memoryCache.get(fullKey);
      if (memoryEntry && !this.isExpired(memoryEntry)) {
        return memoryEntry.data;
      }

      // Remove expired entry
      if (memoryEntry) {
        this.memoryCache.delete(fullKey);
      }

      return null;
    } catch (error) {
      log(`Cache get error for key ${fullKey}: ${error}`, 'cache');
      return null;
    }
  }

  // Set in cache with TTL (alternative method signature)
  async set<T>(key: string, value: T, ttlOrOptions?: number | CacheOptions): Promise<boolean> {
    let options: CacheOptions;
    
    if (typeof ttlOrOptions === 'number') {
      options = { ttl: ttlOrOptions };
    } else {
      options = ttlOrOptions || {};
    }
    
    const { ttl = this.defaultTTL, prefix = 'cache', serialize = true } = options;
    const fullKey = `${prefix}:${key}`;

    try {
      const dataToStore = serialize ? JSON.stringify(value) : value as string;

      // Store in Redis
      const redisSuccess = await redisManager.setex(fullKey, ttl, dataToStore);

      // Store in memory cache as backup
      if (this.memoryCache.size >= this.maxMemoryEntries) {
        this.evictOldestEntry();
      }

      this.memoryCache.set(fullKey, {
        data: value,
        timestamp: Date.now(),
        ttl: ttl * 1000 // Convert to milliseconds
      });

      return redisSuccess;
    } catch (error) {
      log(`Cache set error for key ${fullKey}: ${error}`, 'cache');
      return false;
    }
  }

  // Alias for set with explicit TTL
  async setex<T>(key: string, ttl: number, value: T, options: CacheOptions = {}): Promise<boolean> {
    return this.set(key, value, { ...options, ttl });
  }

  // Delete from cache (alias for backward compatibility)
  async del(key: string, options: CacheOptions = {}): Promise<boolean> {
    return this.delete(key, options);
  }

  // Delete from cache
  async delete(key: string, options: CacheOptions = {}): Promise<boolean> {
    const { prefix = 'cache' } = options;
    const fullKey = `${prefix}:${key}`;

    try {
      // Delete from Redis
      await redisManager.del(fullKey);

      // Delete from memory cache
      this.memoryCache.delete(fullKey);

      return true;
    } catch (error) {
      log(`Cache delete error for key ${fullKey}: ${error}`, 'cache');
      return false;
    }
  }

  // Cache with automatic refresh
  async getOrSet<T>(
    key: string,
    fetchFunction: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const cached = await this.get<T>(key, options);
    
    if (cached !== null) {
      return cached;
    }

    try {
      const freshData = await fetchFunction();
      await this.set(key, freshData, options);
      return freshData;
    } catch (error) {
      log(`Cache getOrSet fetch error for key ${key}: ${error}`, 'cache');
      throw error;
    }
  }

  // Bulk operations
  async mget<T>(keys: string[], options: CacheOptions = {}): Promise<(T | null)[]> {
    const { prefix = 'cache' } = options;
    const fullKeys = keys.map(key => `${prefix}:${key}`);

    try {
      // Try Redis first
      const redisValues = await redisManager.mget(fullKeys);
      
      if (redisValues && redisValues.length === keys.length) {
        return redisValues.map(value => 
          value ? (options.serialize !== false ? JSON.parse(value) : value) : null
        );
      }

      // Fallback to individual gets
      return Promise.all(keys.map(key => this.get<T>(key, options)));
    } catch (error) {
      log(`Cache mget error: ${error}`, 'cache');
      return keys.map(() => null);
    }
  }

  async mset(entries: Array<{ key: string; value: any }>, options: CacheOptions = {}): Promise<boolean> {
    try {
      const promises = entries.map(({ key, value }) => this.set(key, value, options));
      const results = await Promise.all(promises);
      return results.every(result => result);
    } catch (error) {
      log(`Cache mset error: ${error}`, 'cache');
      return false;
    }
  }

  // Cache patterns for common use cases
  
  // User cache
  async cacheUser(userId: string, userData: any, ttl = 1800): Promise<boolean> {
    return this.set(`user:${userId}`, userData, { ttl, prefix: 'user' });
  }

  async getUser(userId: string): Promise<any> {
    return this.get(`user:${userId}`, { prefix: 'user' });
  }

  // Session cache
  async cacheSession(sessionId: string, sessionData: any, ttl = 86400): Promise<boolean> {
    return this.set(`session:${sessionId}`, sessionData, { ttl, prefix: 'session' });
  }

  async getSession(sessionId: string): Promise<any> {
    return this.get(`session:${sessionId}`, { prefix: 'session' });
  }

  // API response cache
  async cacheApiResponse(endpoint: string, params: string, response: any, ttl = 300): Promise<boolean> {
    const key = `${endpoint}:${this.hashParams(params)}`;
    return this.set(key, response, { ttl, prefix: 'api' });
  }

  async getApiResponse(endpoint: string, params: string): Promise<any> {
    const key = `${endpoint}:${this.hashParams(params)}`;
    return this.get(key, { prefix: 'api' });
  }

  // Statistics cache
  async cacheStats(statsKey: string, stats: any, ttl = 60): Promise<boolean> {
    return this.set(statsKey, stats, { ttl, prefix: 'stats' });
  }

  async getStats(statsKey: string): Promise<any> {
    return this.get(statsKey, { prefix: 'stats' });
  }

  // Cache invalidation patterns
  async invalidatePattern(pattern: string): Promise<number> {
    try {
      const keys = await redisManager.keys(pattern);
      if (keys && keys.length > 0) {
        await redisManager.del(...keys);
        
        // Also clear from memory cache
        for (const key of keys) {
          this.memoryCache.delete(key);
        }
        
        return keys.length;
      }
      return 0;
    } catch (error) {
      log(`Cache invalidation error for pattern ${pattern}: ${error}`, 'cache');
      return 0;
    }
  }

  async invalidateUserCache(userId: string): Promise<void> {
    await this.invalidatePattern(`user:*${userId}*`);
  }

  async invalidateApiCache(endpoint: string): Promise<void> {
    await this.invalidatePattern(`api:${endpoint}:*`);
  }

  // Cache statistics
  getCacheStats() {
    const memorySize = this.memoryCache.size;
    const memoryKeys = Array.from(this.memoryCache.keys());
    const expiredCount = memoryKeys.filter(key => {
      const entry = this.memoryCache.get(key);
      return entry && this.isExpired(entry);
    }).length;

    return {
      memoryEntries: memorySize,
      expiredEntries: expiredCount,
      hitRate: this.calculateHitRate(),
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  // Helper methods
  private isExpired(entry: CacheEntry<any>): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  private evictOldestEntry(): void {
    const oldestKey = Array.from(this.memoryCache.keys())[0];
    if (oldestKey) {
      this.memoryCache.delete(oldestKey);
    }
  }

  private cleanupExpiredEntries(): void {
    for (const [key, entry] of this.memoryCache.entries()) {
      if (this.isExpired(entry)) {
        this.memoryCache.delete(key);
      }
    }
  }

  private hashParams(params: string): string {
    // Simple hash function for cache keys
    let hash = 0;
    for (let i = 0; i < params.length; i++) {
      const char = params.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  private calculateHitRate(): number {
    // This would require tracking hits/misses - simplified for now
    return 0.85; // Mock hit rate
  }

  private estimateMemoryUsage(): number {
    // Rough estimation of memory usage in bytes
    return this.memoryCache.size * 1024; // Simplified
  }

  // Cleanup method
  async cleanup(): Promise<void> {
    this.memoryCache.clear();
    log('Cache service cleaned up', 'cache');
  }
}

export const cacheService = new CacheService();

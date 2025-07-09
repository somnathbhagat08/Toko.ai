import Redis from 'ioredis';
import { log } from './vite.js';

class RedisManager {
  private redis: Redis | null = null;
  private isConnected = false;

  constructor() {
    // Only try to connect if Redis URL is explicitly provided
    if (process.env.REDIS_URL) {
      this.connect();
    } else {
      log('Redis not configured - running without Redis caching', 'redis');
    }
  }

  private async connect() {
    try {
      // Use Redis URL from environment or default to local Redis
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      
      this.redis = new Redis(redisUrl, {
        connectTimeout: 10000,
        lazyConnect: true,
        enableReadyCheck: false,
        maxRetriesPerRequest: 3,
      });

      this.redis.on('connect', () => {
        log('Redis connected successfully', 'redis');
        this.isConnected = true;
      });

      this.redis.on('error', (error) => {
        log(`Redis connection error: ${error.message}`, 'redis');
        this.isConnected = false;
      });

      this.redis.on('ready', () => {
        log('Redis ready for operations', 'redis');
      });

      // Test connection
      await this.redis.ping();
      
    } catch (error) {
      log(`Failed to connect to Redis: ${error}`, 'redis');
      this.isConnected = false;
    }
  }

  // Session management
  async setSession(sessionId: string, data: any, ttl: number = 86400) {
    if (!this.isConnected || !this.redis) return false;
    
    try {
      await this.redis.setex(`session:${sessionId}`, ttl, JSON.stringify(data));
      return true;
    } catch (error) {
      log(`Redis session set error: ${error}`, 'redis');
      return false;
    }
  }

  async getSession(sessionId: string) {
    if (!this.isConnected || !this.redis) return null;
    
    try {
      const data = await this.redis.get(`session:${sessionId}`);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      log(`Redis session get error: ${error}`, 'redis');
      return null;
    }
  }

  async deleteSession(sessionId: string) {
    if (!this.isConnected || !this.redis) return false;
    
    try {
      await this.redis.del(`session:${sessionId}`);
      return true;
    } catch (error) {
      log(`Redis session delete error: ${error}`, 'redis');
      return false;
    }
  }

  // Rate limiting with token bucket
  async checkRateLimit(key: string, limit: number, window: number): Promise<boolean> {
    if (!this.isConnected || !this.redis) return true; // Allow if Redis unavailable
    
    try {
      const current = await this.redis.incr(`rate:${key}`);
      
      if (current === 1) {
        await this.redis.expire(`rate:${key}`, window);
      }
      
      return current <= limit;
    } catch (error) {
      log(`Redis rate limit check error: ${error}`, 'redis');
      return true; // Allow on error
    }
  }

  // Get current rate limit usage
  async getRateLimitUsage(key: string): Promise<number> {
    if (!this.isConnected || !this.redis) return 0;
    
    try {
      const current = await this.redis.get(`rate:${key}`);
      return current ? parseInt(current) : 0;
    } catch (error) {
      log(`Redis rate limit usage error: ${error}`, 'redis');
      return 0;
    }
  }

  // Advanced rate limiting with sliding window
  async checkSlidingWindowRateLimit(key: string, limit: number, window: number): Promise<boolean> {
    if (!this.isConnected || !this.redis) return true;
    
    try {
      const now = Date.now();
      const windowStart = now - (window * 1000);
      
      // Remove old entries
      await this.redis.zremrangebyscore(`sliding:${key}`, 0, windowStart);
      
      // Count current requests
      const current = await this.redis.zcard(`sliding:${key}`);
      
      if (current >= limit) {
        return false;
      }
      
      // Add current request
      await this.redis.zadd(`sliding:${key}`, now, `${now}-${Math.random()}`);
      await this.redis.expire(`sliding:${key}`, window);
      
      return true;
    } catch (error) {
      log(`Redis sliding window rate limit error: ${error}`, 'redis');
      return true;
    }
  }

  // IP-based rate limiting
  async checkIpRateLimit(ip: string, endpoint: string, limit: number, window: number): Promise<boolean> {
    const key = `ip_rate:${ip}:${endpoint}`;
    return this.checkRateLimit(key, limit, window);
  }

  // User-based rate limiting
  async checkUserRateLimit(userId: string, action: string, limit: number, window: number): Promise<boolean> {
    const key = `user_rate:${userId}:${action}`;
    return this.checkRateLimit(key, limit, window);
  }

  // User presence and active connections
  async setUserOnline(userId: string, socketId: string) {
    if (!this.isConnected || !this.redis) return;
    
    try {
      await this.redis.hset('online_users', userId, JSON.stringify({
        socketId,
        lastSeen: Date.now(),
        status: 'online'
      }));
      
      // Set expiry for cleanup
      await this.redis.expire(`user:${userId}:presence`, 300); // 5 minutes
    } catch (error) {
      log(`Redis user online error: ${error}`, 'redis');
    }
  }

  async setUserOffline(userId: string) {
    if (!this.isConnected || !this.redis) return;
    
    try {
      await this.redis.hdel('online_users', userId);
      await this.redis.del(`user:${userId}:presence`);
    } catch (error) {
      log(`Redis user offline error: ${error}`, 'redis');
    }
  }

  async getOnlineUsers(): Promise<string[]> {
    if (!this.isConnected || !this.redis) return [];
    
    try {
      const users = await this.redis.hkeys('online_users');
      return users;
    } catch (error) {
      log(`Redis get online users error: ${error}`, 'redis');
      return [];
    }
  }

  // Pub/Sub for scaling across multiple servers
  async publishToRoom(roomId: string, event: string, data: any) {
    if (!this.isConnected || !this.redis) return;
    
    try {
      await this.redis.publish(`room:${roomId}`, JSON.stringify({ event, data }));
    } catch (error) {
      log(`Redis publish error: ${error}`, 'redis');
    }
  }

  async subscribeToRoom(roomId: string, callback: (event: string, data: any) => void) {
    if (!this.isConnected || !this.redis) return;
    
    try {
      const subscriber = this.redis.duplicate();
      await subscriber.subscribe(`room:${roomId}`);
      
      subscriber.on('message', (channel, message) => {
        try {
          const { event, data } = JSON.parse(message);
          callback(event, data);
        } catch (error) {
          log(`Redis subscribe parse error: ${error}`, 'redis');
        }
      });
      
      return subscriber;
    } catch (error) {
      log(`Redis subscribe error: ${error}`, 'redis');
    }
  }

  // Chat room analytics
  async incrementRoomStats(roomId: string, metric: string) {
    if (!this.isConnected || !this.redis) return;
    
    try {
      const today = new Date().toISOString().split('T')[0];
      await this.redis.hincrby(`stats:${today}`, `${roomId}:${metric}`, 1);
      await this.redis.expire(`stats:${today}`, 86400 * 7); // Keep for 7 days
    } catch (error) {
      log(`Redis stats error: ${error}`, 'redis');
    }
  }

  async getRoomStats(roomId: string, days: number = 7) {
    if (!this.isConnected || !this.redis) return {};
    
    try {
      const stats: any = {};
      const today = new Date();
      
      for (let i = 0; i < days; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        const dayStats = await this.redis.hgetall(`stats:${dateStr}`);
        stats[dateStr] = dayStats;
      }
      
      return stats;
    } catch (error) {
      log(`Redis get stats error: ${error}`, 'redis');
      return {};
    }
  }

  // Basic Redis operations
  async get(key: string): Promise<string | null> {
    if (!this.isConnected || !this.redis) return null;
    
    try {
      return await this.redis.get(key);
    } catch (error) {
      log(`Redis get error: ${error}`, 'redis');
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<boolean> {
    if (!this.isConnected || !this.redis) return false;
    
    try {
      if (ttl) {
        await this.redis.setex(key, ttl, value);
      } else {
        await this.redis.set(key, value);
      }
      return true;
    } catch (error) {
      log(`Redis set error: ${error}`, 'redis');
      return false;
    }
  }

  async setex(key: string, ttl: number, value: string): Promise<boolean> {
    if (!this.isConnected || !this.redis) return false;
    
    try {
      await this.redis.setex(key, ttl, value);
      return true;
    } catch (error) {
      log(`Redis setex error: ${error}`, 'redis');
      return false;
    }
  }

  async del(...keys: string[]): Promise<number> {
    if (!this.isConnected || !this.redis) return 0;
    
    try {
      return await this.redis.del(...keys);
    } catch (error) {
      log(`Redis del error: ${error}`, 'redis');
      return 0;
    }
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (!this.isConnected || !this.redis) return keys.map(() => null);
    
    try {
      return await this.redis.mget(...keys);
    } catch (error) {
      log(`Redis mget error: ${error}`, 'redis');
      return keys.map(() => null);
    }
  }

  async keys(pattern: string): Promise<string[]> {
    if (!this.isConnected || !this.redis) return [];
    
    try {
      return await this.redis.keys(pattern);
    } catch (error) {
      log(`Redis keys error: ${error}`, 'redis');
      return [];
    }
  }

  async exists(...keys: string[]): Promise<number> {
    if (!this.isConnected || !this.redis) return 0;
    
    try {
      return await this.redis.exists(...keys);
    } catch (error) {
      log(`Redis exists error: ${error}`, 'redis');
      return 0;
    }
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    if (!this.isConnected || !this.redis) return false;
    
    try {
      const result = await this.redis.expire(key, seconds);
      return result === 1;
    } catch (error) {
      log(`Redis expire error: ${error}`, 'redis');
      return false;
    }
  }

  isReady(): boolean {
    return this.isConnected;
  }

  async ping(): Promise<boolean> {
    if (!this.isConnected || !this.redis) return false;
    
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      log(`Redis ping error: ${error}`, 'redis');
      return false;
    }
  }

  async disconnect() {
    if (this.redis) {
      await this.redis.disconnect();
      this.isConnected = false;
    }
  }
}

export const redisManager = new RedisManager();
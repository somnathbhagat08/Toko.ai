import { Socket } from 'socket.io';
import { redisManager } from '../redis.js';
import { monitoringService } from '../monitoring-fixed.js';
import { log } from '../utils/logger.js';
import { AppError, ValidationError } from '../utils/errorHandler.js';
import { validate, schemas } from '../utils/validation.js';
import { config } from '../utils/config.js';
import { cacheService } from '../utils/cache.js';

interface OnlineUser {
  id: string;
  name: string;
  avatar?: string;
  tags: string[];
  country: string;
  socketId: string;
  joinedAt: number;
  lastActivity: number;
  status: 'online' | 'away' | 'busy' | 'invisible';
  location?: {
    city?: string;
    timezone?: string;
  };
}

interface PresenceEvent {
  type: 'user_online' | 'user_offline' | 'user_activity' | 'bulk_update' | 'status_change';
  user?: OnlineUser;
  users?: OnlineUser[];
  timestamp: number;
  metadata?: Record<string, any>;
}

interface PresenceMetrics {
  totalOnline: number;
  byCountry: Record<string, number>;
  byStatus: Record<string, number>;
  averageSessionDuration: number;
}

class PresenceService {
  private onlineUsers = new Map<string, OnlineUser>();
  private userSockets = new Map<string, string>(); // userId -> socketId
  private socketUsers = new Map<string, string>(); // socketId -> userId
  private activityTimeout = 5 * 60 * 1000; // 5 minutes
  private sessionStartTimes = new Map<string, number>();
  private _isHealthy = true;

  private cleanupInterval?: NodeJS.Timeout;
  private broadcastInterval?: NodeJS.Timeout;

  constructor() {
    try {
      this.setupHealthCheck();
      this.startIntervals();
      log.info('Presence service initialized', { service: 'presence' });
    } catch (error) {
      log.error('Failed to initialize presence service', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      this._isHealthy = false;
    }
  }

  private setupHealthCheck() {
    monitoringService.addHealthCheck('presence', async () => {
      const startTime = performance.now();
      
      try {
        const onlineCount = this.onlineUsers.size;
        const socketMappings = this.userSockets.size;
        
        return {
          status: 'healthy' as const,
          responseTime: performance.now() - startTime,
          message: 'Presence service is functioning normally',
          details: {
            onlineUsers: onlineCount,
            socketMappings,
            cacheEnabled: true
          }
        };
      } catch (error) {
        return {
          status: 'unhealthy' as const,
          responseTime: performance.now() - startTime,
          message: `Presence service error: ${error instanceof Error ? error.message : String(error)}`,
          details: { error: error instanceof Error ? error.message : String(error) }
        };
      }
    });
  }

  private startIntervals() {
    // Clean up inactive users every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveUsers();
    }, 60 * 1000);

    // Broadcast presence updates every 30 seconds
    this.broadcastInterval = setInterval(() => {
      this.broadcastPresenceUpdate();
    }, 30 * 1000);
  }

  /**
   * User comes online - socket connection established
   */
  async setUserOnline(userId: string, socketId: string, userInfo: {
    name: string;
    avatar?: string;
    tags: string[];
    country: string;
    status?: 'online' | 'away' | 'busy' | 'invisible';
    location?: {
      city?: string;
      timezone?: string;
    };
  }, io: any): Promise<void> {
    try {
      const now = Date.now();
      
      // Remove any existing connection for this user
      await this.setUserOffline(userId, io);

      // Create user presence record
      const user: OnlineUser = {
        id: userId,
        name: userInfo.name,
        avatar: userInfo.avatar,
        tags: userInfo.tags || [],
        country: userInfo.country,
        socketId,
        joinedAt: now,
        lastActivity: now,
        status: userInfo.status || 'online',
        location: userInfo.location
      };

      // Update mappings
      this.onlineUsers.set(userId, user);
      this.userSockets.set(userId, socketId);
      this.socketUsers.set(socketId, userId);
      this.sessionStartTimes.set(userId, now);

      // Cache user presence in Redis
      await redisManager.setex(`presence:${userId}`, this.activityTimeout / 1000, JSON.stringify({
        socketId,
        joinedAt: now,
        lastActivity: now,
        status: user.status
      }));

      // Update user count by country
      await this.updateCountryStats(userInfo.country, 1);

      log.info('User came online', { 
        userId, 
        socketId, 
        country: userInfo.country,
        status: user.status,
        totalOnline: this.onlineUsers.size 
      });

      monitoringService.recordMetric('presence.users_online', 1, {
        country: userInfo.country,
        status: user.status
      });

      // Notify other users (exclude invisible users)
      if (user.status !== 'invisible') {
        const event: PresenceEvent = {
          type: 'user_online',
          user,
          timestamp: now
        };
        
        io.emit('presence:user_online', event);
      }

    } catch (error) {
      log.error('Failed to set user online', { 
        error: error instanceof Error ? error.message : String(error), 
        userId, 
        socketId 
      });
      monitoringService.trackError('presence_user_online', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * User goes offline - socket disconnection
   */
  async setUserOffline(userId: string, io: any): Promise<void> {
    try {
      const user = this.onlineUsers.get(userId);
      if (!user) {
        return;
      }

      // Calculate session duration
      const sessionStart = this.sessionStartTimes.get(userId);
      const sessionDuration = sessionStart ? Date.now() - sessionStart : 0;

      // Clean up mappings
      this.onlineUsers.delete(userId);
      this.userSockets.delete(userId);
      this.socketUsers.delete(user.socketId);
      this.sessionStartTimes.delete(userId);

      // Remove from Redis
      await redisManager.del(`presence:${userId}`);

      // Update country stats
      await this.updateCountryStats(user.country, -1);

      log.info('User went offline', { 
        userId, 
        socketId: user.socketId, 
        country: user.country,
        sessionDuration,
        totalOnline: this.onlineUsers.size 
      });

      monitoringService.recordMetric('presence.users_offline', 1, {
        country: user.country,
        status: user.status
      });
      monitoringService.recordMetric('presence.session_duration', sessionDuration);

      // Notify other users (exclude if user was invisible)
      if (user.status !== 'invisible') {
        const event: PresenceEvent = {
          type: 'user_offline',
          user,
          timestamp: Date.now(),
          metadata: { sessionDuration }
        };
        
        io.emit('presence:user_offline', event);
      }

    } catch (error) {
      log.error('Failed to set user offline', { 
        error: error instanceof Error ? error.message : String(error), 
        userId 
      });
      monitoringService.trackError('presence_user_offline', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Update user activity timestamp
   */
  async updateActivity(userId: string, io?: any): Promise<void> {
    try {
      const user = this.onlineUsers.get(userId);
      if (!user) {
        return;
      }

      const now = Date.now();
      const timeSinceLastActivity = now - user.lastActivity;

      // Only update if significant time has passed (avoid spam)
      if (timeSinceLastActivity < 30000) { // 30 seconds
        return;
      }

      user.lastActivity = now;

      // Update Redis cache
      await redisManager.setex(`presence:${userId}`, this.activityTimeout / 1000, JSON.stringify({
        socketId: user.socketId,
        joinedAt: user.joinedAt,
        lastActivity: now,
        status: user.status
      }));

      // If user was away, set back to online
      if (user.status === 'away') {
        await this.updateUserStatus(userId, 'online', io);
      }

      monitoringService.recordMetric('presence.activity_updates', 1);

    } catch (error) {
      log.error('Failed to update user activity', { 
        error: error instanceof Error ? error.message : String(error), 
        userId 
      });
    }
  }

  /**
   * Update user status (online, away, busy, invisible)
   */
  async updateUserStatus(userId: string, status: 'online' | 'away' | 'busy' | 'invisible', io?: any): Promise<void> {
    try {
      const user = this.onlineUsers.get(userId);
      if (!user) {
        return;
      }

      const oldStatus = user.status;
      user.status = status;
      user.lastActivity = Date.now();

      // Update Redis cache
      await redisManager.setex(`presence:${userId}`, this.activityTimeout / 1000, JSON.stringify({
        socketId: user.socketId,
        joinedAt: user.joinedAt,
        lastActivity: user.lastActivity,
        status
      }));

      log.info('User status updated', { 
        userId, 
        oldStatus, 
        newStatus: status 
      });

      monitoringService.recordMetric('presence.status_changes', 1, {
        from: oldStatus,
        to: status
      });

      // Notify other users about status change
      if (io && (oldStatus !== 'invisible' || status !== 'invisible')) {
        const event: PresenceEvent = {
          type: 'status_change',
          user,
          timestamp: Date.now(),
          metadata: { oldStatus }
        };
        
        io.emit('presence:status_change', event);
      }

    } catch (error) {
      log.error('Failed to update user status', { 
        error: error instanceof Error ? error.message : String(error), 
        userId, 
        status 
      });
      monitoringService.trackError('presence_status_update', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Get all online users (filtered by visibility)
   */
  getOnlineUsers(includeInvisible: boolean = false): OnlineUser[] {
    return Array.from(this.onlineUsers.values())
      .filter(user => includeInvisible || user.status !== 'invisible')
      .sort((a, b) => b.lastActivity - a.lastActivity); // Most recent activity first
  }

  /**
   * Get online users by country
   */
  getOnlineUsersByCountry(country: string, includeInvisible: boolean = false): OnlineUser[] {
    return this.getOnlineUsers(includeInvisible)
      .filter(user => user.country === country);
  }

  /**
   * Get online users by tags/interests
   */
  getOnlineUsersByTags(tags: string[], includeInvisible: boolean = false): OnlineUser[] {
    return this.getOnlineUsers(includeInvisible)
      .filter(user => user.tags.some(tag => tags.includes(tag)));
  }

  /**
   * Check if user is online
   */
  isUserOnline(userId: string): boolean {
    return this.onlineUsers.has(userId);
  }

  /**
   * Get user by socket ID
   */
  getUserBySocket(socketId: string): OnlineUser | null {
    const userId = this.socketUsers.get(socketId);
    return userId ? this.onlineUsers.get(userId) || null : null;
  }

  /**
   * Get socket ID for user
   */
  getSocketForUser(userId: string): string | null {
    return this.userSockets.get(userId) || null;
  }

  /**
   * Get presence metrics
   */
  getMetrics(): PresenceMetrics {
    const users = Array.from(this.onlineUsers.values());
    
    // Group by country
    const byCountry: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    
    for (const user of users) {
      byCountry[user.country] = (byCountry[user.country] || 0) + 1;
      byStatus[user.status] = (byStatus[user.status] || 0) + 1;
    }

    // Calculate average session duration
    const currentTime = Date.now();
    const sessionDurations = Array.from(this.sessionStartTimes.values())
      .map(startTime => currentTime - startTime);
    
    const averageSessionDuration = sessionDurations.length > 0
      ? sessionDurations.reduce((sum, duration) => sum + duration, 0) / sessionDurations.length
      : 0;

    return {
      totalOnline: users.length,
      byCountry,
      byStatus,
      averageSessionDuration
    };
  }

  /**
   * Clean up inactive users
   */
  private cleanupInactiveUsers(): void {
    try {
      const now = Date.now();
      const inactiveUsers: string[] = [];

      for (const [userId, user] of this.onlineUsers.entries()) {
        const timeSinceActivity = now - user.lastActivity;
        
        if (timeSinceActivity > this.activityTimeout) {
          inactiveUsers.push(userId);
        } else if (timeSinceActivity > (this.activityTimeout / 2) && user.status === 'online') {
          // Auto-set to away after half the timeout period
          user.status = 'away';
        }
      }

      // Remove inactive users
      for (const userId of inactiveUsers) {
        const user = this.onlineUsers.get(userId);
        if (user) {
          log.info('Cleaning up inactive user', { userId, socketId: user.socketId });
          this.onlineUsers.delete(userId);
          this.userSockets.delete(userId);
          this.socketUsers.delete(user.socketId);
          this.sessionStartTimes.delete(userId);
          
          monitoringService.recordMetric('presence.inactive_cleanups', 1);
        }
      }

      if (inactiveUsers.length > 0) {
        log.info('Cleaned up inactive users', { count: inactiveUsers.length });
      }

    } catch (error) {
      log.error('Error during inactive user cleanup', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Broadcast presence update to all connected clients
   */
  private async broadcastPresenceUpdate(): Promise<void> {
    try {
      // Only broadcast if there are users online
      if (this.onlineUsers.size === 0) {
        return;
      }

      const metrics = this.getMetrics();
      
      // Update cached metrics for quick access
      await cacheService.set('presence:metrics', JSON.stringify(metrics), 60);

      monitoringService.recordMetric('presence.broadcast_updates', 1);

    } catch (error) {
      log.error('Error during presence broadcast', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Update country statistics
   */
  private async updateCountryStats(country: string, delta: number): Promise<void> {
    try {
      const current = await redisManager.get(`country_stats:${country}`);
      const count = Math.max(0, (parseInt(current || '0') + delta));
      
      if (count > 0) {
        await redisManager.setex(`country_stats:${country}`, 300, count.toString());
      } else {
        await redisManager.del(`country_stats:${country}`);
      }
    } catch (error) {
      log.error('Failed to update country stats', { 
        error: error instanceof Error ? error.message : String(error), 
        country, 
        delta 
      });
    }
  }

  /**
   * Get country statistics from cache
   */
  async getCountryStats(): Promise<Record<string, number>> {
    try {
      const stats: Record<string, number> = {};
      const keys = await redisManager.keys('country_stats:*');
      
      for (const key of keys) {
        const country = key.replace('country_stats:', '');
        const count = await redisManager.get(key);
        if (count) {
          stats[country] = parseInt(count);
        }
      }
      
      return stats;
    } catch (error) {
      log.error('Failed to get country stats', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return {};
    }
  }

  /**
   * Disconnect user by socket ID
   */
  async disconnectUser(socketId: string, io: any, reason: string = 'manual_disconnect'): Promise<void> {
    try {
      const userId = this.socketUsers.get(socketId);
      if (userId) {
        await this.setUserOffline(userId, io);
        
        log.info('User disconnected', { userId, socketId, reason });
        monitoringService.recordMetric('presence.manual_disconnects', 1, { reason });
      }
    } catch (error) {
      log.error('Failed to disconnect user', { 
        error: error instanceof Error ? error.message : String(error), 
        socketId, 
        reason 
      });
    }
  }

  /**
   * Shutdown the presence service
   */
  async shutdown(): Promise<void> {
    try {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
      }
      if (this.broadcastInterval) {
        clearInterval(this.broadcastInterval);
      }

      // Clear all presence data
      this.onlineUsers.clear();
      this.userSockets.clear();
      this.socketUsers.clear();
      this.sessionStartTimes.clear();

      // Clean up Redis keys
      const keys = await redisManager.keys('presence:*');
      if (keys.length > 0) {
        await Promise.all(keys.map(key => redisManager.del(key)));
      }

      log.info('Presence service shutdown completed', { service: 'presence' });
    } catch (error) {
      log.error('Error during presence shutdown', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Health check
   */
  isHealthy(): boolean {
    return this._isHealthy;
  }
}

export const presenceService = new PresenceService();
export { PresenceService, type OnlineUser, type PresenceEvent, type PresenceMetrics };

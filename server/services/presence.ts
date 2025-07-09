import { Socket } from 'socket.io';
import { redisManager } from '../redis';
import { monitoringService } from '../monitoring';

interface OnlineUser {
  id: string;
  name: string;
  avatar?: string;
  tags: string[];
  country: string;
  socketId: string;
  joinedAt: number;
  lastActivity: number;
}

interface PresenceEvent {
  type: 'user_online' | 'user_offline' | 'user_activity' | 'bulk_update';
  user?: OnlineUser;
  users?: OnlineUser[];
  timestamp: number;
}

class PresenceService {
  private onlineUsers = new Map<string, OnlineUser>();
  private userSockets = new Map<string, string>(); // userId -> socketId
  private socketUsers = new Map<string, string>(); // socketId -> userId
  private activityTimeout = 5 * 60 * 1000; // 5 minutes
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up inactive users every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveUsers();
    }, 60 * 1000);
  }

  /**
   * User comes online - socket connection established
   */
  async setUserOnline(userId: string, socketId: string, userInfo: {
    name: string;
    avatar?: string;
    tags: string[];
    country: string;
  }, io: any): Promise<void> {
    const now = Date.now();
    
    // Remove any existing connection for this user
    await this.setUserOffline(userId, io);

    const onlineUser: OnlineUser = {
      id: userId,
      socketId,
      joinedAt: now,
      lastActivity: now,
      ...userInfo
    };

    this.onlineUsers.set(userId, onlineUser);
    this.userSockets.set(userId, socketId);
    this.socketUsers.set(socketId, userId);

    // Update Redis for persistence across server instances
    await redisManager.setUserOnline(userId, socketId);

    // Broadcast presence update
    const event: PresenceEvent = {
      type: 'user_online',
      user: onlineUser,
      timestamp: now
    };

    io.emit('presence:update', event);
    
    // Send current online users to the newly connected user
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit('presence:bulk_update', {
        type: 'bulk_update',
        users: Array.from(this.onlineUsers.values()),
        timestamp: now
      });
    }

    monitoringService.recordMetric('presence.user_online', 1);
    console.log(`[presence] User ${userInfo.name} (${userId}) came online`);
  }

  /**
   * User goes offline - socket disconnection
   */
  async setUserOffline(userId: string, io: any): Promise<void> {
    const user = this.onlineUsers.get(userId);
    if (!user) return;

    const socketId = this.userSockets.get(userId);
    
    this.onlineUsers.delete(userId);
    this.userSockets.delete(userId);
    if (socketId) {
      this.socketUsers.delete(socketId);
    }

    // Update Redis
    await redisManager.setUserOffline(userId);

    // Broadcast presence update
    const event: PresenceEvent = {
      type: 'user_offline',
      user,
      timestamp: Date.now()
    };

    io.emit('presence:update', event);

    monitoringService.recordMetric('presence.user_offline', 1);
    console.log(`[presence] User ${user.name} (${userId}) went offline`);
  }

  /**
   * Update user activity timestamp
   */
  async updateUserActivity(socketId: string, io: any): Promise<void> {
    const userId = this.socketUsers.get(socketId);
    if (!userId) return;

    const user = this.onlineUsers.get(userId);
    if (!user) return;

    const now = Date.now();
    user.lastActivity = now;

    // Broadcast activity update (optional - can be used for "last seen" indicators)
    const event: PresenceEvent = {
      type: 'user_activity',
      user,
      timestamp: now
    };

    io.emit('presence:activity', event);
  }

  /**
   * Get all online users
   */
  getOnlineUsers(): OnlineUser[] {
    return Array.from(this.onlineUsers.values());
  }

  /**
   * Get online users by tags/interests
   */
  getOnlineUsersByTags(tags: string[]): OnlineUser[] {
    return this.getOnlineUsers().filter(user => 
      user.tags.some(tag => tags.includes(tag))
    );
  }

  /**
   * Get online users by country
   */
  getOnlineUsersByCountry(country: string): OnlineUser[] {
    return this.getOnlineUsers().filter(user => 
      user.country === country || country === "Any on Earth"
    );
  }

  /**
   * Get user by socket ID
   */
  getUserBySocket(socketId: string): OnlineUser | undefined {
    const userId = this.socketUsers.get(socketId);
    return userId ? this.onlineUsers.get(userId) : undefined;
  }

  /**
   * Check if user is online
   */
  isUserOnline(userId: string): boolean {
    return this.onlineUsers.has(userId);
  }

  /**
   * Get online statistics
   */
  getStats() {
    const users = this.getOnlineUsers();
    const countries = new Map<string, number>();
    const tags = new Map<string, number>();

    users.forEach(user => {
      // Count by country
      countries.set(user.country, (countries.get(user.country) || 0) + 1);
      
      // Count by tags
      user.tags.forEach(tag => {
        tags.set(tag, (tags.get(tag) || 0) + 1);
      });
    });

    return {
      totalOnline: users.length,
      byCountry: Object.fromEntries(countries),
      byTags: Object.fromEntries(tags),
      averageSessionTime: this.calculateAverageSessionTime(),
      newUsersToday: users.filter(u => Date.now() - u.joinedAt < 24 * 60 * 60 * 1000).length
    };
  }

  /**
   * Handle socket disconnection
   */
  async handleSocketDisconnect(socketId: string, io: any): Promise<void> {
    const userId = this.socketUsers.get(socketId);
    if (userId) {
      await this.setUserOffline(userId, io);
    }
  }

  /**
   * Cleanup inactive users
   */
  private cleanupInactiveUsers(): void {
    const now = Date.now();
    const usersToRemove: string[] = [];

    this.onlineUsers.forEach((user, userId) => {
      if (now - user.lastActivity > this.activityTimeout) {
        usersToRemove.push(userId);
      }
    });

    usersToRemove.forEach(userId => {
      console.log(`[presence] Cleaning up inactive user: ${userId}`);
      this.onlineUsers.delete(userId);
      const socketId = this.userSockets.get(userId);
      if (socketId) {
        this.socketUsers.delete(socketId);
        this.userSockets.delete(userId);
      }
    });
  }

  /**
   * Calculate average session time
   */
  private calculateAverageSessionTime(): number {
    const users = this.getOnlineUsers();
    if (users.length === 0) return 0;

    const totalTime = users.reduce((sum, user) => 
      sum + (Date.now() - user.joinedAt), 0
    );

    return Math.round(totalTime / users.length / 1000); // in seconds
  }

  /**
   * Subscribe to presence events
   */
  subscribeToPresence(socket: Socket, io: any, callback: (event: PresenceEvent) => void): void {
    socket.on('presence:subscribe', () => {
      // Send current state
      callback({
        type: 'bulk_update',
        users: this.getOnlineUsers(),
        timestamp: Date.now()
      });
    });

    socket.on('presence:activity', () => {
      this.updateUserActivity(socket.id, io);
    });
  }

  /**
   * Cleanup and shutdown the service
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.onlineUsers.clear();
    this.userSockets.clear();
    this.socketUsers.clear();
  }

  /**
   * Add user to presence system (alias for setUserOnline)
   */
  async addUser(userId: string, data: {
    socketId: string;
    connectedAt: Date;
    lastSeen: Date;
    name?: string;
    avatar?: string;
    tags?: string[];
    country?: string;
  }): Promise<void> {
    await this.setUserOnline(userId, data.socketId, {
      name: data.name || `User-${userId}`,
      avatar: data.avatar,
      tags: data.tags || [],
      country: data.country || 'Unknown'
    }, null);
  }

  /**
   * Remove user from presence system (alias for setUserOffline)
   */
  async removeUser(userId: string): Promise<void> {
    await this.setUserOffline(userId, null);
  }

  /**
   * Get list of online users
   */
  getOnlineUsers(): OnlineUser[] {
    return Array.from(this.onlineUsers.values());
  }
}

export const presenceService = new PresenceService();

// Export types for use in other modules
export type { OnlineUser, PresenceEvent };
import { redisManager } from '../redis.js';
import { monitoringService } from '../monitoring-fixed.js';
import { log } from '../utils/logger.js';
import { AppError, ValidationError } from '../utils/errorHandler.js';
import { validate, schemas } from '../utils/validation.js';
import { config } from '../utils/config.js';
import { cacheService } from '../utils/cache.js';

interface UserProfile {
  id: string;
  socketId: string;
  interests: string[];
  gender?: string;
  genderPreference?: string;
  countryPreference?: string;
  chatMode: 'text' | 'video';
  location?: {
    country: string;
    timezone: string;
  };
  preferences: {
    ageRange?: [number, number];
    language?: string;
    verified?: boolean;
  };
  joinedAt: number;
}

interface MatchResult {
  user1: UserProfile;
  user2: UserProfile;
  roomId: string;
  compatibility: number;
  matchedOn: string[];
}

interface MatchmakingMetrics {
  totalMatches: number;
  averageWaitTime: number;
  successRate: number;
  activeUsers: number;
}

class MatchmakingService {
  private waitingQueue = new Map<string, UserProfile>();
  private activeMatches = new Map<string, MatchResult>();
  private matchingInProgress = new Set<string>();
  private userWaitTimes = new Map<string, number>();
  private matchHistory = new Map<string, string[]>(); // userId -> array of matched userIds
  private _isHealthy = true;

  private cleanupInterval?: NodeJS.Timeout;
  private processingInterval?: NodeJS.Timeout;

  constructor() {
    try {
      this.setupHealthCheck();
      this.startIntervals();
      log.info('Matchmaking service initialized', { service: 'matchmaking' });
    } catch (error) {
      log.error('Failed to initialize matchmaking service', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      this._isHealthy = false;
    }
  }

  private setupHealthCheck() {
    monitoringService.addHealthCheck('matchmaking', async () => {
      const startTime = performance.now();
      
      try {
        const queueSize = this.waitingQueue.size;
        const activeMatchesCount = this.activeMatches.size;
        
        return {
          status: 'healthy' as const,
          responseTime: performance.now() - startTime,
          message: 'Matchmaking service is functioning normally',
          details: {
            queueSize,
            activeMatchesCount,
            matchingInProgress: this.matchingInProgress.size,
            cacheEnabled: true
          }
        };
      } catch (error) {
        return {
          status: 'unhealthy' as const,
          responseTime: performance.now() - startTime,
          message: `Matchmaking service error: ${error instanceof Error ? error.message : String(error)}`,
          details: { error: error instanceof Error ? error.message : String(error) }
        };
      }
    });
  }

  private startIntervals() {
    // Cleanup stale entries every minute
    this.cleanupInterval = setInterval(() => this.cleanupStaleEntries(), 60000);
    
    // Process waiting queue every 5 seconds
    this.processingInterval = setInterval(() => this.processWaitingQueue(), 5000);
  }

  async addToQueue(profile: UserProfile): Promise<MatchResult | null> {
    try {
      // Validate profile
      const validatedProfile = validate(profile, schemas.matchmaking.join);

      // Prevent duplicate entries
      if (this.waitingQueue.has(profile.socketId) || this.matchingInProgress.has(profile.socketId)) {
        log.warn('User already in queue or being matched', { socketId: profile.socketId, userId: profile.id });
        return null;
      }

      // Check for recent matches to avoid immediate re-matching
      if (await this.hasRecentMatch(profile.id)) {
        const waitTime = await this.getMinWaitTime(profile.id);
        if (waitTime > 0) {
          throw new ValidationError(`Please wait ${Math.ceil(waitTime / 60)} more minutes before matching again`);
        }
      }

      // Add to queue
      this.waitingQueue.set(profile.socketId, profile);
      this.userWaitTimes.set(profile.socketId, Date.now());

      log.info('User added to matchmaking queue', { 
        socketId: profile.socketId, 
        userId: profile.id,
        queueSize: this.waitingQueue.size 
      });

      monitoringService.recordMetric('matchmaking.queue_joins', 1, {
        chatMode: profile.chatMode,
        hasPreferences: profile.preferences ? 'true' : 'false'
      });

      // Try immediate matching
      const match = await this.findMatch(profile);
      if (match) {
        await this.createMatch(match.user1, match.user2);
        return match;
      }

      return null;
    } catch (error) {
      monitoringService.trackError('matchmaking_add_queue', `Failed to add user to queue: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async removeFromQueue(socketId: string): Promise<void> {
    try {
      const profile = this.waitingQueue.get(socketId);
      
      if (profile) {
        this.waitingQueue.delete(socketId);
        this.userWaitTimes.delete(socketId);
        this.matchingInProgress.delete(socketId);

        log.info('User removed from matchmaking queue', { 
          socketId, 
          userId: profile.id,
          queueSize: this.waitingQueue.size 
        });

        monitoringService.recordMetric('matchmaking.queue_leaves', 1);
      }
    } catch (error) {
      monitoringService.trackError('matchmaking_remove_queue', `Failed to remove user from queue: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async processWaitingQueue(): Promise<void> {
    if (this.waitingQueue.size < 2) {
      return;
    }

    try {
      const profiles = Array.from(this.waitingQueue.values());
      
      for (const profile of profiles) {
        if (this.matchingInProgress.has(profile.socketId)) {
          continue;
        }

        const match = await this.findMatch(profile);
        if (match) {
          await this.createMatch(match.user1, match.user2);
        }
      }
    } catch (error) {
      log.error('Error processing waiting queue', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      monitoringService.trackError('matchmaking_process_queue', error instanceof Error ? error.message : String(error));
    }
  }

  private async findMatch(profile: UserProfile): Promise<MatchResult | null> {
    const candidates = Array.from(this.waitingQueue.values())
      .filter(candidate => 
        candidate.socketId !== profile.socketId &&
        !this.matchingInProgress.has(candidate.socketId) &&
        this.isCompatible(profile, candidate)
      );

    if (candidates.length === 0) {
      return null;
    }

    // Sort by compatibility and wait time
    const scoredCandidates = candidates.map(candidate => ({
      candidate,
      compatibility: this.calculateCompatibility(profile, candidate),
      waitTime: Date.now() - (this.userWaitTimes.get(candidate.socketId) || Date.now())
    }));

    scoredCandidates.sort((a, b) => {
      // Prioritize compatibility, but also consider wait time
      const compatibilityDiff = b.compatibility - a.compatibility;
      if (Math.abs(compatibilityDiff) < 0.1) {
        return b.waitTime - a.waitTime; // Longer wait time gets priority
      }
      return compatibilityDiff;
    });

    const bestMatch = scoredCandidates[0];
    if (bestMatch.compatibility < 0.3) {
      return null; // Minimum compatibility threshold
    }

    const roomId = this.generateRoomId();
    const matchedOn = this.getMatchCriteria(profile, bestMatch.candidate);

    return {
      user1: profile,
      user2: bestMatch.candidate,
      roomId,
      compatibility: bestMatch.compatibility,
      matchedOn
    };
  }

  private isCompatible(user1: UserProfile, user2: UserProfile): boolean {
    // Basic compatibility checks
    if (user1.chatMode !== user2.chatMode) {
      return false;
    }

    // Check if users have already been matched recently
    const user1History = this.matchHistory.get(user1.id) || [];
    if (user1History.includes(user2.id)) {
      return false;
    }

    // Location preference check
    if (user1.countryPreference && user2.location?.country !== user1.countryPreference) {
      return false;
    }
    if (user2.countryPreference && user1.location?.country !== user2.countryPreference) {
      return false;
    }

    // Gender preference check
    if (user1.genderPreference && user2.gender !== user1.genderPreference) {
      return false;
    }
    if (user2.genderPreference && user1.gender !== user2.genderPreference) {
      return false;
    }

    return true;
  }

  private calculateCompatibility(user1: UserProfile, user2: UserProfile): number {
    let score = 0.5; // Base compatibility

    // Interest matching
    const commonInterests = user1.interests.filter(interest => 
      user2.interests.includes(interest)
    );
    const interestScore = commonInterests.length / Math.max(user1.interests.length, user2.interests.length, 1);
    score += interestScore * 0.4;

    // Location bonus
    if (user1.location?.country === user2.location?.country) {
      score += 0.2;
    }

    // Timezone compatibility
    if (user1.location?.timezone === user2.location?.timezone) {
      score += 0.1;
    }

    // Verification bonus
    if (user1.preferences.verified && user2.preferences.verified) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  private getMatchCriteria(user1: UserProfile, user2: UserProfile): string[] {
    const criteria: string[] = [];

    if (user1.interests.some(interest => user2.interests.includes(interest))) {
      criteria.push('shared_interests');
    }
    if (user1.location?.country === user2.location?.country) {
      criteria.push('same_country');
    }
    if (user1.chatMode === user2.chatMode) {
      criteria.push('chat_mode');
    }

    return criteria;
  }

  private async createMatch(user1: UserProfile, user2: UserProfile): Promise<void> {
    try {
      // Mark users as being matched
      this.matchingInProgress.add(user1.socketId);
      this.matchingInProgress.add(user2.socketId);

      // Remove from waiting queue
      this.waitingQueue.delete(user1.socketId);
      this.waitingQueue.delete(user2.socketId);

      // Calculate wait times
      const user1WaitTime = Date.now() - (this.userWaitTimes.get(user1.socketId) || Date.now());
      const user2WaitTime = Date.now() - (this.userWaitTimes.get(user2.socketId) || Date.now());

      this.userWaitTimes.delete(user1.socketId);
      this.userWaitTimes.delete(user2.socketId);

      // Create match record
      const roomId = this.generateRoomId();
      const match: MatchResult = {
        user1,
        user2,
        roomId,
        compatibility: this.calculateCompatibility(user1, user2),
        matchedOn: this.getMatchCriteria(user1, user2)
      };

      this.activeMatches.set(roomId, match);

      // Update match history
      this.updateMatchHistory(user1.id, user2.id);
      this.updateMatchHistory(user2.id, user1.id);

      // Cache match for quick access
      await cacheService.set(`match:${roomId}`, JSON.stringify(match), 3600);

      log.info('Match created successfully', {
        roomId,
        user1: user1.id,
        user2: user2.id,
        compatibility: match.compatibility,
        user1WaitTime,
        user2WaitTime
      });

      monitoringService.recordMetric('matchmaking.matches_created', 1, {
        chatMode: user1.chatMode,
        compatibility: match.compatibility.toString()
      });
      monitoringService.recordMetric('matchmaking.wait_time', user1WaitTime);
      monitoringService.recordMetric('matchmaking.wait_time', user2WaitTime);

    } catch (error) {
      // Clean up on error
      this.matchingInProgress.delete(user1.socketId);
      this.matchingInProgress.delete(user2.socketId);
      
      log.error('Failed to create match', { 
        error: error instanceof Error ? error.message : String(error),
        user1: user1.id,
        user2: user2.id
      });
      
      monitoringService.trackError('matchmaking_create_match', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private updateMatchHistory(userId: string, matchedUserId: string): void {
    if (!this.matchHistory.has(userId)) {
      this.matchHistory.set(userId, []);
    }
    
    const history = this.matchHistory.get(userId)!;
    history.push(matchedUserId);
    
    // Keep only last 10 matches to prevent memory issues
    if (history.length > 10) {
      history.shift();
    }
  }

  private async hasRecentMatch(userId: string): Promise<boolean> {
    try {
      const lastMatch = await redisManager.get(`last_match:${userId}`);
      if (!lastMatch) return false;

      const lastMatchTime = parseInt(lastMatch);
      const minWaitTime = 5 * 60 * 1000; // 5 minutes
      
      return (Date.now() - lastMatchTime) < minWaitTime;
    } catch (error) {
      log.error('Error checking recent match', { error: error instanceof Error ? error.message : String(error), userId });
      return false;
    }
  }

  private async getMinWaitTime(userId: string): Promise<number> {
    try {
      const lastMatch = await redisManager.get(`last_match:${userId}`);
      if (!lastMatch) return 0;

      const lastMatchTime = parseInt(lastMatch);
      const minWaitTime = 5 * 60 * 1000; // 5 minutes
      const elapsed = Date.now() - lastMatchTime;
      
      return Math.max(0, minWaitTime - elapsed);
    } catch (error) {
      return 0;
    }
  }

  async endMatch(roomId: string, reason: string = 'completed'): Promise<void> {
    try {
      const match = this.activeMatches.get(roomId);
      if (!match) {
        return;
      }

      // Remove from active matches
      this.activeMatches.delete(roomId);

      // Clean up matching in progress
      this.matchingInProgress.delete(match.user1.socketId);
      this.matchingInProgress.delete(match.user2.socketId);

      // Record last match time
      await redisManager.setex(`last_match:${match.user1.id}`, 300, Date.now().toString());
      await redisManager.setex(`last_match:${match.user2.id}`, 300, Date.now().toString());

      // Remove from cache
      await cacheService.delete(`match:${roomId}`);

      log.info('Match ended', { roomId, reason, user1: match.user1.id, user2: match.user2.id });
      monitoringService.recordMetric('matchmaking.matches_ended', 1, { reason });

    } catch (error) {
      log.error('Failed to end match', { 
        error: error instanceof Error ? error.message : String(error), 
        roomId 
      });
      monitoringService.trackError('matchmaking_end_match', error instanceof Error ? error.message : String(error));
    }
  }

  getMatch(roomId: string): MatchResult | null {
    return this.activeMatches.get(roomId) || null;
  }

  async getMatchFromCache(roomId: string): Promise<MatchResult | null> {
    try {
      const cached = await cacheService.get(`match:${roomId}`);
      return cached ? JSON.parse(cached as string) : null;
    } catch (error) {
      log.error('Failed to get match from cache', { error: error instanceof Error ? error.message : String(error), roomId });
      return null;
    }
  }

  getQueueSize(): number {
    return this.waitingQueue.size;
  }

  getActiveMatchesCount(): number {
    return this.activeMatches.size;
  }

  getMetrics(): MatchmakingMetrics {
    const waitTimes = Array.from(this.userWaitTimes.values())
      .map(startTime => Date.now() - startTime);
    
    const averageWaitTime = waitTimes.length > 0 
      ? waitTimes.reduce((sum, time) => sum + time, 0) / waitTimes.length 
      : 0;

    return {
      totalMatches: this.activeMatches.size,
      averageWaitTime,
      successRate: 0.85, // This would be calculated from historical data
      activeUsers: this.waitingQueue.size
    };
  }

  private generateRoomId(): string {
    return `room_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  private cleanupStaleEntries(): void {
    try {
      const now = Date.now();
      const maxWaitTime = 30 * 60 * 1000; // 30 minutes

      // Clean up stale queue entries
      for (const [socketId, profile] of this.waitingQueue.entries()) {
        const waitTime = this.userWaitTimes.get(socketId);
        if (waitTime && (now - waitTime) > maxWaitTime) {
          this.waitingQueue.delete(socketId);
          this.userWaitTimes.delete(socketId);
          this.matchingInProgress.delete(socketId);
          
          log.info('Removed stale queue entry', { socketId, userId: profile.id });
          monitoringService.recordMetric('matchmaking.stale_removals', 1);
        }
      }

      // Clean up stale matching in progress
      for (const socketId of this.matchingInProgress) {
        if (!this.waitingQueue.has(socketId) && !this.isInActiveMatch(socketId)) {
          this.matchingInProgress.delete(socketId);
        }
      }

    } catch (error) {
      log.error('Error during cleanup', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private isInActiveMatch(socketId: string): boolean {
    for (const match of this.activeMatches.values()) {
      if (match.user1.socketId === socketId || match.user2.socketId === socketId) {
        return true;
      }
    }
    return false;
  }

  async shutdown(): Promise<void> {
    try {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
      }
      if (this.processingInterval) {
        clearInterval(this.processingInterval);
      }

      // Clear all queues and matches
      this.waitingQueue.clear();
      this.activeMatches.clear();
      this.matchingInProgress.clear();
      this.userWaitTimes.clear();
      this.matchHistory.clear();

      log.info('Matchmaking service shutdown completed', { service: 'matchmaking' });
    } catch (error) {
      log.error('Error during matchmaking shutdown', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  isHealthy(): boolean {
    return this._isHealthy;
  }
}

export const matchmakingService = new MatchmakingService();
export { MatchmakingService, type UserProfile, type MatchResult, type MatchmakingMetrics };

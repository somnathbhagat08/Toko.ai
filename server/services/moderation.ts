import { redisManager } from '../redis.js';
import { monitoringService } from '../monitoring.js';
import { log } from '../vite.js';

interface ModerationResult {
  allowed: boolean;
  filtered: string;
  confidence: number;
  flags: string[];
  severity: 'low' | 'medium' | 'high';
}

interface UserViolation {
  userId: string;
  type: string;
  content: string;
  timestamp: number;
  severity: string;
  action: string;
}

class ModerationService {
  private profanityWords: Set<string>;
  private spamPatterns: RegExp[];
  private suspiciousPatterns: RegExp[];

  constructor() {
    this.initializeProfanityFilter();
    this.initializeSpamDetection();
    this.initializeSuspiciousPatterns();
  }

  private initializeProfanityFilter() {
    // Basic profanity list - in production, use a comprehensive filter service
    this.profanityWords = new Set([
      // Add actual profanity words here - using placeholders for example
      'badword1', 'badword2', 'spam', 'scam'
    ]);
  }

  private initializeSpamDetection() {
    this.spamPatterns = [
      /(.)\1{4,}/g, // Repeated characters (aaaaa)
      /\b(https?:\/\/[^\s]+)\b/gi, // URLs
      /\b[\w._%+-]+@[\w.-]+\.[A-Z]{2,}\b/gi, // Email addresses
      /\b\d{3}[\-\.\s]?\d{3}[\-\.\s]?\d{4}\b/g, // Phone numbers
      /(\b\w+\b\s*){10,}/g, // Very long messages
      /[A-Z]{5,}/g, // Excessive caps
      /(.{1,10})\1{3,}/g // Repeated phrases
    ];
  }

  private initializeSuspiciousPatterns() {
    this.suspiciousPatterns = [
      /\b(meet|hookup|dating|sex|cam|nude|porn)\b/gi,
      /\b(money|cash|pay|buy|sell|invest|crypto|bitcoin)\b/gi,
      /\b(whatsapp|telegram|kik|snapchat|instagram|discord)\b/gi,
      /\b(download|click|link|visit|watch|subscribe)\b/gi
    ];
  }

  /**
   * Moderate text content for chat messages
   */
  async moderateText(content: string, userId: string): Promise<ModerationResult> {
    try {
      const result: ModerationResult = {
        allowed: true,
        filtered: content,
        confidence: 0,
        flags: [],
        severity: 'low'
      };

      // Check for empty or very short content
      if (!content || content.trim().length < 1) {
        result.allowed = false;
        result.flags.push('empty_content');
        return result;
      }

      // Check content length
      if (content.length > 500) {
        result.allowed = false;
        result.flags.push('too_long');
        result.severity = 'medium';
        monitoringService.recordMetric('moderation.rejected', 1, { reason: 'too_long' });
        return result;
      }

      // Profanity filtering
      const profanityResult = this.filterProfanity(content);
      if (profanityResult.detected) {
        result.filtered = profanityResult.filtered;
        result.flags.push('profanity');
        result.confidence += 0.8;
        result.severity = 'high';
      }

      // Spam detection
      const spamResult = this.detectSpam(content);
      if (spamResult.isSpam) {
        result.allowed = false;
        result.flags.push(...spamResult.flags);
        result.confidence += 0.9;
        result.severity = 'high';
      }

      // Suspicious content detection
      const suspiciousResult = this.detectSuspiciousContent(content);
      if (suspiciousResult.isSuspicious) {
        result.flags.push(...suspiciousResult.flags);
        result.confidence += suspiciousResult.confidence;
        result.severity = suspiciousResult.confidence > 0.7 ? 'high' : 'medium';
      }

      // Rate limiting check
      const rateLimitPassed = await this.checkUserMessageRate(userId);
      if (!rateLimitPassed) {
        result.allowed = false;
        result.flags.push('rate_limit');
        result.severity = 'medium';
      }

      // Final decision
      if (result.confidence > 0.8 || result.flags.includes('rate_limit')) {
        result.allowed = false;
      }

      // Log violation if needed
      if (!result.allowed || result.flags.length > 0) {
        await this.logViolation(userId, 'message', content, result);
      }

      // Track metrics
      monitoringService.recordMetric('moderation.checks', 1);
      if (!result.allowed) {
        monitoringService.recordMetric('moderation.rejected', 1, { 
          flags: result.flags.join(','),
          severity: result.severity 
        });
      }

      return result;
    } catch (error) {
      log(`Moderation error: ${error}`, 'moderation');
      monitoringService.trackError('moderation', `Content moderation failed: ${error}`);
      
      // Fail-safe: allow content but log the error
      return {
        allowed: true,
        filtered: content,
        confidence: 0,
        flags: ['moderation_error'],
        severity: 'low'
      };
    }
  }

  /**
   * Filter profanity from text
   */
  private filterProfanity(text: string): { detected: boolean; filtered: string } {
    let filtered = text;
    let detected = false;

    for (const word of this.profanityWords) {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      if (regex.test(filtered)) {
        detected = true;
        filtered = filtered.replace(regex, '*'.repeat(word.length));
      }
    }

    return { detected, filtered };
  }

  /**
   * Detect spam patterns in text
   */
  private detectSpam(text: string): { isSpam: boolean; flags: string[] } {
    const flags: string[] = [];

    for (const pattern of this.spamPatterns) {
      if (pattern.test(text)) {
        if (pattern.source.includes('https?')) flags.push('url');
        else if (pattern.source.includes('@')) flags.push('email');
        else if (pattern.source.includes('\\d{3}')) flags.push('phone');
        else if (pattern.source.includes('{10,}')) flags.push('too_long');
        else if (pattern.source.includes('[A-Z]{5,}')) flags.push('excessive_caps');
        else if (pattern.source.includes(')\\1{4,}')) flags.push('repeated_chars');
        else flags.push('spam_pattern');
      }
    }

    return {
      isSpam: flags.length > 0,
      flags
    };
  }

  /**
   * Detect suspicious content
   */
  private detectSuspiciousContent(text: string): { 
    isSuspicious: boolean; 
    flags: string[]; 
    confidence: number 
  } {
    const flags: string[] = [];
    let confidence = 0;

    for (const pattern of this.suspiciousPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        flags.push('suspicious_keywords');
        confidence += matches.length * 0.2;
      }
    }

    return {
      isSuspicious: flags.length > 0,
      flags,
      confidence: Math.min(confidence, 1.0)
    };
  }

  /**
   * Check user message rate limiting
   */
  private async checkUserMessageRate(userId: string): Promise<boolean> {
    const key = `msg_rate:${userId}`;
    // Allow 10 messages per minute
    return await redisManager.checkRateLimit(key, 10, 60);
  }

  /**
   * Log user violation for tracking and potential action
   */
  private async logViolation(
    userId: string, 
    type: string, 
    content: string, 
    result: ModerationResult
  ): Promise<void> {
    const violation: UserViolation = {
      userId,
      type,
      content: content.substring(0, 100), // Store only first 100 chars
      timestamp: Date.now(),
      severity: result.severity,
      action: result.allowed ? 'filtered' : 'blocked'
    };

    // Store violation in Redis
    const violationKey = `violation:${userId}:${Date.now()}`;
    await redisManager.setSession(violationKey, violation, 86400 * 7); // 7 days

    // Update user violation count
    const countKey = `violation_count:${userId}`;
    const currentCount = await redisManager.getSession(countKey) || 0;
    await redisManager.setSession(countKey, currentCount + 1, 86400 * 30); // 30 days

    log(`Violation logged for user ${userId}: ${result.flags.join(', ')}`, 'moderation');

    // Check if user should be auto-blocked
    if (currentCount >= 5) {
      await this.autoBlockUser(userId, 'multiple_violations');
    }
  }

  /**
   * Automatically block user for violations
   */
  private async autoBlockUser(userId: string, reason: string): Promise<void> {
    const blockKey = `autoblock:${userId}`;
    const blockData = {
      reason,
      blockedAt: Date.now(),
      duration: 60, // 1 hour
      automatic: true
    };

    await redisManager.setSession(blockKey, blockData, 3600); // 1 hour
    
    log(`User auto-blocked: ${userId} - ${reason}`, 'moderation');
    monitoringService.recordMetric('moderation.auto_blocks', 1);
  }

  /**
   * Check if user is currently blocked
   */
  async isUserBlocked(userId: string): Promise<boolean> {
    const blockKey = `autoblock:${userId}`;
    const blockData = await redisManager.getSession(blockKey);
    return !!blockData;
  }

  /**
   * Get user violation history
   */
  async getUserViolations(userId: string): Promise<UserViolation[]> {
    // This would typically query from a database
    // For now, return empty array as violations are stored in Redis with TTL
    return [];
  }

  /**
   * Moderate image content (placeholder for future implementation)
   */
  async moderateImage(imageUrl: string, userId: string): Promise<ModerationResult> {
    // Placeholder for image moderation using services like Sightengine
    log(`Image moderation requested for ${imageUrl} by user ${userId}`, 'moderation');
    
    return {
      allowed: true,
      filtered: imageUrl,
      confidence: 0,
      flags: [],
      severity: 'low'
    };
  }

  /**
   * Moderate video content (placeholder for future implementation)
   */
  async moderateVideo(videoUrl: string, userId: string): Promise<ModerationResult> {
    // Placeholder for video moderation
    log(`Video moderation requested for ${videoUrl} by user ${userId}`, 'moderation');
    
    return {
      allowed: true,
      filtered: videoUrl,
      confidence: 0,
      flags: [],
      severity: 'low'
    };
  }

  /**
   * Report user for manual review
   */
  async reportUser(reportedUserId: string, reporterUserId: string, reason: string): Promise<void> {
    const reportKey = `report:${reportedUserId}:${Date.now()}`;
    const reportData = {
      reportedUserId,
      reporterUserId,
      reason,
      timestamp: Date.now(),
      status: 'pending'
    };

    await redisManager.setSession(reportKey, reportData, 86400 * 7); // 7 days
    
    log(`User reported: ${reportedUserId} by ${reporterUserId} - ${reason}`, 'moderation');
    monitoringService.recordMetric('moderation.user_reports', 1);
  }

  /**
   * Get moderation statistics
   */
  async getModerationStats() {
    return {
      service: 'moderation',
      totalChecks: await this.getTotalChecks(),
      totalRejections: await this.getTotalRejections(),
      totalBlocks: await this.getTotalBlocks(),
      timestamp: Date.now()
    };
  }

  private async getTotalChecks(): Promise<number> {
    // These would come from your monitoring system
    return 0;
  }

  private async getTotalRejections(): Promise<number> {
    return 0;
  }

  private async getTotalBlocks(): Promise<number> {
    return 0;
  }
}

export const moderationService = new ModerationService();
export type { ModerationResult, UserViolation };
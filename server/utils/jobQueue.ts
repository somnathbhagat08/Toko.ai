import { log } from '../vite.js';
import { redisManager } from '../redis.js';

interface JobData {
  id: string;
  type: string;
  payload: any;
  priority: number;
  attempts: number;
  maxAttempts: number;
  delay: number;
  createdAt: number;
  processedAt?: number;
  completedAt?: number;
  failedAt?: number;
  error?: string;
}

interface JobOptions {
  priority?: number;
  maxAttempts?: number;
  delay?: number;
  timeout?: number;
}

interface JobProcessor {
  (job: JobData): Promise<any>;
}

class JobQueue {
  private processors = new Map<string, JobProcessor>();
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private readonly queueKey = 'job_queue';
  private readonly processingKey = 'job_processing';
  private readonly completedKey = 'job_completed';
  private readonly failedKey = 'job_failed';

  constructor() {
    this.startProcessing();
  }

  // Add a job to the queue
  async addJob(type: string, payload: any, options: JobOptions = {}): Promise<string> {
    const job: JobData = {
      id: this.generateJobId(),
      type,
      payload,
      priority: options.priority || 0,
      attempts: 0,
      maxAttempts: options.maxAttempts || 3,
      delay: options.delay || 0,
      createdAt: Date.now()
    };

    try {
      // Add to priority queue (higher priority first)
      const score = Date.now() + job.delay - (job.priority * 1000000);
      await this.addToSortedSet(this.queueKey, score, JSON.stringify(job));
      
      log(`Job added to queue: ${job.id} (${job.type})`, 'jobs');
      return job.id;
    } catch (error) {
      log(`Failed to add job to queue: ${error}`, 'jobs');
      throw error;
    }
  }

  // Register a job processor
  registerProcessor(type: string, processor: JobProcessor): void {
    this.processors.set(type, processor);
    log(`Processor registered for job type: ${type}`, 'jobs');
  }

  // Start processing jobs
  private startProcessing(): void {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    this.processingInterval = setInterval(() => {
      this.processNextJob().catch(error => {
        log(`Job processing error: ${error}`, 'jobs');
      });
    }, 1000); // Process every second

    log('Job queue processing started', 'jobs');
  }

  // Stop processing jobs
  stopProcessing(): void {
    this.isProcessing = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    log('Job queue processing stopped', 'jobs');
  }

  // Process the next job in the queue
  private async processNextJob(): Promise<void> {
    try {
      // Get the next job from the queue
      const jobData = await this.getNextJob();
      if (!jobData) return;

      const job: JobData = JSON.parse(jobData);
      
      // Check if job should be delayed
      if (job.delay > 0 && Date.now() < job.createdAt + job.delay) {
        // Re-add to queue with updated score
        const score = job.createdAt + job.delay - (job.priority * 1000000);
        await this.addToSortedSet(this.queueKey, score, jobData);
        return;
      }

      // Move to processing
      await this.moveToProcessing(job.id, jobData);

      // Find processor
      const processor = this.processors.get(job.type);
      if (!processor) {
        await this.failJob(job, `No processor found for job type: ${job.type}`);
        return;
      }

      job.attempts++;
      job.processedAt = Date.now();

      log(`Processing job: ${job.id} (${job.type}) - Attempt ${job.attempts}`, 'jobs');

      try {
        // Process the job
        const result = await processor(job);
        await this.completeJob(job, result);
      } catch (error) {
        await this.handleJobFailure(job, error as Error);
      }
    } catch (error) {
      log(`Error in processNextJob: ${error}`, 'jobs');
    }
  }

  // Get next job from queue
  private async getNextJob(): Promise<string | null> {
    try {
      // Get the job with the lowest score (highest priority)
      const result = await this.popFromSortedSet(this.queueKey);
      return result;
    } catch (error) {
      log(`Error getting next job: ${error}`, 'jobs');
      return null;
    }
  }

  // Move job to processing set
  private async moveToProcessing(jobId: string, jobData: string): Promise<void> {
    await this.addToSet(this.processingKey, jobData);
  }

  // Complete a job successfully
  private async completeJob(job: JobData, result: any): Promise<void> {
    job.completedAt = Date.now();
    
    // Remove from processing
    await this.removeFromSet(this.processingKey, JSON.stringify(job));
    
    // Add to completed (with TTL)
    await this.addToSortedSet(this.completedKey, Date.now(), JSON.stringify({
      ...job,
      result
    }));

    log(`Job completed: ${job.id} (${job.type})`, 'jobs');
  }

  // Handle job failure
  private async handleJobFailure(job: JobData, error: Error): Promise<void> {
    if (job.attempts < job.maxAttempts) {
      // Retry with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, job.attempts - 1), 30000);
      job.delay = delay;
      
      // Remove from processing
      await this.removeFromSet(this.processingKey, JSON.stringify(job));
      
      // Re-add to queue
      const score = Date.now() + delay - (job.priority * 1000000);
      await this.addToSortedSet(this.queueKey, score, JSON.stringify(job));
      
      log(`Job retry scheduled: ${job.id} (${job.type}) - Attempt ${job.attempts + 1} in ${delay}ms`, 'jobs');
    } else {
      await this.failJob(job, error.message);
    }
  }

  // Fail a job permanently
  private async failJob(job: JobData, errorMessage: string): Promise<void> {
    job.failedAt = Date.now();
    job.error = errorMessage;
    
    // Remove from processing
    await this.removeFromSet(this.processingKey, JSON.stringify(job));
    
    // Add to failed
    await this.addToSortedSet(this.failedKey, Date.now(), JSON.stringify(job));
    
    log(`Job failed: ${job.id} (${job.type}) - ${errorMessage}`, 'jobs');
  }

  // Get queue statistics
  async getStats(): Promise<any> {
    try {
      const [queueSize, processingSize, completedSize, failedSize] = await Promise.all([
        this.getSetSize(this.queueKey),
        this.getSetSize(this.processingKey),
        this.getSetSize(this.completedKey),
        this.getSetSize(this.failedKey)
      ]);

      return {
        queue: queueSize,
        processing: processingSize,
        completed: completedSize,
        failed: failedSize,
        processors: this.processors.size,
        isProcessing: this.isProcessing
      };
    } catch (error) {
      log(`Error getting queue stats: ${error}`, 'jobs');
      return {
        queue: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        processors: this.processors.size,
        isProcessing: this.isProcessing
      };
    }
  }

  // Get failed jobs
  async getFailedJobs(limit = 10): Promise<JobData[]> {
    try {
      const jobs = await this.getRangeFromSortedSet(this.failedKey, -limit, -1);
      return jobs.map(job => JSON.parse(job));
    } catch (error) {
      log(`Error getting failed jobs: ${error}`, 'jobs');
      return [];
    }
  }

  // Retry a failed job
  async retryJob(jobId: string): Promise<boolean> {
    try {
      const failedJobs = await this.getAllFromSortedSet(this.failedKey);
      const jobData = failedJobs.find(job => {
        const parsed = JSON.parse(job);
        return parsed.id === jobId;
      });

      if (!jobData) return false;

      const job: JobData = JSON.parse(jobData);
      job.attempts = 0;
      job.delay = 0;
      delete job.failedAt;
      delete job.error;

      // Remove from failed
      await this.removeFromSortedSet(this.failedKey, jobData);
      
      // Add back to queue
      const score = Date.now() - (job.priority * 1000000);
      await this.addToSortedSet(this.queueKey, score, JSON.stringify(job));

      log(`Job retry initiated: ${jobId}`, 'jobs');
      return true;
    } catch (error) {
      log(`Error retrying job ${jobId}: ${error}`, 'jobs');
      return false;
    }
  }

  // Clean up old completed/failed jobs
  async cleanup(olderThanHours = 24): Promise<number> {
    const cutoff = Date.now() - (olderThanHours * 60 * 60 * 1000);
    let cleaned = 0;

    try {
      // Clean completed jobs
      cleaned += await this.removeFromSortedSetByScore(this.completedKey, 0, cutoff);
      
      // Clean failed jobs (keep longer for debugging)
      cleaned += await this.removeFromSortedSetByScore(this.failedKey, 0, cutoff - (24 * 60 * 60 * 1000));

      if (cleaned > 0) {
        log(`Cleaned up ${cleaned} old jobs`, 'jobs');
      }
    } catch (error) {
      log(`Error during job cleanup: ${error}`, 'jobs');
    }

    return cleaned;
  }

  // Utility methods for Redis operations (fallback to memory if Redis unavailable)
  private async addToSortedSet(key: string, score: number, member: string): Promise<void> {
    try {
      if (redisManager.isConnected) {
        await redisManager.zadd(key, score, member);
      }
      // In memory fallback would go here
    } catch (error) {
      log(`Error adding to sorted set ${key}: ${error}`, 'jobs');
    }
  }

  private async popFromSortedSet(key: string): Promise<string | null> {
    try {
      if (redisManager.isConnected) {
        // Get and remove the first element
        const result = await redisManager.zpopmin(key);
        return result && result.length > 0 ? result[0] : null;
      }
      return null;
    } catch (error) {
      log(`Error popping from sorted set ${key}: ${error}`, 'jobs');
      return null;
    }
  }

  private async addToSet(key: string, member: string): Promise<void> {
    await redisManager.sadd(key, member);
  }

  private async removeFromSet(key: string, member: string): Promise<void> {
    await redisManager.srem(key, member);
  }

  private async removeFromSortedSet(key: string, member: string): Promise<void> {
    await redisManager.zrem(key, member);
  }

  private async getSetSize(key: string): Promise<number> {
    try {
      if (redisManager.isConnected) {
        return await redisManager.zcard(key) || 0;
      }
      return 0;
    } catch (error) {
      return 0;
    }
  }

  private async getRangeFromSortedSet(key: string, start: number, stop: number): Promise<string[]> {
    try {
      if (redisManager.isConnected) {
        return await redisManager.zrange(key, start, stop) || [];
      }
      return [];
    } catch (error) {
      return [];
    }
  }

  private async getAllFromSortedSet(key: string): Promise<string[]> {
    return this.getRangeFromSortedSet(key, 0, -1);
  }

  private async removeFromSortedSetByScore(key: string, min: number, max: number): Promise<number> {
    try {
      if (redisManager.isConnected) {
        return await redisManager.zremrangebyscore(key, min, max) || 0;
      }
      return 0;
    } catch (error) {
      return 0;
    }
  }

  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Cleanup method
  async shutdown(): Promise<void> {
    this.stopProcessing();
    this.processors.clear();
    log('Job queue shut down', 'jobs');
  }
}

// Create singleton instance
export const jobQueue = new JobQueue();

// Common job types
export const JobTypes = {
  SEND_EMAIL: 'send_email',
  PROCESS_IMAGE: 'process_image',
  GENERATE_REPORT: 'generate_report',
  CLEANUP_TEMP_FILES: 'cleanup_temp_files',
  SEND_NOTIFICATION: 'send_notification',
  UPDATE_USER_STATS: 'update_user_stats'
} as const;

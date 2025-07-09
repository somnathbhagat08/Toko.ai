import { log } from '../vite.js';
import { redisManager } from '../redis.js';
import { jobQueue, JobTypes } from './jobQueue.js';
import crypto from 'crypto';

export interface WebhookPayload {
  event: string;
  data: any;
  timestamp: number;
  id: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  maxRetries: number;
  timeout: number;
  createdAt: Date;
  lastDelivery?: Date;
  successCount: number;
  failureCount: number;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  payload: WebhookPayload;
  url: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  response?: {
    status: number;
    headers: Record<string, string>;
    body: string;
  };
  createdAt: Date;
  deliveredAt?: Date;
  error?: string;
}

class WebhookManager {
  private endpoints = new Map<string, WebhookEndpoint>();
  private deliveries = new Map<string, WebhookDelivery>();
  private readonly maxDeliveries = 1000;

  constructor() {
    this.loadEndpoints();
    this.setupCleanupTasks();
  }

  // Register webhook endpoint
  async registerEndpoint(
    url: string,
    events: string[],
    options: {
      secret?: string;
      maxRetries?: number;
      timeout?: number;
    } = {}
  ): Promise<string> {
    const endpoint: WebhookEndpoint = {
      id: this.generateId(),
      url,
      events,
      secret: options.secret || this.generateSecret(),
      active: true,
      maxRetries: options.maxRetries || 3,
      timeout: options.timeout || 30000,
      createdAt: new Date(),
      successCount: 0,
      failureCount: 0
    };

    this.endpoints.set(endpoint.id, endpoint);
    await this.saveEndpoint(endpoint);

    log(`Webhook endpoint registered: ${url} for events: ${events.join(', ')}`, 'webhooks');
    return endpoint.id;
  }

  // Unregister webhook endpoint
  async unregisterEndpoint(endpointId: string): Promise<boolean> {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) return false;

    this.endpoints.delete(endpointId);
    await redisManager.del(`webhook:endpoint:${endpointId}`);

    log(`Webhook endpoint unregistered: ${endpoint.url}`, 'webhooks');
    return true;
  }

  // Update webhook endpoint
  async updateEndpoint(
    endpointId: string,
    updates: Partial<Pick<WebhookEndpoint, 'url' | 'events' | 'active' | 'maxRetries' | 'timeout'>>
  ): Promise<boolean> {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) return false;

    Object.assign(endpoint, updates);
    await this.saveEndpoint(endpoint);

    log(`Webhook endpoint updated: ${endpointId}`, 'webhooks');
    return true;
  }

  // Trigger webhook event
  async triggerEvent(event: string, data: any): Promise<void> {
    const payload: WebhookPayload = {
      event,
      data,
      timestamp: Date.now(),
      id: this.generateId()
    };

    const relevantEndpoints = Array.from(this.endpoints.values())
      .filter(endpoint => endpoint.active && endpoint.events.includes(event));

    if (relevantEndpoints.length === 0) {
      log(`No active webhooks for event: ${event}`, 'webhooks');
      return;
    }

    // Queue delivery jobs for each endpoint
    for (const endpoint of relevantEndpoints) {
      const delivery: WebhookDelivery = {
        id: this.generateId(),
        webhookId: endpoint.id,
        payload,
        url: endpoint.url,
        status: 'pending',
        attempts: 0,
        createdAt: new Date()
      };

      this.deliveries.set(delivery.id, delivery);
      await this.saveDelivery(delivery);

      // Add to job queue for processing
      await jobQueue.addJob(JobTypes.SEND_NOTIFICATION, {
        type: 'webhook',
        deliveryId: delivery.id
      }, {
        priority: 2,
        maxAttempts: endpoint.maxRetries
      });
    }

    log(`Webhook event triggered: ${event} for ${relevantEndpoints.length} endpoints`, 'webhooks');
  }

  // Process webhook delivery
  async processDelivery(deliveryId: string): Promise<boolean> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) {
      log(`Delivery not found: ${deliveryId}`, 'webhooks');
      return false;
    }

    const endpoint = this.endpoints.get(delivery.webhookId);
    if (!endpoint) {
      log(`Endpoint not found for delivery: ${deliveryId}`, 'webhooks');
      return false;
    }

    delivery.attempts++;

    try {
      const signature = this.generateSignature(delivery.payload, endpoint.secret);
      const response = await this.sendWebhook(delivery.url, delivery.payload, signature, endpoint.timeout);

      delivery.status = 'success';
      delivery.deliveredAt = new Date();
      delivery.response = response;

      endpoint.successCount++;
      endpoint.lastDelivery = new Date();

      log(`Webhook delivered successfully: ${deliveryId} to ${delivery.url}`, 'webhooks');
      return true;
    } catch (error) {
      delivery.status = 'failed';
      delivery.error = error instanceof Error ? error.message : String(error);

      endpoint.failureCount++;

      log(`Webhook delivery failed: ${deliveryId} to ${delivery.url} - ${delivery.error}`, 'webhooks');
      return false;
    } finally {
      await this.saveDelivery(delivery);
      await this.saveEndpoint(endpoint);
    }
  }

  // Send webhook HTTP request
  private async sendWebhook(
    url: string,
    payload: WebhookPayload,
    signature: string,
    timeout: number
  ): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': payload.timestamp.toString(),
          'X-Webhook-ID': payload.id,
          'User-Agent': 'Toko-Webhook/1.0'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: response.status,
        headers,
        body
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Generate HMAC signature
  private generateSignature(payload: WebhookPayload, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return `sha256=${hmac.digest('hex')}`;
  }

  // Verify webhook signature
  verifySignature(payload: string, signature: string, secret: string): boolean {
    const expectedSignature = crypto.createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    const receivedSignature = signature.replace('sha256=', '');
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(receivedSignature, 'hex')
    );
  }

  // Get webhook statistics
  getStats() {
    const totalEndpoints = this.endpoints.size;
    const activeEndpoints = Array.from(this.endpoints.values())
      .filter(e => e.active).length;
    
    const totalDeliveries = this.deliveries.size;
    const successfulDeliveries = Array.from(this.deliveries.values())
      .filter(d => d.status === 'success').length;
    
    const failedDeliveries = Array.from(this.deliveries.values())
      .filter(d => d.status === 'failed').length;

    return {
      endpoints: {
        total: totalEndpoints,
        active: activeEndpoints,
        inactive: totalEndpoints - activeEndpoints
      },
      deliveries: {
        total: totalDeliveries,
        successful: successfulDeliveries,
        failed: failedDeliveries,
        successRate: totalDeliveries > 0 ? (successfulDeliveries / totalDeliveries) * 100 : 0
      }
    };
  }

  // Get endpoint details
  getEndpoint(endpointId: string): WebhookEndpoint | null {
    return this.endpoints.get(endpointId) || null;
  }

  // Get all endpoints
  getAllEndpoints(): WebhookEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  // Get delivery details
  getDelivery(deliveryId: string): WebhookDelivery | null {
    return this.deliveries.get(deliveryId) || null;
  }

  // Get deliveries for endpoint
  getDeliveriesForEndpoint(endpointId: string, limit: number = 100): WebhookDelivery[] {
    return Array.from(this.deliveries.values())
      .filter(d => d.webhookId === endpointId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  // Retry failed delivery
  async retryDelivery(deliveryId: string): Promise<boolean> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery || delivery.status !== 'failed') return false;

    const endpoint = this.endpoints.get(delivery.webhookId);
    if (!endpoint || !endpoint.active) return false;

    delivery.status = 'pending';
    delete delivery.error;

    await jobQueue.addJob(JobTypes.SEND_NOTIFICATION, {
      type: 'webhook',
      deliveryId: delivery.id
    }, {
      priority: 3,
      maxAttempts: 1
    });

    log(`Webhook delivery retry queued: ${deliveryId}`, 'webhooks');
    return true;
  }

  // Utility methods
  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private async saveEndpoint(endpoint: WebhookEndpoint): Promise<void> {
    await redisManager.set(
      `webhook:endpoint:${endpoint.id}`,
      JSON.stringify(endpoint),
      86400 * 30 // 30 days
    );
  }

  private async saveDelivery(delivery: WebhookDelivery): Promise<void> {
    await redisManager.set(
      `webhook:delivery:${delivery.id}`,
      JSON.stringify(delivery),
      86400 * 7 // 7 days
    );
  }

  private async loadEndpoints(): Promise<void> {
    try {
      const keys = await redisManager.keys('webhook:endpoint:*');
      for (const key of keys) {
        const data = await redisManager.get(key);
        if (data) {
          const endpoint = JSON.parse(data);
          this.endpoints.set(endpoint.id, endpoint);
        }
      }
      log(`Loaded ${this.endpoints.size} webhook endpoints`, 'webhooks');
    } catch (error) {
      log(`Failed to load webhook endpoints: ${error}`, 'webhooks');
    }
  }

  private setupCleanupTasks(): void {
    // Clean up old deliveries every 6 hours
    setInterval(() => {
      this.cleanupOldDeliveries();
    }, 6 * 60 * 60 * 1000);
  }

  private async cleanupOldDeliveries(): Promise<void> {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days ago
    let cleaned = 0;

    for (const [deliveryId, delivery] of this.deliveries.entries()) {
      if (delivery.createdAt.getTime() < cutoff) {
        this.deliveries.delete(deliveryId);
        await redisManager.del(`webhook:delivery:${deliveryId}`);
        cleaned++;
      }
    }

    // Keep only recent deliveries in memory
    if (this.deliveries.size > this.maxDeliveries) {
      const sortedDeliveries = Array.from(this.deliveries.entries())
        .sort(([, a], [, b]) => b.createdAt.getTime() - a.createdAt.getTime());
      
      for (let i = this.maxDeliveries; i < sortedDeliveries.length; i++) {
        const [deliveryId] = sortedDeliveries[i];
        this.deliveries.delete(deliveryId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log(`Cleaned up ${cleaned} old webhook deliveries`, 'webhooks');
    }
  }

  // Shutdown
  async shutdown(): Promise<void> {
    log('Webhook manager shutting down', 'webhooks');
  }
}

// Create singleton instance
export const webhookManager = new WebhookManager();

// Common webhook events
export const WebhookEvents = {
  USER_REGISTERED: 'user.registered',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',
  MATCH_CREATED: 'match.created',
  MATCH_ENDED: 'match.ended',
  MESSAGE_SENT: 'message.sent',
  REPORT_CREATED: 'report.created',
  SYSTEM_ALERT: 'system.alert'
} as const;

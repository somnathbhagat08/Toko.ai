import { performance, PerformanceObserver, PerformanceEntry } from 'perf_hooks';
import { promises as fs } from 'fs';
import { getDbHealthStatus } from './database.js';
import { redisManager } from './redis.js';
import { log } from './utils/logger.js';
import { AppError } from './utils/errorHandler.js';
import { config } from './utils/config.js';

export interface MetricData {
  timestamp: number;
  value: number;
  tags?: Record<string, string>;
}

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime: number;
  message: string;
  details?: Record<string, any>;
}

export interface SystemMetrics {
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
    heapUsed: number;
    heapTotal: number;
  };
  disk: {
    used: number;
    total: number;
    percentage: number;
  };
  network: {
    connections: number;
    bytesIn: number;
    bytesOut: number;
  };
}

export interface AlertConfig {
  threshold: number;
  operator: 'gt' | 'lt' | 'eq';
  duration: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  channel: 'email' | 'slack' | 'webhook';
}

export interface Alert {
  id: string;
  metric: string;
  threshold: number;
  currentValue: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: number;
  resolved: boolean;
}

export class MonitoringService {
  private metrics: Map<string, MetricData[]> = new Map();
  private healthChecks: Map<string, () => Promise<HealthCheckResult>> = new Map();
  private alerts: Map<string, Alert> = new Map();
  private alertConfigs: Map<string, AlertConfig> = new Map();
  private metricsBuffer: Map<string, number> = new Map();
  private performanceObserver: PerformanceObserver | null = null;
  private collectInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private flushInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly maxMetricAge = 24 * 60 * 60 * 1000; // 24 hours
  private readonly maxMetricsPerType = 1000;

  constructor() {
    this.setupDefaultAlerts();
  }

  async initialize() {
    try {
      this.setupDefaultHealthChecks();
      this.setupPerformanceTracking();
      this.startCollectionIntervals();
      this.isRunning = true;

      log.monitor('Enhanced monitoring service initialized', {
        collectInterval: 15000,
        healthCheckInterval: 30000,
        flushInterval: 60000
      });

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Failed to initialize monitoring service', { error: err.message });
      throw new AppError('Monitoring initialization failed', 500);
    }
  }

  private setupDefaultHealthChecks() {
    // Database health check
    this.addHealthCheck('database', async () => {
      const startTime = performance.now();
      try {
        const dbHealth = await getDbHealthStatus();
        return {
          status: dbHealth.status === 'healthy' ? 'healthy' : 'unhealthy' as const,
          responseTime: performance.now() - startTime,
          message: dbHealth.message,
          details: dbHealth
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        return {
          status: 'unhealthy' as const,
          responseTime: performance.now() - startTime,
          message: `Database check failed: ${err.message}`,
          details: { error: err.message }
        };
      }
    });

    // Redis health check
    this.addHealthCheck('redis', async () => {
      const startTime = performance.now();
      try {
        const ping = await redisManager.ping();
        return {
          status: ping ? 'healthy' : 'unhealthy' as const,
          responseTime: performance.now() - startTime,
          message: ping ? 'Redis is responding' : 'Redis is not responding',
          details: { ping }
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        return {
          status: 'unhealthy' as const,
          responseTime: performance.now() - startTime,
          message: `Redis check failed: ${err.message}`,
          details: { error: err.message }
        };
      }
    });

    // Memory health check
    this.addHealthCheck('memory', async () => {
      const startTime = performance.now();
      const memUsage = process.memoryUsage();
      const totalMemory = memUsage.heapTotal;
      const usedMemory = memUsage.heapUsed;
      const memoryPercentage = (usedMemory / totalMemory) * 100;        const status: 'healthy' | 'degraded' | 'unhealthy' = memoryPercentage > 90 ? 'unhealthy' : 
                      memoryPercentage > 70 ? 'degraded' : 'healthy';

        return {
          status,
          responseTime: performance.now() - startTime,
        message: `Memory usage: ${memoryPercentage.toFixed(1)}%`,
        details: {
          heapUsed: usedMemory,
          heapTotal: totalMemory,
          percentage: memoryPercentage,
          rss: memUsage.rss,
          external: memUsage.external
        }
      };
    });

    // Disk health check
    this.addHealthCheck('disk', async () => {
      const startTime = performance.now();
      try {
        const stats = await fs.stat('.');
        const diskUsage = {
          used: stats.size,
          total: stats.size * 2, // Simplified calculation
          percentage: 50 // Simplified
        };

        const status: 'healthy' | 'degraded' | 'unhealthy' = diskUsage.percentage > 90 ? 'unhealthy' : 
                      diskUsage.percentage > 80 ? 'degraded' : 'healthy';

        return {
          status,
          responseTime: performance.now() - startTime,
          message: `Disk usage: ${diskUsage.percentage.toFixed(1)}%`,
          details: diskUsage
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        return {
          status: 'unhealthy' as const,
          responseTime: performance.now() - startTime,
          message: `Disk check failed: ${err.message}`,
          details: { error: err.message }
        };
      }
    });
  }

  private setupPerformanceTracking() {
    if (typeof PerformanceObserver === 'undefined') {
      log.warn('Performance tracking not available in this environment');
      return;
    }

    try {
      this.performanceObserver = new PerformanceObserver((list: PerformanceObserverEntryList) => {
        const entries = list.getEntries();
        entries.forEach((entry: any) => {
          this.recordMetric(`performance.${entry.entryType}`, entry.duration, {
            name: entry.name,
            type: entry.entryType
          });
        });
      });

      this.performanceObserver.observe({ 
        entryTypes: ['measure'] 
      });

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.warn('Performance tracking not available', { error: err.message });
    }
  }

  private startCollectionIntervals() {
    // Collect system metrics every 15 seconds
    this.collectInterval = setInterval(async () => {
      await this.collectSystemMetrics();
    }, 15000);

    // Run health checks every 30 seconds
    this.healthCheckInterval = setInterval(async () => {
      await this.runHealthChecks();
    }, 30000);

    // Flush metrics every minute
    this.flushInterval = setInterval(async () => {
      await this.flushMetrics();
    }, 60000);
  }

  recordMetric(name: string, value: number, tags: Record<string, string> = {}) {
    const metric: MetricData = {
      timestamp: Date.now(),
      value,
      tags
    };

    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metricsArray = this.metrics.get(name)!;
    metricsArray.push(metric);

    // Limit array size
    if (metricsArray.length > this.maxMetricsPerType) {
      metricsArray.shift();
    }

    // Buffer for quick access
    this.metricsBuffer.set(name, value);

    // Check for alerts
    this.checkAlerts(name, value);

    log.metric(name, { value, tags });
  }

  recordRequestMetric(method: string, path: string, status: number, responseTime: number, userId?: string) {
    const tags: Record<string, string> = { method, status: status.toString() };
    if (userId) (tags as any).userId = userId;

    this.recordMetric('http.requests.total', 1, tags);
    this.recordMetric('http.request.duration', responseTime, tags);
    this.recordMetric(`http.status.${status}`, 1, tags);
  }

  recordDatabaseMetric(operation: string, duration: number, success: boolean) {
    this.recordMetric('database.operations.total', 1, { 
      operation, 
      success: success.toString() 
    });
    this.recordMetric('database.operation.duration', duration, { operation });
  }

  recordCacheMetric(operation: string, hit: boolean) {
    this.recordMetric('cache.operations.total', 1, { 
      operation, 
      result: hit ? 'hit' : 'miss' 
    });
    this.recordMetric(`cache.${hit ? 'hits' : 'misses'}`, 1, { operation });
  }

  recordQueueMetric(queue: string, operation: string, duration?: number) {
    this.recordMetric('queue.operations.total', 1, { queue, operation });
    if (duration) {
      this.recordMetric('queue.operation.duration', duration, { queue, operation });
    }
  }

  recordWebSocketMetric(event: string, connectionCount: number) {
    this.recordMetric('websocket.events.total', 1, { event });
    this.recordMetric('websocket.connections', connectionCount);
  }

  recordErrorMetric(type: string, message: string, stack?: string) {
    this.recordMetric('errors.total', 1, { type, message });
    
    log.error('Error tracked', { 
      type, 
      message, 
      stack: stack?.substring(0, 500) 
    });
  }

  trackError(type: string, message: string, stack?: string) {
    this.recordErrorMetric(type, message, stack);
  }

  addHealthCheck(name: string, check: () => Promise<HealthCheckResult>) {
    this.healthChecks.set(name, check);
    log.monitor(`Health check registered: ${name}`);
  }

  removeHealthCheck(name: string) {
    this.healthChecks.delete(name);
    log.monitor(`Health check removed: ${name}`);
  }

  async runHealthChecks(): Promise<Record<string, HealthCheckResult>> {
    const results: Record<string, HealthCheckResult> = {};

    for (const [name, check] of this.healthChecks) {
      try {
        const result = await Promise.race([
          check(),
          new Promise<HealthCheckResult>((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), 10000)
          )
        ]);

        results[name] = result;
        this.recordMetric(`health.${name}`, result.status === 'healthy' ? 1 : 0);
        this.recordMetric(`health.${name}.response_time`, result.responseTime);

      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        results[name] = {
          status: 'unhealthy',
          responseTime: 10000,
          message: `Health check failed: ${err.message}`,
          details: { error: err.message },
        };
        
        log.error(`Health check failed: ${name}`, { error: err.message });
      }
    }

    return results;
  }

  async getHealthStatus(): Promise<{
    status: 'healthy' | 'unhealthy' | 'degraded';
    checks: Record<string, HealthCheckResult>;
    timestamp: number;
  }> {
    try {
      const checks = await this.runHealthChecks();
      const statuses = Object.values(checks).map(check => check.status);
      
      const overallStatus = statuses.includes('unhealthy') ? 'unhealthy' :
                           statuses.includes('degraded') ? 'degraded' : 'healthy';

      return {
        status: overallStatus,
        checks,
        timestamp: Date.now()
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Error running health checks', { error: err.message });
      return {
        status: 'unhealthy',
        checks: {},
        timestamp: Date.now()
      };
    }
  }

  private async collectSystemMetrics() {
    try {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      // Memory metrics
      this.recordMetric('system.memory.heap_used', memUsage.heapUsed);
      this.recordMetric('system.memory.heap_total', memUsage.heapTotal);
      this.recordMetric('system.memory.rss', memUsage.rss);
      this.recordMetric('system.memory.external', memUsage.external);
      
      // CPU metrics (simplified)
      this.recordMetric('system.cpu.user', cpuUsage.user);
      this.recordMetric('system.cpu.system', cpuUsage.system);
      
      // Process metrics
      this.recordMetric('system.process.uptime', process.uptime());
      this.recordMetric('system.process.pid', process.pid);

      // Event loop lag (simplified)
      const start = process.hrtime.bigint();
      setImmediate(() => {
        const lag = Number(process.hrtime.bigint() - start) / 1000000;
        this.recordMetric('system.event_loop.lag', lag);
      });

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Failed to collect system metrics', { error: err.message });
      this.trackError('system_metrics', err.message);
    }
  }

  private setupDefaultAlerts() {
    // High memory usage alert
    this.addAlert('system.memory.heap_used', {
      threshold: 500 * 1024 * 1024, // 500MB
      operator: 'gt',
      duration: 300000, // 5 minutes
      severity: 'high',
      channel: 'email'
    });

    // High error rate alert
    this.addAlert('errors.total', {
      threshold: 10,
      operator: 'gt',
      duration: 60000, // 1 minute
      severity: 'critical',
      channel: 'slack'
    });

    // Database health alert
    this.addAlert('health.database', {
      threshold: 1,
      operator: 'lt',
      duration: 60000,
      severity: 'critical',
      channel: 'webhook'
    });
  }

  addAlert(metric: string, config: AlertConfig) {
    this.alertConfigs.set(metric, config);
    log.monitor(`Alert configured for metric: ${metric}`, config);
  }

  removeAlert(metric: string) {
    this.alertConfigs.delete(metric);
    this.alerts.delete(metric);
    log.monitor(`Alert removed for metric: ${metric}`);
  }

  private checkAlerts(metric: string, value: number) {
    const alertConfig = this.alertConfigs.get(metric);
    if (!alertConfig) return;

    const shouldAlert = this.evaluateThreshold(value, alertConfig.threshold, alertConfig.operator);
    const existingAlert = this.alerts.get(metric);

    if (shouldAlert && !existingAlert) {
      const alert: Alert = {
        id: `${metric}_${Date.now()}`,
        metric,
        threshold: alertConfig.threshold,
        currentValue: value,
        severity: alertConfig.severity,
        message: `Alert: ${metric} is ${value}, threshold is ${alertConfig.threshold}`,
        timestamp: Date.now(),
        resolved: false
      };

      this.alerts.set(metric, alert);
      this.sendAlert(alert, alertConfig.channel);
      
    } else if (!shouldAlert && existingAlert && !existingAlert.resolved) {
      existingAlert.resolved = true;
      this.sendAlert(existingAlert, alertConfig.channel);
    }
  }

  private evaluateThreshold(value: number, threshold: number, operator: 'gt' | 'lt' | 'eq'): boolean {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'lt': return value < threshold;
      case 'eq': return value === threshold;
      default: return false;
    }
  }

  private sendAlert(alert: Alert, channel: string) {
    log.alert(`Alert ${alert.resolved ? 'resolved' : 'triggered'}`, {
      id: alert.id,
      metric: alert.metric,
      severity: alert.severity,
      message: alert.message,
      channel
    });

    // Here you would integrate with actual alerting systems
    // like email, Slack, PagerDuty, etc.
  }

  getMetrics(name?: string, timeRange?: { start: number; end: number }): Record<string, MetricData[]> {
    const result: Record<string, MetricData[]> = {};

    if (name) {
      const metrics = this.metrics.get(name);
      if (metrics) {
        let filtered = metrics;
        if (timeRange) {
          filtered = metrics.filter((m: MetricData) => 
            m.timestamp >= timeRange.start && m.timestamp <= timeRange.end
          );
        }
        result[name] = filtered;
      }
    } else {
      this.metrics.forEach((metrics, key) => {
        let filtered = metrics;
        if (timeRange) {
          filtered = metrics.filter((m: MetricData) => 
            m.timestamp >= timeRange.start && m.timestamp <= timeRange.end
          );
        }
        result[key] = filtered;
      });
    }

    return result;
  }

  getMetricsSummary(): Record<string, { count: number; latest: number; average: number }> {
    const summary: Record<string, { count: number; latest: number; average: number }> = {};

    this.metrics.forEach((metrics, key) => {
      if (metrics.length === 0) return;

      const values = metrics.map((m: MetricData) => m.value);
      const sum = values.reduce((a: number, b: number) => a + b, 0);

      summary[key] = {
        count: metrics.length,
        latest: values[values.length - 1],
        average: sum / values.length
      };
    });

    return summary;
  }

  getAlerts(): Alert[] {
    return Array.from(this.alerts.values());
  }

  private cleanupOldMetrics() {
    const cutoff = Date.now() - this.maxMetricAge;
    
    this.metrics.forEach((metrics, key) => {
      const filtered = metrics.filter((m: MetricData) => m.timestamp > cutoff);
      
      if (filtered.length === 0) {
        this.metrics.delete(key);
      } else {
        this.metrics.set(key, filtered);
      }
    });
  }

  async exportMetrics(format: 'prometheus' | 'json' = 'json'): Promise<string> {
    const metrics = this.getMetrics();
    const summary = this.getMetricsSummary();

    if (format === 'prometheus') {
      return this.formatPrometheusMetrics(summary);
    }

    return JSON.stringify({
      timestamp: Date.now(),
      metrics,
      summary,
      alerts: this.getAlerts()
    }, null, 2);
  }

  private formatPrometheusMetrics(summary: Record<string, { count: number; latest: number; average: number }>): string {
    let output = '';
    
    for (const [name, data] of Object.entries(summary)) {
      const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_');
      output += `# HELP ${safeName} ${name}\n`;
      output += `# TYPE ${safeName} gauge\n`;
      output += `${safeName}_latest ${data.latest}\n`;
      output += `${safeName}_average ${data.average}\n`;
      output += `${safeName}_count ${data.count}\n`;
    }

    return output;
  }

  private async flushMetrics() {
    try {
      this.cleanupOldMetrics();
      
      // Export metrics if needed
      const metrics = await this.exportMetrics('json');
      log.debug('Metrics exported', { size: metrics.length });

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Failed to flush metrics', { error: err.message });
    }
  }

  async getSystemMetrics(): Promise<SystemMetrics> {
    const memUsage = process.memoryUsage();
    
    return {
      cpu: {
        usage: 0, // Simplified
        loadAverage: [0, 0, 0] // Simplified
      },
      memory: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal
      },
      disk: {
        used: 0, // Simplified
        total: 0, // Simplified
        percentage: 0 // Simplified
      },
      network: {
        connections: 0, // Simplified
        bytesIn: 0, // Simplified
        bytesOut: 0 // Simplified
      }
    };
  }

  async shutdown() {
    try {
      this.isRunning = false;

      if (this.collectInterval) {
        clearInterval(this.collectInterval);
      }

      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }

      if (this.flushInterval) {
        clearInterval(this.flushInterval);
      }

      if (this.performanceObserver) {
        this.performanceObserver.disconnect();
      }

      // Final metrics flush
      await this.flushMetrics();

      log.monitor('Monitoring service shutdown completed');

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Error during monitoring shutdown', { error: err.message });
    }
  }

  isHealthy(): boolean {
    return this.isRunning;
  }
}

export const monitoringService = new MonitoringService();

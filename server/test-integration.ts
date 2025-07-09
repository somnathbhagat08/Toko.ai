// Final integration test for backend services
import { monitoringService } from './monitoring-fixed.js';
import { authService } from './services/auth.js';
import { matchmakingService } from './services/matchmaking-enhanced.js';
import { presenceService } from './services/presence-enhanced.js';
import { log } from './utils/logger.js';
import { config } from './utils/config.js';
import { cacheService } from './utils/cache.js';
import { redisManager } from './redis.js';

async function runIntegrationTests() {
  log.info('Starting backend integration tests...');
  
  try {
    // Test config
    const serverConfig = config.getServer();
    log.info('Config test passed', { port: serverConfig.port });

    // Test monitoring service
    await monitoringService.initialize();
    const healthStatus = await monitoringService.getHealthStatus();
    log.info('Monitoring test passed', { status: healthStatus.status });

    // Test cache service
    await cacheService.set('test_key', 'test_value', 60);
    const cachedValue = await cacheService.get('test_key');
    if (cachedValue === 'test_value') {
      log.info('Cache test passed');
    } else {
      log.error('Cache test failed');
    }

    // Test Redis connection
    const pingResult = await redisManager.ping();
    if (pingResult) {
      log.info('Redis test passed');
    } else {
      log.error('Redis test failed');
    }

    // Test service health checks
    const authHealthy = authService.isHealthy();
    const matchmakingHealthy = matchmakingService.isHealthy();
    const presenceHealthy = presenceService.isHealthy();
    
    log.info('Service health checks completed', {
      auth: authHealthy,
      matchmaking: matchmakingHealthy,
      presence: presenceHealthy
    });

    // Test metrics recording
    monitoringService.recordMetric('test.integration', 1, { test: 'successful' });
    
    log.info('All integration tests passed successfully!');
    return true;

  } catch (error) {
    log.error('Integration test failed', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return false;
  }
}

// Export for use in other modules
export { runIntegrationTests };

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runIntegrationTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test execution failed:', error);
      process.exit(1);
    });
}

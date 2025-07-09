// Test file for monitoring service
import { monitoringService } from './monitoring.js';

async function testMonitoring() {
  console.log('Testing monitoring service...');
  
  try {
    // Initialize monitoring
    await monitoringService.initialize();
    console.log('✓ Monitoring service initialized');
    
    // Test metric recording
    monitoringService.recordMetric('test.metric', 42, { tag: 'test' });
    console.log('✓ Metric recorded');
    
    // Test health checks
    const health = await monitoringService.getHealthStatus();
    console.log('✓ Health checks completed:', health.status);
    
    // Test metrics retrieval
    const metrics = monitoringService.getMetrics();
    console.log('✓ Metrics retrieved:', Object.keys(metrics).length, 'metric types');
    
    // Test metrics summary
    const summary = monitoringService.getMetricsSummary();
    console.log('✓ Metrics summary:', Object.keys(summary).length, 'summaries');
    
    // Test metrics export
    const exported = await monitoringService.exportMetrics('json');
    console.log('✓ Metrics exported:', exported.length, 'characters');
    
    console.log('All monitoring tests passed!');
    
  } catch (error) {
    console.error('Monitoring test failed:', error);
  } finally {
    // Shutdown
    await monitoringService.shutdown();
    console.log('✓ Monitoring service shutdown');
  }
}

// Run test
testMonitoring().catch(console.error);

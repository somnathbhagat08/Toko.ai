import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";
import { log } from "./utils/logger.js";
import { errorHandler, notFoundHandler } from "./utils/errorHandler.js";
import { securityManager } from "./utils/security.js";
import { monitoringService } from "./monitoring.js";
import { createDirectories } from "./utils/fileSystem.js";
import { config } from "./utils/config.js";
import cluster from "cluster";
import os from "os";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Enable clustering in production
const enableClustering = process.env.NODE_ENV === 'production' && process.env.DISABLE_CLUSTERING !== 'true';
const numCPUs = os.cpus().length;

if (enableClustering && cluster.isPrimary) {
  log.info(`Primary process ${process.pid} is running`);
  log.info(`Forking ${numCPUs} workers`);

  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  // Handle worker exit
  cluster.on('exit', (worker, code, signal) => {
    log.error(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
    log.info('Starting a new worker');
    cluster.fork();
  });
} else {
  // Worker process or development mode
  startServer();
}

async function startServer() {
  try {
    // Create necessary directories
    await createDirectories();
    
    // Initialize monitoring service
    await monitoringService.initialize();
    
    const app = express();
    const isDev = process.env.NODE_ENV === 'development';

    // Basic security middleware
    app.use(helmet({
      contentSecurityPolicy: false, // We'll handle this in our security manager
      crossOriginEmbedderPolicy: false,
    }));

    // Compression middleware
    app.use(compression({
      filter: (req: any, res: any) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
      level: 6,
      threshold: 1024,
    }));

    // CORS configuration
    app.use(cors({
      origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:5000'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      maxAge: 86400, // 24 hours
    }));

    // Request parsing middleware
    app.use(express.json({ 
      limit: '10mb',
      type: ['application/json', 'application/*+json']
    }));
    app.use(express.urlencoded({ 
      extended: true, 
      limit: '10mb',
      parameterLimit: 1000
    }));

    // Trust proxy for accurate IP detection
    app.set('trust proxy', process.env.TRUST_PROXY === 'true' || isDev);

    // Security middleware
    app.use(securityManager.securityHeaders());
    app.use(securityManager.sanitizeInput());
    app.use(securityManager.requestSizeLimiter('10mb'));

    // Rate limiting for different endpoints
    app.use('/api/auth', securityManager.createRateLimiter('auth'));
    app.use('/api', securityManager.createRateLimiter('api'));
    app.use('/', securityManager.createRateLimiter('general'));

    // Request logging and monitoring
    app.use((req: Request, res: Response, next: NextFunction) => {
      const start = Date.now();
      const path = req.path;
      let capturedJsonResponse: Record<string, any> | undefined = undefined;

      // Track request with monitoring service
      monitoringService.recordRequestMetric(req.method, path, 0, 0);

      const originalResJson = res.json;
      res.json = function (bodyJson: any, ...args: any[]) {
        capturedJsonResponse = bodyJson;
        return originalResJson.apply(res, [bodyJson, ...args]);
      };

      res.on("finish", () => {
        const duration = Date.now() - start;
        
        // Record metrics with monitoring service
        monitoringService.recordRequestMetric(req.method, path, res.statusCode, duration);

        // Log slow requests
        if (duration > 1000) {
          log.warn('Slow request detected', {
            method: req.method,
            path: path,
            duration: `${duration}ms`,
            statusCode: res.statusCode,
            ip: req.ip
          });
        }

        // Log API requests
        if (path.startsWith("/api")) {
          let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
          if (capturedJsonResponse) {
            logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
          }

          if (logLine.length > 80) {
            logLine = logLine.slice(0, 79) + "…";
          }

          log.info(logLine);
        }
      });

      next();
    });

    // Health check endpoint (before routes)
    app.get('/health', async (req: Request, res: Response) => {
      const healthStatus = await monitoringService.getHealthStatus();
      res.status(healthStatus.status === 'unhealthy' ? 503 : 200).json({
        ...healthStatus,
        service: 'toko-backend',
        environment: process.env.NODE_ENV || "development",
        worker: process.pid
      });
    });

    // Register main routes
    const server = await registerRoutes(app);

    // 404 handler
    app.use(notFoundHandler);

    // Global error handler
    app.use(errorHandler);

    // Setup Vite in development or serve static files in production
    if (isDev) {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    // Graceful shutdown handling
    const gracefulShutdown = async (signal: string) => {
      log.info(`Received ${signal}, starting graceful shutdown`);
      
      server.close(() => {
        log.info('HTTP server closed');
        
        // Close database connections, Redis, etc.
        Promise.all([
          // Add cleanup promises here
          monitoringService.shutdown(),
        ]).then(() => {
          log.info('Graceful shutdown completed');
          process.exit(0);
        }).catch((error) => {
          log.error('Error during graceful shutdown', error);
          process.exit(1);
        });
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        log.error('Forceful shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    // Handle termination signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      log.error('Uncaught exception', error);
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      log.error('Unhandled rejection', { reason, promise });
      gracefulShutdown('unhandledRejection');
    });

    // Start server
    const serverConfig = config.getServer();
    const port = serverConfig.port;
    const host = "0.0.0.0";
    
    // Try to start the server, with fallback to alternative ports if needed
    const startWithFallback = (currentPort: number, maxRetries = 3) => {
      server.listen({ port: currentPort, host }, () => {
        log.info(`🚀 Toko server running on http://${host}:${currentPort}`, {
          port: currentPort,
          environment: process.env.NODE_ENV || 'development',
          worker: process.pid,
          clustering: enableClustering
        });
        log.info(`📱 Anonymous video chat platform ready`);
      }).on('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && maxRetries > 0) {
          log.warn(`Port ${currentPort} is in use, trying port ${currentPort + 1}`);
          startWithFallback(currentPort + 1, maxRetries - 1);
        } else {
          log.error(`Failed to start server: ${err.message}`, { error: err });
          process.exit(1);
        }
      });
    };
    
    startWithFallback(port);

  } catch (error) {
    log.error('Failed to start server', error);
    process.exit(1);
  }
}

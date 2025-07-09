import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import multer from "multer";

// Enhanced imports
import { storage } from "./storage";
import { insertUserSchema } from "@shared/schema";
import { redisManager } from "./redis";
import { monitoringService } from "./monitoring";
import { matchmakingService } from "./services/matchmaking";
import { liveKitService } from "./services/livekit";
import { authService } from "./services/auth";
import { moderationService } from "./services/moderation";
import { presenceService } from "./services/presence";

// New utility imports
import { log } from "./utils/logger.js";
import { asyncHandler, ValidationError, AuthenticationError, AppError } from "./utils/errorHandler.js";
import { securityManager } from "./utils/security.js";
import { validate, schemas } from "./utils/validation.js";
import { cacheService } from "./utils/cache.js";
import { jobQueue, JobTypes } from "./utils/jobQueue.js";
import { webhookManager, WebhookEvents } from "./utils/webhooks.js";
import { emailService, sendWelcomeEmail } from "./utils/emailService.js";
import { storageService } from "./utils/storageService.js";
import { config } from "./utils/config.js";

// API versioning
const API_VERSION = 'v1';
const API_PREFIX = `/api/${API_VERSION}`;

// Store for matching users
const waitingUsers = new Map();
const activeChats = new Map();

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/temp/',
  limits: {
    fileSize: config.getUpload().maxFileSize,
    files: 5
  },
  fileFilter: (req: any, file: any, cb: any) => {
    const allowedTypes = config.getUpload().allowedTypes;
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ValidationError(`File type ${file.mimetype} not allowed`));
    }
  }
});

// Enhanced rate limiting middleware with monitoring integration
async function enhancedRateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  const clientIp = req.ip || req.socket.remoteAddress;
  const userAgent = req.get('User-Agent') || 'unknown';
  const endpoint = req.path;
  
  try {
    // Different rate limits for different endpoints
    let limit = 100;
    let window = 60;
    
    if (endpoint.includes('/auth')) {
      limit = 10;
      window = 900; // 15 minutes
    } else if (endpoint.includes('/upload')) {
      limit = 20;
      window = 3600; // 1 hour
    } else if (endpoint.includes('/matchmaking')) {
      limit = 30;
      window = 60;
    }
    
    const key = `${clientIp}:${endpoint}`;
    const isAllowed = await redisManager.checkRateLimit(key, limit, window);
    
    if (!isAllowed) {
      monitoringService.trackError('rate_limit', `Rate limit exceeded for ${clientIp} on ${endpoint}`);
      
      // Log suspicious activity
      log.security('Rate limit exceeded', {
        ip: clientIp,
        userAgent,
        endpoint,
        timestamp: new Date().toISOString()
      });
      
      return res.status(429).json({ 
        error: 'Rate limit exceeded. Please try again later.',
        retryAfter: window,
        endpoint,
        version: API_VERSION
      });
    }
    
    next();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('Rate limiting error', { error: err.message, ip: clientIp });
    next(); // Allow request on rate limiting error
  }
}

// Request/Response logging middleware
function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(2, 15);
  
  // Add request ID to response headers
  res.setHeader('X-Request-ID', requestId);
  
  // Log request
  log.api('Incoming request', {
    requestId,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  
  // Override res.json to log response
  const originalJson = res.json;
  res.json = function(body: any) {
    const duration = Date.now() - startTime;
    
    log.api('Response sent', {
      requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
    
    return originalJson.call(this, body);
  };
  
  next();
}

// API Version validation middleware
function apiVersionMiddleware(req: Request, res: Response, next: NextFunction) {
  const acceptedVersion = req.headers['api-version'] || 'v1';
  
  if (acceptedVersion !== API_VERSION) {
    return res.status(400).json({
      error: 'API version not supported',
      supportedVersion: API_VERSION,
      requestedVersion: acceptedVersion
    });
  }
  
  next();
}

let io: SocketIOServer;

export async function registerRoutes(app: Express): Promise<Server> {
  // Apply middleware to all API routes
  app.use('/api', requestLoggingMiddleware);
  app.use('/api', apiVersionMiddleware);
  app.use('/api', enhancedRateLimitMiddleware);

  // API Discovery endpoint
  app.get('/api', (req: Request, res: Response) => {
    res.json({
      service: 'toko-backend',
      version: API_VERSION,
      endpoints: {
        health: `${API_PREFIX}/health`,
        metrics: `${API_PREFIX}/metrics`,
        auth: `${API_PREFIX}/auth`,
        matchmaking: `${API_PREFIX}/matchmaking`,
        users: `${API_PREFIX}/users`,
        presence: `${API_PREFIX}/presence`,
        upload: `${API_PREFIX}/upload`
      },
      documentation: '/api/docs',
      timestamp: new Date().toISOString()
    });
  });

  // Enhanced health check endpoint
  app.get(`${API_PREFIX}/health`, asyncHandler(async (req: Request, res: Response) => {
    const healthStatus = await monitoringService.getHealthStatus();
    res.status(healthStatus.status === 'unhealthy' ? 503 : 200).json({
      ...healthStatus,
      service: 'toko-backend',
      version: API_VERSION,
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    });
  }));

  // Metrics endpoint for Prometheus/monitoring
  app.get(`${API_PREFIX}/metrics`, asyncHandler(async (req: Request, res: Response) => {
    const format = req.query.format as string || 'json';
    const metrics = await monitoringService.exportMetrics(format as 'json' | 'prometheus');
    
    if (format === 'prometheus') {
      res.set('Content-Type', 'text/plain');
    } else {
      res.set('Content-Type', 'application/json');
    }
    
    res.send(metrics);
  }));

  // System stats endpoint for admin dashboard
  app.get(`${API_PREFIX}/stats`, asyncHandler(async (req: Request, res: Response) => {
    const [systemMetrics, summary] = await Promise.all([
      monitoringService.getSystemMetrics(),
      monitoringService.getMetricsSummary()
    ]);
    
    res.json({
      system: systemMetrics,
      metrics: summary,
      version: API_VERSION,
      timestamp: new Date().toISOString()
    });
  }));

  // Authentication endpoints
  app.post(`${API_PREFIX}/auth/register`, 
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const { name, email, password, avatar, provider } = req.body;
        
        log.info(`Registration attempt for: ${email}`, { service: 'auth' });
        
        // Check if user already exists
        const existingUser = await storage.getUserByEmail(email);
        if (existingUser) {
          log.warn(`Registration failed - user already exists: ${email}`, { service: 'auth' });
          return res.status(400).json({ 
            error: 'User already exists',
            message: 'A user with this email already exists'
          });
        }
        
        // Create user
        const user = await storage.createUser({ 
          name, 
          email, 
          password,
          avatar: avatar || null,
          provider: provider || 'local',
          country: 'Any on Earth',
          tags: []
        });
        
        // Generate token
        const token = await authService.generateToken({
          userId: user.id,
          email: user.email,
          name: user.name
        });
        
        log.info(`User registered successfully: ${email}`, { service: 'auth', userId: user.id });
        
        // Track user registration
        monitoringService.recordMetric('user.registered', 1, {
          source: 'api',
          version: API_VERSION
        });
        
        res.status(201).json({
          message: 'User created successfully',
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            avatar: user.avatar
          },
          token
        });
      } catch (error) {
        log.error(`Registration error: ${error instanceof Error ? error.message : String(error)}`, { 
          service: 'auth',
          stack: error instanceof Error ? error.stack : undefined
        });
        
        // Send a proper error response instead of throwing
        res.status(500).json({
          error: 'Registration failed',
          message: process.env.NODE_ENV === 'production' 
            ? 'An error occurred during registration. Please try again.' 
            : error instanceof Error ? error.message : String(error)
        });
      }
    })
  );

  app.post(`${API_PREFIX}/auth/login`,
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const { email, password } = req.body;
        
        log.info(`Login attempt for: ${email}`, { service: 'auth' });
        
        // Authenticate user
        const user = await storage.authenticateUser(email, password);
        if (!user) {
          log.warn(`Login failed - invalid credentials: ${email}`, { service: 'auth' });
          return res.status(401).json({ 
            error: 'Authentication failed',
            message: 'Invalid email or password'
          });
        }
        
        // Generate token
        const token = await authService.generateToken({
          userId: user.id,
          email: user.email,
          name: user.name
        });
        
        log.info(`User logged in successfully: ${email}`, { service: 'auth', userId: user.id });
        
        // Track successful login
        monitoringService.recordMetric('user.login', 1, {
          source: 'api',
          version: API_VERSION
        });
        
        res.json({
          message: 'Login successful',
          token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            avatar: user.avatar
          }
        });
      } catch (error) {
        log.error(`Login error: ${error instanceof Error ? error.message : String(error)}`, { 
          service: 'auth',
          stack: error instanceof Error ? error.stack : undefined
        });
        
        // Send a proper error response instead of throwing
        res.status(500).json({
          error: 'Login failed',
          message: process.env.NODE_ENV === 'production' 
            ? 'An error occurred during login. Please try again.' 
            : error instanceof Error ? error.message : String(error)
        });
      }
    })
  );

  // Google OAuth authentication
  app.post(`${API_PREFIX}/auth/google`,
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const { credential } = req.body;
        
        if (!credential) {
          log.warn('Missing Google credential in request', { service: 'auth' });
          return res.status(400).json({ 
            error: 'Missing Google credential',
            message: 'Google ID token is required'
          });
        }
        
        // Log request details for debugging (exclude sensitive data)
        log.info('Google authentication attempt', { 
          service: 'auth',
          headers: {
            origin: req.headers.origin,
            referer: req.headers.referer,
            'user-agent': req.headers['user-agent'],
          },
          ip: req.ip,
          timestamp: new Date().toISOString()
        });
        
        // Get Google client ID from environment
        const googleClientId = process.env.GOOGLE_CLIENT_ID || '1073237357352-7ngur8kmp8vftgfkbu3p5fnvtrdb9kng.apps.googleusercontent.com';
        log.debug('Using Google OAuth config', {
          clientId: googleClientId.substring(0, 10) + '...',
          // Don't log client secret
        });
        
        // Verify Google token
        const user = await authService.verifyGoogleToken(credential);
        
        if (!user) {
          log.warn('Google authentication failed - invalid token', { service: 'auth' });
          return res.status(401).json({ 
            error: 'Authentication failed',
            message: 'Invalid Google token'
          });
        }
        
        // Generate token
        const token = await authService.generateToken({
          userId: user.id,
          email: user.email,
          name: user.name
        });
        
        log.info(`User authenticated with Google: ${user.email}`, { service: 'auth', userId: user.id });
        
        // Track successful Google login
        monitoringService.recordMetric('user.google_login', 1, {
          source: 'api',
          version: API_VERSION
        });
        
        res.json({
          message: 'Google authentication successful',
          token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            avatar: user.avatar
          }
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        log.error(`Google authentication error: ${err.message}`, { 
          service: 'auth',
          stack: err.stack
        });
        monitoringService.trackError('auth_google', `Google authentication failed: ${err.message}`);
        
        res.status(500).json({
          error: 'Server error during Google authentication',
          message: process.env.NODE_ENV === 'production' ? 'Authentication failed' : err.message
        });
      }
    })
  );
  
  // Google OAuth callback endpoint
  app.get(`${API_PREFIX}/auth/google/callback`,
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const { code } = req.query;
        
        if (!code) {
          log.warn('Missing authorization code in Google callback', { service: 'auth' });
          return res.status(400).json({ 
            error: 'Missing authorization code',
            message: 'Authorization code is required'
          });
        }
        
        log.info('Google OAuth callback received', { service: 'auth' });
        
        // Get Google OAuth configuration from environment
        const googleClientId = process.env.GOOGLE_CLIENT_ID || '1073237357352-7ngur8kmp8vftgfkbu3p5fnvtrdb9kng.apps.googleusercontent.com';
        const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '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';
        const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5001/api/v1/auth/google/callback';
        
        // In a production app, this would exchange the code for tokens using Google API
        // For now, we'll redirect back to the frontend with a success message
        
        // Redirect to frontend with success parameter
        res.redirect(`${req.protocol}://${req.get('host')}/auth/google/success`);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        log.error(`Google OAuth callback error: ${err.message}`, { 
          service: 'auth',
          stack: err.stack
        });
        
        // Redirect to frontend with error parameter
        res.redirect(`${req.protocol}://${req.get('host')}/auth/google/error?message=${encodeURIComponent('Authentication failed')}`);
      }
    })
  );

  // Matchmaking endpoints
  app.post(`${API_PREFIX}/matchmaking/join`,
    validate(schemas.matchmaking.join),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, preferences } = req.body;
      
      // Validate user exists
      const user = await authService.findUserById(userId);
      if (!user) {
        throw new ValidationError('User not found');
      }
      
      // Add to matchmaking queue
      const queuePosition = await matchmakingService.addToQueueWithPreferences(userId, preferences);
      
      // Track matchmaking request
      monitoringService.recordMetric('matchmaking.queue_join', 1, {
        version: API_VERSION
      });
      
      res.json({
        message: 'Added to matchmaking queue',
        queuePosition,
        estimatedWaitTime: matchmakingService.getEstimatedWaitTime()
      });
    })
  );

  app.delete(`${API_PREFIX}/matchmaking/leave/:userId`,
    validate(schemas.matchmaking.leave),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId } = req.params;
      
      const removed = await matchmakingService.removeFromQueueWithResult(userId);
      
      if (removed) {
        monitoringService.recordMetric('matchmaking.queue_leave', 1, {
          version: API_VERSION
        });
      }
      
      res.json({
        message: removed ? 'Removed from queue' : 'User not in queue',
        removed
      });
    })
  );

  app.get(`${API_PREFIX}/matchmaking/stats`, asyncHandler(async (req: Request, res: Response) => {
    const stats = await matchmakingService.getQueueStats();
    res.json({
      ...stats,
      version: API_VERSION,
      timestamp: new Date().toISOString()
    });
  }));

  // Presence endpoints
  app.get(`${API_PREFIX}/presence/online`, asyncHandler(async (req: Request, res: Response) => {
    const onlineUsers = await presenceService.getOnlineUsers();
    res.json({
      users: onlineUsers.map(user => ({
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        tags: user.tags,
        country: user.country,
        joinedAt: user.joinedAt
      })),
      total: onlineUsers.length,
      version: API_VERSION,
      timestamp: new Date().toISOString()
    });
  }));

  // File upload endpoints
  app.post(`${API_PREFIX}/upload/avatar`,
    upload.single('avatar'),
    validate(schemas.upload.avatar),
    asyncHandler(async (req: Request, res: Response) => {
      if (!req.file) {
        throw new ValidationError('No file uploaded');
      }
      
      // Process and store file
      const result = await storageService.storeFile(req.file, {
        type: 'avatar',
        userId: req.body.userId
      });
      
      // Track upload
      monitoringService.recordMetric('upload.avatar', 1, {
        version: API_VERSION
      });
      
      res.json({
        message: 'Avatar uploaded successfully',
        url: result.url,
        fileId: result.fileId
      });
    })
  );

  // User management endpoints
  app.get(`${API_PREFIX}/users/:userId`,
    validate(schemas.users.getUser),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId } = req.params;
      
      // Try cache first
      const cacheKey = `user:${userId}`;
      let user: any = await cacheService.get(cacheKey);
      
      if (!user) {
        user = await authService.findUserById(userId);
        if (user) {
          await cacheService.set(cacheKey, user, 300); // 5 minutes
        }
      }
      
      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          version: API_VERSION
        });
      }
      
      res.json({
        user: {
          id: (user as any).id,
          username: (user as any).name || (user as any).email, // Use name or email as fallback
          avatar: (user as any).avatar,
          joinedAt: (user as any).createdAt || Date.now() // Use createdAt or current timestamp
        },
        version: API_VERSION
      });
    })
  );

  // WebRTC signaling endpoints
  app.post(`${API_PREFIX}/webrtc/offer`,
    validate(schemas.webrtc.offer),
    asyncHandler(async (req: Request, res: Response) => {
      const { roomId, offer, fromUserId } = req.body;
      
      // Store offer in Redis with expiration
      await redisManager.setex(`webrtc:offer:${roomId}:${fromUserId}`, 300, JSON.stringify(offer));
      
      // Track WebRTC event
      monitoringService.recordMetric('webrtc.offer', 1, {
        version: API_VERSION
      });
      
      res.json({
        message: 'Offer stored',
        version: API_VERSION
      });
    })
  );

  // Admin endpoints (protected)
  app.get(`${API_PREFIX}/admin/logs`,
    securityManager.requireAuth(),
    securityManager.requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { level, limit = 100, offset = 0 } = req.query;
      
      // Get logs from monitoring service
      const logs = await monitoringService.getMetrics('system.logs', {
        start: Date.now() - 24 * 60 * 60 * 1000, // Last 24 hours
        end: Date.now()
      });
      
      res.json({
        logs: logs['system.logs'] || [],
        version: API_VERSION,
        timestamp: new Date().toISOString()
      });
    })
  );

  // Error testing endpoint (development only)
  if (process.env.NODE_ENV === 'development') {
    app.post(`${API_PREFIX}/test/error`, (req: Request, res: Response) => {
      const { type = 'generic' } = req.body;
      
      switch (type) {
        case 'validation':
          throw new ValidationError('Test validation error');
        case 'auth':
          throw new AuthenticationError('Test authentication error');
        case 'generic':
          throw new AppError('Test generic error', 500);
        default:
          throw new Error('Test unknown error');
      }
    });
  }

  // Create HTTP server
  const server = createServer(app);

  // Initialize WebSocket server with enhanced security
  io = new SocketIOServer(server, {
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:5000'],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 10000,
    allowEIO3: true
  });

  // WebSocket middleware for authentication and monitoring
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (token) {
        const user = await authService.verifyToken(token);
        if (user) {
          socket.data.user = user;
        }
      }
      
      // Track connection attempt
      monitoringService.recordMetric('websocket.connection_attempt', 1);
      
      next();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('WebSocket authentication error', { error: err.message });
      next(err);
    }
  });

  // WebSocket connection handling with monitoring
  io.on('connection', (socket) => {
    const user = socket.data.user;
    
    log.websocket('User connected', {
      socketId: socket.id,
      userId: user?.id,
      timestamp: new Date().toISOString()
    });
    
    // Track successful connection
    monitoringService.recordWebSocketMetric('connect', io.engine.clientsCount);
    
    // Add user to presence service
    if (user) {
      presenceService.addUser(user.id, {
        socketId: socket.id,
        connectedAt: new Date(),
        lastSeen: new Date()
      });
    }

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      log.websocket('User disconnected', {
        socketId: socket.id,
        userId: user?.id,
        reason,
        timestamp: new Date().toISOString()
      });
      
      // Track disconnection
      monitoringService.recordWebSocketMetric('disconnect', io.engine.clientsCount);
      
      // Remove from presence service
      if (user) {
        presenceService.removeUser(user.id);
      }
      
      // Remove from waiting users and active chats
      waitingUsers.delete(socket.id);
      
      for (const [roomId, room] of activeChats.entries()) {
        if (room.users.some((u: any) => u.socketId === socket.id)) {
          // Notify other user about disconnection
          const otherUser = room.users.find((u: any) => u.socketId !== socket.id);
          if (otherUser) {
            socket.to(otherUser.socketId).emit('user_disconnected');
          }
          activeChats.delete(roomId);
          break;
        }
      }
    });

    // Rest of socket event handlers...
    // (Previous socket event handlers would go here with monitoring integration)
  });

  return server;
}

// Export for external use
export { io, API_VERSION, API_PREFIX };

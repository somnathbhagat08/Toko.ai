import { Request, Response, NextFunction } from 'express';
import { redisManager } from '../redis.js';
import { log } from './logger.js';
import { RateLimitError } from './errorHandler.js';
import { monitoringService } from '../monitoring.js';

interface RateLimitOptions {
  windowMs: number;        // Time window in milliseconds
  maxRequests: number;     // Maximum requests per window
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
  onLimitReached?: (req: Request) => void;
}

interface SecurityOptions {
  maxBodySize?: string;
  allowedOrigins?: string[];
  maxHeaderSize?: number;
  rateLimits?: {
    general?: RateLimitOptions;
    auth?: RateLimitOptions;
    api?: RateLimitOptions;
    websocket?: RateLimitOptions;
  };
}

class SecurityManager {
  private defaultRateLimits: Record<string, RateLimitOptions> = {
    general: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 1000,
      keyGenerator: (req) => this.getClientIp(req)
    },
    auth: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 10, // Strict limit for auth endpoints
      keyGenerator: (req) => `auth:${this.getClientIp(req)}`
    },
    api: {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 100,
      keyGenerator: (req) => `api:${this.getClientIp(req)}`
    },
    websocket: {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 200,
      keyGenerator: (req) => `ws:${this.getClientIp(req)}`
    }
  };

  private suspiciousPatterns = [
    /(\b(union|select|insert|delete|update|drop|create|alter|exec|script)\b)/gi,
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /(\.\.\/|\.\.\%2f)/gi, // Path traversal
    /(\beval\b|\balert\b|\bconfirm\b|\bprompt\b)/gi
  ];

  constructor(private options: SecurityOptions = {}) {}

  // Enhanced IP extraction
  private getClientIp(req: Request): string {
    const xForwardedFor = req.headers['x-forwarded-for'];
    const xRealIp = req.headers['x-real-ip'];
    const cfConnectingIp = req.headers['cf-connecting-ip'];
    
    let ip = req.connection.remoteAddress || 
             req.socket.remoteAddress || 
             (req.connection as any)?.socket?.remoteAddress ||
             'unknown';

    // Handle forwarded IPs (first IP is the original client)
    if (typeof xForwardedFor === 'string') {
      ip = xForwardedFor.split(',')[0].trim();
    } else if (typeof xRealIp === 'string') {
      ip = xRealIp;
    } else if (typeof cfConnectingIp === 'string') {
      ip = cfConnectingIp;
    }

    // Remove IPv6 prefix if present
    if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }

    return ip;
  }

  // Create rate limiting middleware
  createRateLimiter(type: string = 'general') {
    const config = this.options.rateLimits?.[type as keyof typeof this.options.rateLimits] || 
                   this.defaultRateLimits[type] || 
                   this.defaultRateLimits.general;

    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const key = config.keyGenerator ? config.keyGenerator(req) : this.getClientIp(req);
        const redisKey = `rate_limit:${type}:${key}`;
        
        // Check if rate limit is exceeded
        const isAllowed = await redisManager.checkRateLimit(
          redisKey, 
          config.maxRequests, 
          Math.floor(config.windowMs / 1000)
        );

        if (!isAllowed) {
          // Log the rate limit violation
          log.security('Rate limit exceeded', {
            type,
            ip: this.getClientIp(req),
            userAgent: req.get('User-Agent'),
            url: req.url,
            method: req.method
          });

          // Track in monitoring
          monitoring.trackError('RATE_LIMIT_EXCEEDED', `${type} rate limit exceeded for ${key}`);

          // Call custom handler if provided
          if (config.onLimitReached) {
            config.onLimitReached(req);
          }

          // Set rate limit headers
          res.set({
            'X-RateLimit-Limit': config.maxRequests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(Date.now() + config.windowMs).toISOString(),
            'Retry-After': Math.ceil(config.windowMs / 1000).toString()
          });

          throw new RateLimitError(`Rate limit exceeded for ${type}. Try again later.`);
        }

        // Get current usage for headers
        const usage = await redisManager.getRateLimitUsage(redisKey);
        res.set({
          'X-RateLimit-Limit': config.maxRequests.toString(),
          'X-RateLimit-Remaining': Math.max(0, config.maxRequests - (usage || 0)).toString(),
          'X-RateLimit-Reset': new Date(Date.now() + config.windowMs).toISOString()
        });

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  // Input sanitization middleware
  sanitizeInput() {
    return (req: Request, res: Response, next: NextFunction) => {
      try {
        // Check for suspicious patterns in URL
        const url = req.url.toLowerCase();
        const suspicious = this.suspiciousPatterns.some(pattern => pattern.test(url));
        
        if (suspicious) {
          log.security('Suspicious URL pattern detected', {
            ip: this.getClientIp(req),
            url: req.url,
            userAgent: req.get('User-Agent')
          });
          
          monitoring.trackError('SUSPICIOUS_REQUEST', `Suspicious URL pattern: ${req.url}`);
        }

        // Sanitize request body recursively
        if (req.body && typeof req.body === 'object') {
          req.body = this.sanitizeObject(req.body);
        }

        // Sanitize query parameters
        if (req.query && typeof req.query === 'object') {
          req.query = this.sanitizeObject(req.query);
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  // Recursive object sanitization
  private sanitizeObject(obj: any): any {
    if (typeof obj === 'string') {
      return this.sanitizeString(obj);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }
    
    if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[this.sanitizeString(key)] = this.sanitizeObject(value);
      }
      return sanitized;
    }
    
    return obj;
  }

  // String sanitization
  private sanitizeString(str: string): string {
    if (typeof str !== 'string') return str;
    
    // Remove potential XSS vectors
    return str
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .replace(/(\b(eval|alert|confirm|prompt)\b)/gi, '');
  }

  // CORS security middleware
  corsHandler(allowedOrigins: string[] = []) {
    return (req: Request, res: Response, next: NextFunction) => {
      const origin = req.headers.origin;
      
      // Allow requests with no origin (mobile apps, etc.)
      if (!origin) {
        res.header('Access-Control-Allow-Origin', '*');
      } else if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
      } else {
        log.security('CORS violation', {
          origin,
          ip: this.getClientIp(req),
          userAgent: req.get('User-Agent')
        });
      }

      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Max-Age', '86400'); // 24 hours

      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    };
  }

  // Security headers middleware
  securityHeaders() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Prevent clickjacking
      res.header('X-Frame-Options', 'DENY');
      
      // Prevent MIME type sniffing
      res.header('X-Content-Type-Options', 'nosniff');
      
      // Enable XSS protection
      res.header('X-XSS-Protection', '1; mode=block');
      
      // Strict transport security (HTTPS only)
      if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
        res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
      
      // Content Security Policy
      res.header('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "connect-src 'self' ws: wss:",
        "font-src 'self'",
        "object-src 'none'",
        "media-src 'self'",
        "frame-src 'none'"
      ].join('; '));
      
      // Hide server info
      res.removeHeader('X-Powered-By');
      
      next();
    };
  }

  // Request size limiter
  requestSizeLimiter(maxSize: string = '10mb') {
    return (req: Request, res: Response, next: NextFunction) => {
      const contentLength = req.headers['content-length'];
      
      if (contentLength) {
        const sizeInMB = parseInt(contentLength) / (1024 * 1024);
        const maxSizeInMB = parseInt(maxSize.replace('mb', ''));
        
        if (sizeInMB > maxSizeInMB) {
          log.security('Request size exceeded', {
            ip: this.getClientIp(req),
            size: `${sizeInMB.toFixed(2)}MB`,
            maxSize,
            url: req.url
          });
          
          return res.status(413).json({
            error: 'Request entity too large',
            maxSize
          });
        }
      }
      
      next();
    };
  }

  // IP blocking middleware
  createIpBlocker(blockedIps: string[] = []) {
    const blockedSet = new Set(blockedIps);
    
    return (req: Request, res: Response, next: NextFunction) => {
      const clientIp = this.getClientIp(req);
      
      if (blockedSet.has(clientIp)) {
        log.security('Blocked IP access attempt', {
          ip: clientIp,
          url: req.url,
          userAgent: req.get('User-Agent')
        });
        
        return res.status(403).json({
          error: 'Access denied'
        });
      }
      
      next();
    };
  }

  // Authentication middleware - requires valid JWT token
  requireAuth() {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({
            error: 'Authentication required',
            code: 'MISSING_TOKEN'
          });
        }

        const token = authHeader.substring(7);
        
        // Import authService here to avoid circular dependency
        const { authService } = await import('../services/auth.js');
        const decoded = await authService.verifyToken(token);
        
        // Attach user info to request
        (req as any).user = {
          id: decoded.userId,
          email: decoded.email,
          name: decoded.name,
          avatar: decoded.avatar,
          permissions: decoded.permissions
        };

        next();
      } catch (error) {
        log.security('Authentication failed', {
          ip: this.getClientIp(req),
          url: req.url,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        return res.status(401).json({
          error: 'Invalid or expired token',
          code: 'INVALID_TOKEN'
        });
      }
    };
  }

  // Role-based access control middleware
  requireRole(requiredRole: string | string[]) {
    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    
    return (req: Request, res: Response, next: NextFunction) => {
      const user = (req as any).user;
      
      if (!user) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'NO_USER'
        });
      }

      const userPermissions = user.permissions || [];
      const hasRole = roles.some(role => 
        userPermissions.includes(role) || 
        userPermissions.includes('admin') // Admin has all roles
      );

      if (!hasRole) {
        log.security('Insufficient permissions', {
          userId: user.id,
          requiredRoles: roles,
          userPermissions,
          ip: this.getClientIp(req),
          url: req.url
        });
        
        return res.status(403).json({
          error: 'Insufficient permissions',
          code: 'INSUFFICIENT_PERMISSIONS',
          required: roles
        });
      }

      next();
    };
  }
}

export const securityManager = new SecurityManager();

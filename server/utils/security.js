/**
 * Security utilities for Toko application
 */
import { log } from './logger.js';
import { config } from './config.js';

/**
 * Security manager class
 */
class SecurityManager {
  /**
   * Create security headers middleware
   */
  securityHeaders() {
    return (req, res, next) => {
      // Security headers
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      
      // Content Security Policy
      const cspDirectives = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://accounts.google.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: https://*",
        "font-src 'self' https://fonts.gstatic.com",
        "connect-src 'self' https://api.toko.chat wss://*.livekit.cloud",
        "media-src 'self' blob:",
        "object-src 'none'",
        "frame-src 'self' https://accounts.google.com"
      ];
      
      // Only apply strict CSP in production
      if (process.env.NODE_ENV === 'production') {
        res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
      } else {
        // More permissive in development
        res.setHeader('Content-Security-Policy-Report-Only', cspDirectives.join('; '));
      }
      
      next();
    };
  }
  
  /**
   * Input sanitization middleware
   */
  sanitizeInput() {
    return (req, res, next) => {
      // Basic sanitization of input data
      if (req.body) {
        this.sanitizeObject(req.body);
      }
      
      if (req.query) {
        this.sanitizeObject(req.query);
      }
      
      if (req.params) {
        this.sanitizeObject(req.params);
      }
      
      next();
    };
  }
  
  /**
   * Sanitize an object's string properties
   */
  sanitizeObject(obj) {
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        // Remove potential script tags and other dangerous content
        obj[key] = obj[key]
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+=/gi, '');
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        this.sanitizeObject(obj[key]);
      }
    }
  }
  
  /**
   * Create rate limiter middleware
   */
  createRateLimiter(type = 'general') {
    const limits = {
      auth: { max: 10, windowMs: 15 * 60 * 1000 }, // 10 requests per 15 minutes
      api: { max: 100, windowMs: 60 * 1000 }, // 100 requests per minute
      general: { max: 500, windowMs: 60 * 1000 } // 500 requests per minute
    };
    
    const limit = limits[type] || limits.general;
    
    // Simple in-memory rate limiting (in production, use Redis-backed solution)
    const requests = new Map();
    
    return (req, res, next) => {
      const ip = req.ip || req.connection.remoteAddress;
      const key = `${ip}:${req.path}`;
      const now = Date.now();
      
      // Clean up old entries
      if (requests.has(key)) {
        const requestData = requests.get(key);
        requestData.timestamps = requestData.timestamps.filter(time => now - time < limit.windowMs);
        
        if (requestData.timestamps.length >= limit.max) {
          log.security('Rate limit exceeded', { ip, path: req.path });
          return res.status(429).json({
            error: 'Too many requests, please try again later',
            retryAfter: Math.ceil(limit.windowMs / 1000)
          });
        }
        
        requestData.timestamps.push(now);
      } else {
        requests.set(key, { timestamps: [now] });
      }
      
      next();
    };
  }
  
  /**
   * Request size limiter middleware
   */
  requestSizeLimiter(maxSize = '1mb') {
    return (req, res, next) => {
      const contentLength = parseInt(req.headers['content-length'] || '0');
      const maxBytes = typeof maxSize === 'string' ? 
        parseInt(maxSize.replace('mb', '000000').replace('kb', '000')) : 
        maxSize;
      
      if (contentLength > maxBytes) {
        log.security('Request size limit exceeded', { 
          size: contentLength, 
          limit: maxBytes,
          path: req.path
        });
        
        return res.status(413).json({
          error: 'Request entity too large',
          limit: maxSize
        });
      }
      
      next();
    };
  }
}

export const securityManager = new SecurityManager();
export default securityManager;

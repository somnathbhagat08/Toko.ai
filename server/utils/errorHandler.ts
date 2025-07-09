import { Request, Response, NextFunction } from 'express';
import { log } from './logger.js';
import { monitoringService } from '../monitoring.js';
import { z } from 'zod';

// Custom error classes
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code?: string;

  constructor(message: string, statusCode: number = 500, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401, 'AUTH_ERROR');
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT');
    this.name = 'RateLimitError';
  }
}

export class DatabaseError extends AppError {
  constructor(message: string = 'Database operation failed') {
    super(message, 500, 'DATABASE_ERROR');
    this.name = 'DatabaseError';
  }
}

// Error handling utilities
export const handleZodError = (error: z.ZodError): ValidationError => {
  const message = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
  return new ValidationError(`Validation failed: ${message}`);
};

export const handleDatabaseError = (error: any): AppError => {
  // Handle specific database errors
  if (error.code === '23505') { // Unique constraint violation
    return new ValidationError('Resource already exists');
  }
  if (error.code === '23503') { // Foreign key constraint violation
    return new ValidationError('Referenced resource does not exist');
  }
  if (error.code === '23502') { // Not null constraint violation
    return new ValidationError('Required field is missing');
  }
  
  log.error('Database error', { error: error.message, code: error.code, stack: error.stack });
  return new DatabaseError('Database operation failed');
};

// Async error wrapper
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Global error handler middleware
export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let appError: AppError;

  // Convert different error types to AppError
  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof z.ZodError) {
    appError = handleZodError(error);
  } else if (error.name === 'ValidationError') {
    appError = new ValidationError(error.message);
  } else if (error.name === 'CastError') {
    appError = new ValidationError('Invalid ID format');
  } else if (error.name === 'JsonWebTokenError') {
    appError = new AuthenticationError('Invalid token');
  } else if (error.name === 'TokenExpiredError') {
    appError = new AuthenticationError('Token expired');
  } else {
    // Unknown error - log it for investigation
    log.error('Unhandled error', {
      message: error.message,
      stack: error.stack,
      url: req.url,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    appError = new AppError(
      process.env.NODE_ENV === 'production' 
        ? 'Something went wrong' 
        : error.message,
      500,
      'INTERNAL_ERROR'
    );
  }

  // Track error in monitoring
  monitoringService.trackError(appError.code || 'UNKNOWN_ERROR', appError.message);

  // Log operational errors at warn level, programming errors at error level
  if (appError.isOperational) {
    log.warn('Operational error', {
      code: appError.code,
      message: appError.message,
      statusCode: appError.statusCode,
      url: req.url,
      method: req.method,
      ip: req.ip
    });
  } else {
    log.error('Programming error', {
      code: appError.code,
      message: appError.message,
      stack: appError.stack,
      url: req.url,
      method: req.method,
      ip: req.ip
    });
  }

  // Send error response
  const response: any = {
    error: {
      message: appError.message,
      code: appError.code,
      statusCode: appError.statusCode
    }
  };

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    response.error.stack = appError.stack;
  }

  res.status(appError.statusCode).json(response);
};

// 404 handler
export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
  const error = new NotFoundError(`Route ${req.originalUrl}`);
  next(error);
};

// Validation middleware factory
export const validateSchema = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(handleZodError(error));
      } else {
        next(error);
      }
    }
  };
};

import { log } from './logger.js';

/**
 * Custom error classes for different types of errors
 */
export class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message) {
    super(message, 401);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message) {
    super(message, 403);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message) {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

/**
 * Global error handler middleware
 */
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const errorType = err.name || 'Error';
  const message = err.message || 'Something went wrong';
  
  // Log the error with appropriate level
  if (statusCode >= 500) {
    log.error(`${errorType}: ${message}`, {
      statusCode,
      path: req.path,
      method: req.method,
      ip: req.ip,
      stack: err.stack
    });
  } else {
    log.warn(`${errorType}: ${message}`, {
      statusCode,
      path: req.path,
      method: req.method
    });
  }
  
  // Send response to client
  res.status(statusCode).json({
    error: message,
    type: errorType,
    status: statusCode,
    timestamp: new Date().toISOString()
  });
}

/**
 * 404 Not Found handler middleware
 */
export function notFoundHandler(req, res, next) {
  log.warn(`Route not found: ${req.method} ${req.originalUrl}`);
  
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    status: 404,
    timestamp: new Date().toISOString()
  });
}

/**
 * Async handler wrapper to avoid try/catch blocks in route handlers
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  errorHandler,
  notFoundHandler,
  asyncHandler
};

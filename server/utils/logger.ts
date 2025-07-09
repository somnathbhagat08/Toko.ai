import winston from 'winston';
import path from 'path';

// Custom log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};

// Custom colors for console output
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
  trace: 'magenta'
};

winston.addColors(colors);

// Custom format for structured logging
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
    const serviceStr = service ? `[${service}]` : '';
    return `${timestamp} ${level} ${serviceStr} ${message} ${metaStr}`;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: logFormat,
  defaultMeta: { service: 'toko-backend' },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'development' ? consoleFormat : logFormat
    }),
    
    // File transports for production
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'exceptions.log')
    })
  ],
  
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'rejections.log')
    })
  ]
});

// Helper functions for structured logging
export const log = {
  error: (message: string, meta?: any) => logger.error(message, meta),
  warn: (message: string, meta?: any) => logger.warn(message, meta),
  info: (message: string, meta?: any) => logger.info(message, meta),
  debug: (message: string, meta?: any) => logger.debug(message, meta),
  trace: (message: string, meta?: any) => logger.log('trace', message, meta),
  
  // Structured logging for specific contexts
  auth: (message: string, meta?: any) => logger.info(message, { service: 'auth', ...meta }),
  db: (message: string, meta?: any) => logger.info(message, { service: 'database', ...meta }),
  redis: (message: string, meta?: any) => logger.info(message, { service: 'redis', ...meta }),
  socket: (message: string, meta?: any) => logger.info(message, { service: 'socket', ...meta }),
  match: (message: string, meta?: any) => logger.info(message, { service: 'matchmaking', ...meta }),
  monitor: (message: string, meta?: any) => logger.info(message, { service: 'monitoring', ...meta }),
  
  // Metrics logging
  metric: (name: string, meta?: any) => {
    logger.debug(`Metric: ${name}`, { 
      service: 'metrics', 
      metric: name,
      ...meta 
    });
  },
  
  // Alert logging
  alert: (message: string, meta?: any) => {
    logger.warn(`Alert: ${message}`, { 
      service: 'alerting', 
      ...meta 
    });
  },
  
  // Performance logging
  performance: (operation: string, duration: number, meta?: any) => {
    logger.info(`Performance: ${operation} took ${duration}ms`, { 
      service: 'performance', 
      operation, 
      duration,
      ...meta 
    });
  },
  
  // Security logging
  security: (event: string, meta?: any) => {
    logger.warn(`Security event: ${event}`, { 
      service: 'security', 
      event,
      timestamp: new Date().toISOString(),
      ...meta 
    });
  },
  
  // Additional application-specific logging methods
  api: (message: string, meta?: any) => logger.info(message, { category: 'api', ...meta }),
  websocket: (message: string, meta?: any) => logger.info(message, { category: 'websocket', ...meta }),
};

export default logger;

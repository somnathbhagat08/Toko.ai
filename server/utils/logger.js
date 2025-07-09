/**
 * Enhanced logging module for Toko application
 */

// Log levels in order of increasing severity
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  security: 4 // Special level for security-related logs
};

// Determine current log level from environment
const currentLevel = process.env.LOG_LEVEL ? 
  (LOG_LEVELS[process.env.LOG_LEVEL.toLowerCase()] || LOG_LEVELS.info) : 
  (process.env.NODE_ENV === 'production' ? LOG_LEVELS.info : LOG_LEVELS.debug);

// Enable detailed logging in development
const isDevMode = process.env.NODE_ENV !== 'production';

/**
 * Format log message for console output
 */
function formatLog(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const metaString = meta ? JSON.stringify(meta) : '';
  
  // Color coding for different log levels
  let levelColor = '\x1b[0m'; // Reset
  switch(level) {
    case 'debug': levelColor = '\x1b[36m'; break; // Cyan
    case 'info': levelColor = '\x1b[32m'; break; // Green
    case 'warn': levelColor = '\x1b[33m'; break; // Yellow
    case 'error': levelColor = '\x1b[31m'; break; // Red
    case 'security': levelColor = '\x1b[35m'; break; // Magenta
  }
  
  return `${timestamp} ${levelColor}[${level.toUpperCase()}]\x1b[0m ${message} ${metaString ? `- ${metaString}` : ''}`;
}

/**
 * Logger class with support for different log levels
 */
class Logger {
  debug(message, meta = {}) {
    if (LOG_LEVELS.debug >= currentLevel) {
      console.debug(formatLog('debug', message, meta));
    }
  }
  
  info(message, meta = {}) {
    if (LOG_LEVELS.info >= currentLevel) {
      console.info(formatLog('info', message, meta));
    }
  }
  
  warn(message, meta = {}) {
    if (LOG_LEVELS.warn >= currentLevel) {
      console.warn(formatLog('warn', message, meta));
    }
  }
  
  error(message, meta = {}) {
    if (LOG_LEVELS.error >= currentLevel) {
      console.error(formatLog('error', message, meta));
      
      // In development, also log stack traces for Error objects
      if (isDevMode && meta.stack) {
        console.error('\x1b[31m%s\x1b[0m', meta.stack);
      }
    }
  }
  
  security(message, meta = {}) {
    if (LOG_LEVELS.security >= currentLevel) {
      console.error(formatLog('security', message, meta));
    }
  }
  
  // For API request/response logging
  api(message, meta = {}) {
    if (LOG_LEVELS.info >= currentLevel) {
      console.info(formatLog('api', message, meta));
    }
  }
}

// Legacy logging function (for backward compatibility)
function legacyLog(message, type = 'info') {
  const logger = new Logger();
  switch(type.toLowerCase()) {
    case 'debug': logger.debug(message); break;
    case 'info': logger.info(message); break;
    case 'warn': logger.warn(message); break;
    case 'error': logger.error(message); break;
    case 'security': logger.security(message); break;
    default: logger.info(message);
  }
}

export const log = new Logger();
export default legacyLog;

/**
 * File system utilities for Toko application
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './logger.js';

// Get directory of current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

/**
 * Create necessary directories for the application
 */
export async function createDirectories() {
  const dirs = [
    'uploads',
    'uploads/temp',
    'uploads/avatars',
    'uploads/media',
    'logs'
  ];
  
  for (const dir of dirs) {
    const dirPath = path.join(rootDir, dir);
    
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        log.info(`Created directory: ${dirPath}`);
      }
    } catch (error) {
      log.warn(`Failed to create directory: ${dirPath}`, { error: error.message });
    }
  }
}

/**
 * Ensure a file path exists by creating directories if needed
 */
export function ensureDirectoryExists(filePath) {
  const dirname = path.dirname(filePath);
  
  if (fs.existsSync(dirname)) {
    return true;
  }
  
  try {
    fs.mkdirSync(dirname, { recursive: true });
    return true;
  } catch (error) {
    log.error(`Failed to create directory: ${dirname}`, { error: error.message });
    return false;
  }
}

/**
 * Generate a unique filename
 */
export function generateUniqueFilename(originalName) {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 10);
  const ext = path.extname(originalName);
  const basename = path.basename(originalName, ext);
  
  return `${basename}-${timestamp}-${randomString}${ext}`;
}

/**
 * Safely remove a file if it exists
 */
export function safelyRemoveFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (error) {
    log.error(`Failed to remove file: ${filePath}`, { error: error.message });
  }
  
  return false;
}

export default {
  createDirectories,
  ensureDirectoryExists,
  generateUniqueFilename,
  safelyRemoveFile,
  rootDir
};

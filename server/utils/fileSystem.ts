import fs from 'fs';
import path from 'path';
import { log } from './logger.js';

// Create necessary directories for the application
export async function createDirectories(): Promise<void> {
  const directories = [
    'logs',
    'uploads',
    'temp',
    'cache',
    'backups'
  ];

  for (const dir of directories) {
    const dirPath = path.join(process.cwd(), dir);
    
    try {
      await fs.promises.access(dirPath);
    } catch (error) {
      try {
        await fs.promises.mkdir(dirPath, { recursive: true });
        log.info(`Created directory: ${dirPath}`);
      } catch (mkdirError) {
        log.error(`Failed to create directory ${dirPath}`, mkdirError);
      }
    }
  }
}

// Ensure a directory exists
export async function ensureDir(dirPath: string): Promise<boolean> {
  try {
    await fs.promises.access(dirPath);
    return true;
  } catch {
    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
      return true;
    } catch (error) {
      log.error(`Failed to create directory ${dirPath}`, error);
      return false;
    }
  }
}

// Clean up old files in a directory
export async function cleanupOldFiles(dirPath: string, maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  try {
    const files = await fs.promises.readdir(dirPath);
    const now = Date.now();
    
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = await fs.promises.stat(filePath);
      
      if (now - stats.mtime.getTime() > maxAge) {
        await fs.promises.unlink(filePath);
        log.debug(`Cleaned up old file: ${filePath}`);
      }
    }
  } catch (error) {
    log.error(`Failed to cleanup directory ${dirPath}`, error);
  }
}

// Get directory size
export async function getDirectorySize(dirPath: string): Promise<number> {
  try {
    const files = await fs.promises.readdir(dirPath);
    let totalSize = 0;
    
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = await fs.promises.stat(filePath);
      
      if (stats.isDirectory()) {
        totalSize += await getDirectorySize(filePath);
      } else {
        totalSize += stats.size;
      }
    }
    
    return totalSize;
  } catch (error) {
    log.error(`Failed to get directory size for ${dirPath}`, error);
    return 0;
  }
}

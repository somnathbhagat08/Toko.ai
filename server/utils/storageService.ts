import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { log } from '../vite.js';
import { getUploadConfig } from './config.js';
import { ensureDir, getDirectorySize } from './fileSystem.js';

export interface FileMetadata {
  id: string;
  originalName: string;
  filename: string;
  mimetype: string;
  size: number;
  path: string;
  url: string;
  uploadedBy?: string;
  uploadedAt: Date;
  expiresAt?: Date;
  downloads: number;
  isPublic: boolean;
  checksum: string;
}

export interface UploadOptions {
  maxSize?: number;
  allowedTypes?: string[];
  isPublic?: boolean;
  expiresIn?: number; // seconds
  generateThumbnail?: boolean;
  uploadedBy?: string;
}

export interface FileUploadResult {
  success: boolean;
  file?: FileMetadata;
  error?: string;
}

class StorageService {
  private files = new Map<string, FileMetadata>();
  private config = getUploadConfig();
  private readonly uploadsDir: string;
  private readonly tempDir: string;
  private readonly publicDir: string;

  constructor() {
    this.uploadsDir = path.resolve(this.config.storagePath);
    this.tempDir = path.join(this.uploadsDir, 'temp');
    this.publicDir = path.join(this.uploadsDir, 'public');
    
    this.initializeDirectories();
    this.startCleanupTasks();
    this.loadFileMetadata();
  }

  private async initializeDirectories(): Promise<void> {
    try {
      await ensureDir(this.uploadsDir);
      await ensureDir(this.tempDir);
      await ensureDir(this.publicDir);
      await ensureDir(path.join(this.uploadsDir, 'private'));
      await ensureDir(path.join(this.uploadsDir, 'thumbnails'));
      
      log('Storage directories initialized', 'storage');
    } catch (error) {
      log(`Failed to initialize storage directories: ${error}`, 'storage');
    }
  }

  // Upload file from buffer or stream
  async uploadFile(
    fileData: Buffer,
    originalName: string,
    mimetype: string,
    options: UploadOptions = {}
  ): Promise<FileUploadResult> {
    try {
      // Validate file
      const validation = this.validateFile(fileData, mimetype, options);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Generate file metadata
      const fileId = this.generateFileId();
      const extension = path.extname(originalName);
      const filename = `${fileId}${extension}`;
      const isPublic = options.isPublic || false;
      const subDir = isPublic ? 'public' : 'private';
      const filePath = path.join(this.uploadsDir, subDir, filename);
      const checksum = crypto.createHash('sha256').update(fileData).digest('hex');

      // Write file to disk
      await fs.promises.writeFile(filePath, fileData);

      // Create metadata
      const metadata: FileMetadata = {
        id: fileId,
        originalName,
        filename,
        mimetype,
        size: fileData.length,
        path: filePath,
        url: this.generateFileUrl(filename, isPublic),
        uploadedBy: options.uploadedBy,
        uploadedAt: new Date(),
        expiresAt: options.expiresIn ? new Date(Date.now() + options.expiresIn * 1000) : undefined,
        downloads: 0,
        isPublic,
        checksum
      };

      // Generate thumbnail if requested and supported
      if (options.generateThumbnail && this.isImageType(mimetype)) {
        await this.generateThumbnail(filePath, fileId);
      }

      // Store metadata
      this.files.set(fileId, metadata);
      await this.saveFileMetadata(metadata);

      log(`File uploaded: ${originalName} (${fileId})`, 'storage');

      return { success: true, file: metadata };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`File upload failed: ${errorMessage}`, 'storage');
      return { success: false, error: errorMessage };
    }
  }

  // Upload file from form data
  async uploadFormFile(
    file: Express.Multer.File,
    options: UploadOptions = {}
  ): Promise<FileUploadResult> {
    const fileData = fs.readFileSync(file.path);
    
    // Clean up temp file
    try {
      fs.unlinkSync(file.path);
    } catch (error) {
      log(`Failed to clean up temp file: ${error}`, 'storage');
    }

    return this.uploadFile(fileData, file.originalname, file.mimetype, options);
  }

  // Get file metadata
  getFile(fileId: string): FileMetadata | null {
    return this.files.get(fileId) || null;
  }

  // Get file stream
  getFileStream(fileId: string): fs.ReadStream | null {
    const file = this.files.get(fileId);
    if (!file || !fs.existsSync(file.path)) {
      return null;
    }

    // Check if file is expired
    if (file.expiresAt && file.expiresAt < new Date()) {
      this.deleteFile(fileId);
      return null;
    }

    // Increment download counter
    file.downloads++;
    this.files.set(fileId, file);
    this.saveFileMetadata(file);

    return fs.createReadStream(file.path);
  }

  // Get file buffer
  async getFileBuffer(fileId: string): Promise<Buffer | null> {
    const file = this.files.get(fileId);
    if (!file || !fs.existsSync(file.path)) {
      return null;
    }

    // Check if file is expired
    if (file.expiresAt && file.expiresAt < new Date()) {
      await this.deleteFile(fileId);
      return null;
    }

    try {
      const buffer = await fs.promises.readFile(file.path);
      
      // Increment download counter
      file.downloads++;
      this.files.set(fileId, file);
      await this.saveFileMetadata(file);

      return buffer;
    } catch (error) {
      log(`Failed to read file ${fileId}: ${error}`, 'storage');
      return null;
    }
  }

  // Delete file
  async deleteFile(fileId: string): Promise<boolean> {
    const file = this.files.get(fileId);
    if (!file) return false;

    try {
      // Delete main file
      if (fs.existsSync(file.path)) {
        await fs.promises.unlink(file.path);
      }

      // Delete thumbnail if exists
      const thumbnailPath = this.getThumbnailPath(fileId);
      if (fs.existsSync(thumbnailPath)) {
        await fs.promises.unlink(thumbnailPath);
      }

      // Remove metadata
      this.files.delete(fileId);
      await this.deleteFileMetadata(fileId);

      log(`File deleted: ${fileId}`, 'storage');
      return true;
    } catch (error) {
      log(`Failed to delete file ${fileId}: ${error}`, 'storage');
      return false;
    }
  }

  // Get file URL
  getFileUrl(fileId: string): string | null {
    const file = this.files.get(fileId);
    return file ? file.url : null;
  }

  // Get thumbnail URL
  getThumbnailUrl(fileId: string): string | null {
    const thumbnailPath = this.getThumbnailPath(fileId);
    if (fs.existsSync(thumbnailPath)) {
      return `/api/files/${fileId}/thumbnail`;
    }
    return null;
  }

  // List files with pagination
  listFiles(
    page: number = 1,
    limit: number = 20,
    filters: {
      uploadedBy?: string;
      mimetype?: string;
      isPublic?: boolean;
    } = {}
  ): { files: FileMetadata[]; total: number; page: number; limit: number } {
    let filteredFiles = Array.from(this.files.values());

    // Apply filters
    if (filters.uploadedBy) {
      filteredFiles = filteredFiles.filter(f => f.uploadedBy === filters.uploadedBy);
    }
    if (filters.mimetype) {
      filteredFiles = filteredFiles.filter(f => f.mimetype === filters.mimetype);
    }
    if (filters.isPublic !== undefined) {
      filteredFiles = filteredFiles.filter(f => f.isPublic === filters.isPublic);
    }

    // Sort by upload date (newest first)
    filteredFiles.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());

    // Paginate
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedFiles = filteredFiles.slice(startIndex, endIndex);

    return {
      files: paginatedFiles,
      total: filteredFiles.length,
      page,
      limit
    };
  }

  // Get storage statistics
  async getStats() {
    const totalFiles = this.files.size;
    const totalSize = Array.from(this.files.values())
      .reduce((sum, file) => sum + file.size, 0);
    
    const publicFiles = Array.from(this.files.values())
      .filter(f => f.isPublic).length;
    
    const expiredFiles = Array.from(this.files.values())
      .filter(f => f.expiresAt && f.expiresAt < new Date()).length;

    const diskUsage = await getDirectorySize(this.uploadsDir);

    return {
      files: {
        total: totalFiles,
        public: publicFiles,
        private: totalFiles - publicFiles,
        expired: expiredFiles
      },
      storage: {
        totalSize: totalSize,
        diskUsage: diskUsage,
        efficiency: diskUsage > 0 ? (totalSize / diskUsage) * 100 : 0
      },
      uploads: {
        today: this.getUploadsInPeriod(24 * 60 * 60 * 1000),
        thisWeek: this.getUploadsInPeriod(7 * 24 * 60 * 60 * 1000),
        thisMonth: this.getUploadsInPeriod(30 * 24 * 60 * 60 * 1000)
      }
    };
  }

  // Cleanup expired files
  async cleanupExpiredFiles(): Promise<number> {
    const now = new Date();
    let cleaned = 0;

    for (const [fileId, file] of this.files.entries()) {
      if (file.expiresAt && file.expiresAt < now) {
        await this.deleteFile(fileId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log(`Cleaned up ${cleaned} expired files`, 'storage');
    }

    return cleaned;
  }

  // Validate file
  private validateFile(
    fileData: Buffer,
    mimetype: string,
    options: UploadOptions
  ): { valid: boolean; error?: string } {
    const maxSize = options.maxSize || this.config.maxFileSize;
    const allowedTypes = options.allowedTypes || this.config.allowedTypes;

    if (fileData.length > maxSize) {
      return {
        valid: false,
        error: `File size exceeds maximum allowed size of ${maxSize} bytes`
      };
    }

    if (!allowedTypes.includes(mimetype)) {
      return {
        valid: false,
        error: `File type ${mimetype} is not allowed`
      };
    }

    return { valid: true };
  }

  // Generate file ID
  private generateFileId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  // Generate file URL
  private generateFileUrl(filename: string, isPublic: boolean): string {
    const baseUrl = process.env.APP_URL || 'http://localhost:5000';
    const path = isPublic ? 'public' : 'private';
    return `${baseUrl}/api/files/${path}/${filename}`;
  }

  // Check if file type is image
  private isImageType(mimetype: string): boolean {
    return mimetype.startsWith('image/');
  }

  // Generate thumbnail (placeholder - would need sharp or similar)
  private async generateThumbnail(filePath: string, fileId: string): Promise<void> {
    try {
      // This is a placeholder - in a real implementation you'd use sharp or similar
      const thumbnailPath = this.getThumbnailPath(fileId);
      await fs.promises.copyFile(filePath, thumbnailPath);
      log(`Thumbnail generated for ${fileId}`, 'storage');
    } catch (error) {
      log(`Failed to generate thumbnail for ${fileId}: ${error}`, 'storage');
    }
  }

  // Get thumbnail path
  private getThumbnailPath(fileId: string): string {
    return path.join(this.uploadsDir, 'thumbnails', `${fileId}.jpg`);
  }

  // Get uploads in time period
  private getUploadsInPeriod(milliseconds: number): number {
    const cutoff = new Date(Date.now() - milliseconds);
    return Array.from(this.files.values())
      .filter(f => f.uploadedAt > cutoff).length;
  }

  // File metadata persistence
  private async saveFileMetadata(metadata: FileMetadata): Promise<void> {
    const metadataPath = path.join(this.uploadsDir, 'metadata', `${metadata.id}.json`);
    try {
      await ensureDir(path.dirname(metadataPath));
      await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (error) {
      log(`Failed to save metadata for ${metadata.id}: ${error}`, 'storage');
    }
  }

  private async deleteFileMetadata(fileId: string): Promise<void> {
    const metadataPath = path.join(this.uploadsDir, 'metadata', `${fileId}.json`);
    try {
      if (fs.existsSync(metadataPath)) {
        await fs.promises.unlink(metadataPath);
      }
    } catch (error) {
      log(`Failed to delete metadata for ${fileId}: ${error}`, 'storage');
    }
  }

  private async loadFileMetadata(): Promise<void> {
    const metadataDir = path.join(this.uploadsDir, 'metadata');
    
    try {
      if (!fs.existsSync(metadataDir)) return;

      const files = await fs.promises.readdir(metadataDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const metadataPath = path.join(metadataDir, file);
          const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8'));
          this.files.set(metadata.id, {
            ...metadata,
            uploadedAt: new Date(metadata.uploadedAt),
            expiresAt: metadata.expiresAt ? new Date(metadata.expiresAt) : undefined
          });
        }
      }

      log(`Loaded metadata for ${this.files.size} files`, 'storage');
    } catch (error) {
      log(`Failed to load file metadata: ${error}`, 'storage');
    }
  }

  // Cleanup tasks
  private startCleanupTasks(): void {
    // Clean up expired files every hour
    setInterval(() => {
      this.cleanupExpiredFiles();
    }, 60 * 60 * 1000);
  }

  // Shutdown
  async shutdown(): Promise<void> {
    log('Storage service shutdown', 'storage');
  }

  /**
   * Store file (alias for uploadFormFile)
   */
  async storeFile(file: Express.Multer.File, options: {
    type: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<{ url: string; fileId: string }> {
    const result = await this.uploadFormFile(file, options.type, options.userId, options.metadata);
    return {
      url: result.url,
      fileId: result.fileId
    };
  }
}

// Create singleton instance
export const storageService = new StorageService();

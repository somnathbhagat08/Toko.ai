import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { ValidationError } from './errorHandler.js';

// Enhanced validation schemas
export const schemas = {
  // Authentication schemas
  auth: {
    register: z.object({
      email: z.string()
        .email('Invalid email format')
        .min(5, 'Email must be at least 5 characters')
        .max(255, 'Email must not exceed 255 characters')
        .toLowerCase()
        .trim(),
      password: z.string()
        .min(8, 'Password must be at least 8 characters')
        .max(128, 'Password must not exceed 128 characters')
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one lowercase letter, one uppercase letter, and one number'),
      name: z.string()
        .min(2, 'Name must be at least 2 characters')
        .max(50, 'Name must not exceed 50 characters')
        .trim(),
      avatar: z.string().url('Invalid avatar URL').optional(),
      provider: z.string().optional()
    }),
    
    login: z.object({
      email: z.string()
        .email('Invalid email format')
        .toLowerCase()
        .trim(),
      password: z.string()
        .min(1, 'Password is required'),
      deviceInfo: z.string().optional(),
      ipAddress: z.string().optional()
    }),
    
    changePassword: z.object({
      currentPassword: z.string().min(1, 'Current password is required'),
      newPassword: z.string()
        .min(8, 'Password must be at least 8 characters')
        .max(128, 'Password must not exceed 128 characters')
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one lowercase letter, one uppercase letter, and one number')
    })
  },

  // User management schemas
  users: {
    getUser: z.object({
      userId: z.string().uuid('Invalid user ID format')
    }),
    updateProfile: z.object({
      username: z.string()
        .min(3, 'Username must be at least 3 characters')
        .max(30, 'Username must not exceed 30 characters')
        .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores')
        .optional(),
      avatar: z.string().url('Invalid avatar URL').optional(),
      country: z.string()
        .min(2, 'Country must be at least 2 characters')
        .max(50, 'Country must not exceed 50 characters')
        .optional(),
      tags: z.array(z.string().min(1).max(30))
        .max(10, 'Maximum 10 tags allowed')
        .optional()
    })
  },

  // Matchmaking schemas
  matchmaking: {
    join: z.object({
      userId: z.string().uuid('Invalid user ID format'),
      preferences: z.object({
        country: z.string().optional(),
        tags: z.array(z.string()).optional(),
        ageRange: z.object({
          min: z.number().min(13).max(100),
          max: z.number().min(13).max(100)
        }).optional()
      }).optional()
    }),
    leave: z.object({
      userId: z.string().uuid('Invalid user ID format')
    })
  },

  // Upload schemas
  upload: {
    avatar: z.object({
      userId: z.string().uuid('Invalid user ID format')
    })
  },

  // WebRTC schemas
  webrtc: {
    offer: z.object({
      roomId: z.string().min(1, 'Room ID is required'),
      offer: z.object({
        type: z.literal('offer'),
        sdp: z.string().min(1, 'SDP is required')
      }),
      fromUserId: z.string().uuid('Invalid user ID format')
    }),
    answer: z.object({
      roomId: z.string().min(1, 'Room ID is required'),
      answer: z.object({
        type: z.literal('answer'),
        sdp: z.string().min(1, 'SDP is required')
      }),
      fromUserId: z.string().uuid('Invalid user ID format')
    }),
    iceCandidate: z.object({
      roomId: z.string().min(1, 'Room ID is required'),
      candidate: z.object({
        candidate: z.string(),
        sdpMLineIndex: z.number(),
        sdpMid: z.string()
      }),
      fromUserId: z.string().uuid('Invalid user ID format')
    })
  },

  // Legacy schemas for backward compatibility
  userRegistration: z.object({
    email: z.string()
      .email('Invalid email format')
      .min(5, 'Email must be at least 5 characters')
      .max(255, 'Email must not exceed 255 characters')
      .toLowerCase()
      .trim(),
    password: z.string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must not exceed 128 characters')
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one lowercase letter, one uppercase letter, and one number'),
    name: z.string()
      .min(2, 'Name must be at least 2 characters')
      .max(50, 'Name must not exceed 50 characters')
      .regex(/^[a-zA-Z\s]+$/, 'Name can only contain letters and spaces')
      .trim(),
    avatar: z.string().url('Invalid avatar URL').optional(),
    country: z.string()
      .min(2, 'Country must be at least 2 characters')
      .max(50, 'Country must not exceed 50 characters')
      .default('Any on Earth'),
    tags: z.array(z.string().min(1).max(30))
      .max(10, 'Maximum 10 tags allowed')
      .default([])
  }),

  // User login schema
  userLogin: z.object({
    email: z.string()
      .email('Invalid email format')
      .toLowerCase()
      .trim(),
    password: z.string()
      .min(1, 'Password is required')
  }),

  // Profile update schema
  profileUpdate: z.object({
    name: z.string()
      .min(2, 'Name must be at least 2 characters')
      .max(50, 'Name must not exceed 50 characters')
      .regex(/^[a-zA-Z\s]+$/, 'Name can only contain letters and spaces')
      .trim()
      .optional(),
    avatar: z.string().url('Invalid avatar URL').optional(),
    country: z.string()
      .min(2, 'Country must be at least 2 characters')
      .max(50, 'Country must not exceed 50 characters')
      .optional(),
    tags: z.array(z.string().min(1).max(30))
      .max(10, 'Maximum 10 tags allowed')
      .optional()
  }),

  // Matchmaking request schema
  matchmakingRequest: z.object({
    interests: z.array(z.string().min(1).max(30))
      .max(10, 'Maximum 10 interests allowed')
      .default([]),
    gender: z.enum(['male', 'female', 'other']).optional(),
    genderPreference: z.enum(['male', 'female', 'any']).default('any'),
    countryPreference: z.string().max(50).optional(),
    chatMode: z.enum(['text', 'video']).default('text'),
    ageRange: z.tuple([
      z.number().min(13).max(100),
      z.number().min(13).max(100)
    ]).optional(),
    language: z.string().max(10).optional()
  }),

  // Message schema
  message: z.object({
    roomId: z.string()
      .min(1, 'Room ID is required')
      .max(100, 'Room ID too long'),
    message: z.string()
      .min(1, 'Message cannot be empty')
      .max(1000, 'Message too long')
      .trim(),
    userId: z.string()
      .min(1, 'User ID is required')
  }),

  // Report user schema
  reportUser: z.object({
    reportedUserId: z.string().min(1, 'Reported user ID is required'),
    reporterUserId: z.string().min(1, 'Reporter user ID is required'),
    reason: z.enum([
      'inappropriate_content',
      'harassment',
      'spam',
      'fake_profile',
      'underage',
      'other'
    ]),
    description: z.string()
      .max(500, 'Description too long')
      .optional(),
    evidence: z.array(z.string().url())
      .max(5, 'Maximum 5 evidence URLs allowed')
      .optional()
  }),

  // LiveKit token request schema
  livekitTokenRequest: z.object({
    roomId: z.string()
      .min(1, 'Room ID is required')
      .max(100, 'Room ID too long'),
    userId: z.string()
      .min(1, 'User ID is required'),
    name: z.string()
      .max(50, 'Name too long')
      .optional()
  }),

  // Query parameters schemas
  paginationQuery: z.object({
    page: z.string()
      .regex(/^\d+$/, 'Page must be a number')
      .transform(val => parseInt(val))
      .refine(val => val > 0, 'Page must be greater than 0')
      .default('1'),
    limit: z.string()
      .regex(/^\d+$/, 'Limit must be a number')
      .transform(val => parseInt(val))
      .refine(val => val > 0 && val <= 100, 'Limit must be between 1 and 100')
      .default('10')
  }),

  // Search query schema
  searchQuery: z.object({
    q: z.string()
      .min(1, 'Search query is required')
      .max(100, 'Search query too long')
      .trim(),
    tags: z.string()
      .optional()
      .transform(val => val ? val.split(',').map(tag => tag.trim()) : []),
    country: z.string().max(50).optional()
  })
};

// Validation middleware factory
export const validate = (schema: z.ZodSchema, source: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = source === 'body' ? req.body : 
                   source === 'query' ? req.query : req.params;
      
      const validatedData = schema.parse(data);
      
      // Replace the source data with validated data
      if (source === 'body') {
        req.body = validatedData;
      } else if (source === 'query') {
        req.query = validatedData;
      } else {
        req.params = validatedData;
      }
      
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const message = error.errors
          .map((err: any) => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        next(new ValidationError(`Validation failed: ${message}`));
      } else {
        next(error);
      }
    }
  };
};

// Direct validation function for service layer
export const validateData = <T>(schema: z.ZodSchema<T>, data: unknown): T => {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = error.errors
        .map((err: any) => `${err.path.join('.')}: ${err.message}`)
        .join(', ');
      throw new ValidationError(`Validation failed: ${message}`);
    }
    throw error;
  }
};

// Conditional validation (only validate if field exists)
export const validateOptional = (schema: z.ZodSchema, source: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = source === 'body' ? req.body : 
                   source === 'query' ? req.query : req.params;
      
      if (data && Object.keys(data).length > 0) {
        const validatedData = schema.parse(data);
        
        if (source === 'body') {
          req.body = validatedData;
        } else if (source === 'query') {
          req.query = validatedData;
        } else {
          req.params = validatedData;
        }
      }
      
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const message = error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        next(new ValidationError(`Validation failed: ${message}`));
      } else {
        next(error);
      }
    }
  };
};

// File upload validation
export const validateFile = (options: {
  maxSize?: number;
  allowedTypes?: string[];
  required?: boolean;
} = {}) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { maxSize = 5 * 1024 * 1024, allowedTypes = ['image/jpeg', 'image/png', 'image/gif'], required = false } = options;
    
    if (!req.file && required) {
      return next(new ValidationError('File is required'));
    }
    
    if (req.file) {
      // Check file size
      if (req.file.size > maxSize) {
        return next(new ValidationError(`File too large. Maximum size: ${maxSize / 1024 / 1024}MB`));
      }
      
      // Check file type
      if (!allowedTypes.includes(req.file.mimetype)) {
        return next(new ValidationError(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`));
      }
    }
    
    next();
  };
};

// Sanitize HTML content
export const sanitizeHtml = (content: string): string => {
  return content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
};

// Custom validation decorators
export const customValidations = {
  // Validate password strength
  passwordStrength: (password: string): boolean => {
    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    const isLongEnough = password.length >= 8;
    
    return hasLower && hasUpper && hasNumber && isLongEnough;
  },

  // Validate username format
  usernameFormat: (username: string): boolean => {
    return /^[a-zA-Z0-9_-]{3,20}$/.test(username);
  },

  // Validate age
  validAge: (age: number): boolean => {
    return age >= 13 && age <= 120;
  },

  // Validate country code
  countryCode: (code: string): boolean => {
    const validCodes = ['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'ES', 'IT', 'JP', 'KR', 'IN', 'BR', 'MX', 'Other'];
    return validCodes.includes(code);
  }
};

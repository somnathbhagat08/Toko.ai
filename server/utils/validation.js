import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';
import { log } from './logger.js';

/**
 * Validation schemas for different parts of the application
 */
export const schemas = {
  auth: {
    register: z.object({
      email: z.string().email('Please enter a valid email address'),
      password: z.string().min(6, 'Password must be at least 6 characters'),
      name: z.string().min(2, 'Name must be at least 2 characters'),
      avatar: z.string().optional(),
      provider: z.string().optional().default('local'),
      country: z.string().optional(),
      tags: z.array(z.string()).optional()
    }),
    login: z.object({
      email: z.string().email('Please enter a valid email address'),
      password: z.string().min(1, 'Password is required')
    }),
    refreshToken: z.object({
      refreshToken: z.string().min(1, 'Refresh token is required')
    })
  },
  matchmaking: {
    join: z.object({
      userId: z.number().int().positive('User ID must be a positive integer'),
      preferences: z.object({
        country: z.string().optional(),
        tags: z.array(z.string()).optional()
      }).optional()
    })
  },
  user: {
    update: z.object({
      name: z.string().min(2, 'Name must be at least 2 characters').optional(),
      avatar: z.string().optional(),
      country: z.string().optional(),
      tags: z.array(z.string()).optional()
    })
  }
};

/**
 * Validate data against a schema
 * @param {any} data - Data to validate
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @returns {any} - Validated data
 * @throws {ValidationError} - If validation fails
 */
export function validate(data, schema) {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const validationError = fromZodError(error);
      log.warn('Validation error', { 
        error: validationError.message, 
        path: error.errors[0]?.path?.join('.') 
      });
      throw new Error(validationError.message);
    }
    throw error;
  }
}

/**
 * Middleware to validate request body
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @returns {function} - Express middleware
 */
export function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.body = validate(req.body, schema);
      next();
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };
}

export default {
  schemas,
  validate,
  validateBody
};

/**
 * Express middleware for the Relay application
 */

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/errors.js';
import { randomUUID } from 'crypto';

/**
 * Generate unique request ID for tracking
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  req.id = randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
}

/**
 * Global error handling middleware
 * Catches AppError subclasses and returns ErrorResponse JSON format per API contract
 */
export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      ...(err.details && { details: err.details }),
    });
  } else {
    // Unexpected errors
    console.error('Unexpected error:', err);
    res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    });
  }
}

/**
 * Async route handler wrapper to catch promise rejections
 */
export function asyncHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Augment Express Request type with id property
declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

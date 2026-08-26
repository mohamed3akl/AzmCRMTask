import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { HttpError } from '../lib/httpError';

export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues.map((e) => e.message).join(', ');
      next(new HttpError(400, 'VALIDATION_ERROR', message));
      return;
    }
    req.body = result.data;
    next();
  };
}

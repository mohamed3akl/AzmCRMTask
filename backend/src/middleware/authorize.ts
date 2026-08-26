import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { HttpError } from '../lib/httpError';

export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new HttpError(403, 'FORBIDDEN', 'Insufficient permissions'));
      return;
    }
    next();
  };
}

import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/httpError';

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(new HttpError(401, 'UNAUTHENTICATED', 'Missing bearer token'));
    return;
  }

  const token = header.slice('Bearer '.length);
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    next(new HttpError(401, 'UNAUTHENTICATED', 'Invalid or expired token'));
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) {
    next(new HttpError(401, 'UNAUTHENTICATED', 'User not found or inactive'));
    return;
  }

  req.user = { id: user.id, role: user.role, departmentId: user.departmentId };
  next();
}

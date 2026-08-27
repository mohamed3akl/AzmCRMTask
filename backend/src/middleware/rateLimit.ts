import rateLimit from 'express-rate-limit';
import { HttpError } from '../lib/httpError';

export function createRateLimiter(options: { windowMs: number; max: number }) {
  return rateLimit({
    windowMs: options.windowMs,
    // Both keys are set because express-rate-limit renamed `max` to `limit`
    // in v7 (keeping `max` as a backward-compatible alias at time of
    // writing) — since this project doesn't pin an exact version for this
    // dependency, setting both is cheap insurance against whichever name
    // the installed major version actually reads.
    max: options.max,
    limit: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.'));
    },
  });
}

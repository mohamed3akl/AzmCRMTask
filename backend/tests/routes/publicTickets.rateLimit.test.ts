import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { validate } from '../../src/middleware/validate';
import { createRateLimiter } from '../../src/middleware/rateLimit';
import { createPublicTicketHandler } from '../../src/controllers/publicTickets.controller';
import { errorHandler } from '../../src/middleware/errorHandler';

describe('POST /api/public/tickets rate limiting', () => {
  it('returns 429 after exceeding the rate limit', async () => {
    // Create a minimal app with a low rate limit specifically for testing rate limiting
    const testApp = express();
    testApp.use(cors());
    testApp.use(express.json());

    const createPublicTicketSchema = z
      .object({
        fullName: z.string().min(1).max(200),
        email: z.string().email().optional(),
        phone: z.string().min(1).max(30).optional(),
        subject: z.string().min(1).max(200),
        description: z.string().min(1).max(5000),
      })
      .refine((data) => Boolean(data.email) || Boolean(data.phone), {
        message: 'Provide at least one of email or phone',
      });

    const testRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
    testApp.use('/api/public/tickets', testRateLimiter);
    testApp.post('/api/public/tickets', validate(createPublicTicketSchema), createPublicTicketHandler);
    testApp.use(errorHandler);

    for (let i = 0; i < 5; i += 1) {
      const res = await request(testApp)
        .post('/api/public/tickets')
        .send({
          fullName: `Requester ${i}`,
          email: `requester${i}@example.com`,
          subject: 'Test',
          description: 'Test',
        });
      expect(res.status).toBe(201);
    }

    const limitedRes = await request(testApp).post('/api/public/tickets').send({
      fullName: 'One Too Many',
      email: 'toomany@example.com',
      subject: 'Test',
      description: 'Test',
    });

    expect(limitedRes.status).toBe(429);
    expect(limitedRes.body.error.code).toBe('RATE_LIMITED');
  });
});

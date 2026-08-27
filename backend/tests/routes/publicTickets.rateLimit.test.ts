import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';

const app = createApp();

describe('POST /api/public/tickets rate limiting', () => {
  it('returns 429 after exceeding the rate limit', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post('/api/public/tickets')
        .send({
          fullName: `Requester ${i}`,
          email: `requester${i}@example.com`,
          subject: 'Test',
          description: 'Test',
        });
      expect(res.status).toBe(201);
    }

    const limitedRes = await request(app).post('/api/public/tickets').send({
      fullName: 'One Too Many',
      email: 'toomany@example.com',
      subject: 'Test',
      description: 'Test',
    });

    expect(limitedRes.status).toBe(429);
    expect(limitedRes.body.error.code).toBe('RATE_LIMITED');
  });
});

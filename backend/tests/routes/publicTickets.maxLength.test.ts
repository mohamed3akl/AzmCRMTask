import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';

// This file uses its own createApp() instance so its requests don't share
// a rate-limit budget with publicTickets.test.ts (the endpoint's rate
// limiter allows only 5 requests per 15 minutes per IP, and this file
// makes 4 requests).
const app = createApp();

describe('POST /api/public/tickets field length limits', () => {
  it('rejects a fullName longer than 200 characters', async () => {
    const res = await request(app)
      .post('/api/public/tickets')
      .send({
        fullName: 'a'.repeat(201),
        email: 'toolongname@example.com',
        subject: 'Test',
        description: 'Test',
      });
    expect(res.status).toBe(400);
  });

  it('rejects a subject longer than 200 characters', async () => {
    const res = await request(app)
      .post('/api/public/tickets')
      .send({
        fullName: 'Long Subject',
        email: 'longsubject@example.com',
        subject: 'a'.repeat(201),
        description: 'Test',
      });
    expect(res.status).toBe(400);
  });

  it('rejects a description longer than 5000 characters', async () => {
    const res = await request(app)
      .post('/api/public/tickets')
      .send({
        fullName: 'Long Description',
        email: 'longdescription@example.com',
        subject: 'Test',
        description: 'a'.repeat(5001),
      });
    expect(res.status).toBe(400);
  });

  it('rejects a phone longer than 30 characters', async () => {
    const res = await request(app)
      .post('/api/public/tickets')
      .send({
        fullName: 'Long Phone',
        phone: '1'.repeat(31),
        subject: 'Test',
        description: 'Test',
      });
    expect(res.status).toBe(400);
  });
});

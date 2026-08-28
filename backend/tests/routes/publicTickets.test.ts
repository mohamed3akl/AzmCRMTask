import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';

// The public ticket endpoint enforces a real rate limit of 5 requests per 15
// minutes (see publicTickets.routes.ts), and that limiter is a module-level
// singleton tied to whichever Express app instance imported it. This file
// posts to the endpoint from six separate tests; sharing one `app` (and thus
// one limiter) across all of them would let earlier tests' requests count
// against later ones and trip the real limit once a sixth request is sent.
// Get a fresh module graph (and therefore a fresh, untouched rate limiter)
// before every test, the same way tests/setup.ts resets shared Postgres
// state between tests, so each test's request is evaluated independently.
let app: Express;

beforeEach(async () => {
  vi.resetModules();
  const { createApp } = await import('../../src/app');
  app = createApp();
});

describe('POST /api/public/tickets', () => {
  it('creates a customer and ticket from an email submission, with no auth required', async () => {
    const res = await request(app).post('/api/public/tickets').send({
      fullName: 'Jane Customer',
      email: 'jane@example.com',
      subject: 'Cannot log in',
      description: 'Getting an error on login',
    });

    expect(res.status).toBe(201);
    expect(res.body.reference).toEqual(expect.any(String));
    expect(res.body.reference).toHaveLength(8);

    const customer = await prisma.customer.findFirst({ where: { email: 'jane@example.com' } });
    expect(customer?.fullName).toBe('Jane Customer');

    const ticket = await prisma.ticket.findFirst({ where: { subject: 'Cannot log in' } });
    expect(ticket?.source).toBe('WEB_FORM');
    expect(ticket?.createdById).toBeNull();
    expect(ticket?.customerId).toBe(customer?.id);
  });

  it('creates a ticket from a phone-only submission', async () => {
    const res = await request(app).post('/api/public/tickets').send({
      fullName: 'Bob Customer',
      phone: '555-0100',
      subject: 'Billing question',
      description: 'Why was I charged twice?',
    });

    expect(res.status).toBe(201);
    const customer = await prisma.customer.findFirst({ where: { phone: '555-0100' } });
    expect(customer?.fullName).toBe('Bob Customer');
  });

  it('rejects a submission with neither email nor phone', async () => {
    const res = await request(app).post('/api/public/tickets').send({
      fullName: 'No Contact',
      subject: 'Test',
      description: 'Test',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a submission missing subject and description', async () => {
    const res = await request(app).post('/api/public/tickets').send({
      fullName: 'Missing Fields',
      email: 'missing@example.com',
    });
    expect(res.status).toBe(400);
  });

  it('auto-assigns a ticket created via the public web form', async () => {
    const orgAgent = await prisma.user.create({
      data: {
        email: 'web-org-agent@example.com',
        passwordHash: await hashPassword('password123'),
        fullName: 'Org Agent',
        role: 'AGENT',
      },
    });

    const res = await request(app).post('/api/public/tickets').send({
      fullName: 'Web Customer',
      email: 'web-customer@example.com',
      subject: 'Cannot log in',
      description: 'Getting an error',
    });

    expect(res.status).toBe(201);
    const ticket = await prisma.ticket.findFirst({ where: { subject: 'Cannot log in' } });
    expect(ticket?.assigneeId).toBe(orgAgent.id);
  });

  it('reuses an existing customer when the email matches', async () => {
    const existing = await prisma.customer.create({ data: { fullName: 'Existing Customer', email: 'jane@example.com' } });

    const res = await request(app).post('/api/public/tickets').send({
      fullName: 'Jane Typo',
      email: 'jane@example.com',
      subject: 'Cannot log in',
      description: 'Getting an error on login',
    });

    expect(res.status).toBe(201);
    const ticket = await prisma.ticket.findFirst({ where: { subject: 'Cannot log in' } });
    expect(ticket?.customerId).toBe(existing.id);
    expect(await prisma.customer.count()).toBe(1);
  });
});

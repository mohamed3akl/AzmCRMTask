import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';

const app = createApp();

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
});

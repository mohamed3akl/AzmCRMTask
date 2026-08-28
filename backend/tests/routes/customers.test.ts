import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';
import { signToken } from '../../src/lib/jwt';

const app = createApp();

async function createAgent() {
  const user = await prisma.user.create({
    data: {
      email: 'agent@example.com',
      passwordHash: await hashPassword('password123'),
      fullName: 'Agent User',
      role: 'AGENT',
    },
  });
  const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
  return { user, token };
}

describe('/api/customers', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/customers');
    expect(res.status).toBe(401);
  });

  it('searches customers by partial name match', async () => {
    const { token } = await createAgent();
    await prisma.customer.create({ data: { fullName: 'Jane Customer', email: 'jane@example.com' } });
    await prisma.customer.create({ data: { fullName: 'Bob Other', email: 'bob@example.com' } });

    const res = await request(app).get('/api/customers?query=jane').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].fullName).toBe('Jane Customer');
  });

  it('returns all customers when query is empty', async () => {
    const { token } = await createAgent();
    await prisma.customer.create({ data: { fullName: 'Jane Customer' } });
    const res = await request(app).get('/api/customers').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('GET /api/customers/:id', () => {
  it('returns the customer with their tickets newest-first', async () => {
    const { user, token } = await createAgent();
    const customer = await prisma.customer.create({ data: { fullName: 'Jane Customer', email: 'jane@example.com' } });
    await prisma.ticket.create({
      data: { subject: 'First ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });
    await prisma.ticket.create({
      data: { subject: 'Second ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app).get(`/api/customers/${customer.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('Jane Customer');
    expect(res.body.tickets).toHaveLength(2);
    expect(res.body.tickets[0].subject).toBe('Second ticket');
    expect(res.body.tickets[1].subject).toBe('First ticket');
  });

  it('returns 404 for a non-existent customer', async () => {
    const { token } = await createAgent();
    const res = await request(app)
      .get('/api/customers/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/customers', () => {
  it('creates a customer', async () => {
    const { token } = await createAgent();
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'New Customer', email: 'new@example.com', phone: '555-0100' });

    expect(res.status).toBe(201);
    expect(res.body.fullName).toBe('New Customer');
  });

  it('returns 409 with the existing customer id when the email already exists', async () => {
    const { token } = await createAgent();
    const existing = await prisma.customer.create({ data: { fullName: 'Existing', email: 'dup@example.com' } });

    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Another Name', email: 'dup@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CUSTOMER_EXISTS');
    expect(res.body.existingCustomerId).toBe(existing.id);
  });

  it('returns 409 when the phone already exists', async () => {
    const { token } = await createAgent();
    const existing = await prisma.customer.create({ data: { fullName: 'Existing', phone: '555-0199' } });

    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Another Name', phone: '555-0199' });

    expect(res.status).toBe(409);
    expect(res.body.existingCustomerId).toBe(existing.id);
  });
});

describe('PATCH /api/customers/:id', () => {
  it('updates a customer', async () => {
    const { token } = await createAgent();
    const customer = await prisma.customer.create({ data: { fullName: 'Old Name', email: 'old@example.com' } });

    const res = await request(app)
      .patch(`/api/customers/${customer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('New Name');
  });

  it('returns 409 when the submitted email collides with a different customer', async () => {
    const { token } = await createAgent();
    const other = await prisma.customer.create({ data: { fullName: 'Other', email: 'other@example.com' } });
    const customer = await prisma.customer.create({ data: { fullName: 'Mine', email: 'mine@example.com' } });

    const res = await request(app)
      .patch(`/api/customers/${customer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'other@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.existingCustomerId).toBe(other.id);
  });

  it("does not 409 when the submitted email matches the customer's own current value", async () => {
    const { token } = await createAgent();
    const customer = await prisma.customer.create({ data: { fullName: 'Mine', email: 'mine@example.com' } });

    const res = await request(app)
      .patch(`/api/customers/${customer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Mine Updated', email: 'mine@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('Mine Updated');
  });

  it('does not re-check an untouched field against historical duplicates', async () => {
    const { token } = await createAgent();
    // Two customers that already share an email from before dedup existed —
    // this plan does not clean up historical duplicates (Non-Goal). Editing
    // one's phone must not suddenly start failing because of the other.
    await prisma.customer.create({ data: { fullName: 'Historical Dup A', email: 'shared@example.com' } });
    const customer = await prisma.customer.create({ data: { fullName: 'Historical Dup B', email: 'shared@example.com' } });

    const res = await request(app)
      .patch(`/api/customers/${customer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '555-0177' });

    expect(res.status).toBe(200);
    expect(res.body.phone).toBe('555-0177');
  });

  it('returns 404 for a non-existent customer', async () => {
    const { token } = await createAgent();
    const res = await request(app)
      .patch('/api/customers/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'X' });
    expect(res.status).toBe(404);
  });
});

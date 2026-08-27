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

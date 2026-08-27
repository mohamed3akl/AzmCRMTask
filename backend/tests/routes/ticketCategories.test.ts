import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';
import { signToken } from '../../src/lib/jwt';

const app = createApp();

async function createAdmin() {
  const user = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      passwordHash: await hashPassword('password123'),
      fullName: 'Admin User',
      role: 'ADMIN',
    },
  });
  const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
  return { user, token };
}

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

describe('/api/ticket-categories', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/ticket-categories');
    expect(res.status).toBe(401);
  });

  it('lets an agent list ticket categories too', async () => {
    const { token } = await createAgent();
    const res = await request(app).get('/api/ticket-categories').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('rejects a non-admin creating a ticket category', async () => {
    const { token } = await createAgent();
    const res = await request(app)
      .post('/api/ticket-categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ nameEn: 'Billing', nameAr: 'الفواتير' });
    expect(res.status).toBe(403);
  });

  it('rejects a non-admin updating a ticket category', async () => {
    const { token } = await createAgent();
    const category = await prisma.ticketCategory.create({ data: { nameEn: 'Technical', nameAr: 'تقني' } });
    const res = await request(app)
      .patch(`/api/ticket-categories/${category.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nameEn: 'Nope' });
    expect(res.status).toBe(403);
  });

  it('creates and lists ticket categories', async () => {
    const { token } = await createAdmin();
    const createRes = await request(app)
      .post('/api/ticket-categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ nameEn: 'Billing', nameAr: 'الفواتير' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.nameEn).toBe('Billing');

    const listRes = await request(app).get('/api/ticket-categories').set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
  });

  it('updates a ticket category', async () => {
    const { token } = await createAdmin();
    const category = await prisma.ticketCategory.create({ data: { nameEn: 'Technical', nameAr: 'تقني' } });
    const res = await request(app)
      .patch(`/api/ticket-categories/${category.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nameEn: 'Technical Support' });
    expect(res.status).toBe(200);
    expect(res.body.nameEn).toBe('Technical Support');
  });

  it('rejects an update to a non-existent category', async () => {
    const { token } = await createAdmin();
    const res = await request(app)
      .patch('/api/ticket-categories/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ nameEn: 'Nope' });
    expect(res.status).toBe(404);
  });
});

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

describe('/api/quick-replies', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/quick-replies');
    expect(res.status).toBe(401);
  });

  it('lets any authenticated staff read quick replies', async () => {
    const { token } = await createAgent();
    await prisma.quickReply.create({
      data: {
        titleEn: 'Greeting',
        titleAr: 'ترحيب',
        bodyEn: 'Hello, thanks for reaching out!',
        bodyAr: 'مرحبًا، شكرًا لتواصلك معنا!',
      },
    });

    const res = await request(app).get('/api/quick-replies').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('rejects a non-admin creating a quick reply', async () => {
    const { token } = await createAgent();
    const res = await request(app)
      .post('/api/quick-replies')
      .set('Authorization', `Bearer ${token}`)
      .send({ titleEn: 'Greeting', titleAr: 'ترحيب', bodyEn: 'Hello', bodyAr: 'مرحبًا' });
    expect(res.status).toBe(403);
  });

  it('creates and lists quick replies for an admin', async () => {
    const { token } = await createAdmin();
    const createRes = await request(app)
      .post('/api/quick-replies')
      .set('Authorization', `Bearer ${token}`)
      .send({
        titleEn: 'Greeting',
        titleAr: 'ترحيب',
        bodyEn: 'Hello, thanks for reaching out!',
        bodyAr: 'مرحبًا، شكرًا لتواصلك معنا!',
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.titleEn).toBe('Greeting');

    const listRes = await request(app).get('/api/quick-replies').set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
  });

  it('updates a quick reply', async () => {
    const { token } = await createAdmin();
    const reply = await prisma.quickReply.create({
      data: { titleEn: 'Greeting', titleAr: 'ترحيب', bodyEn: 'Hello', bodyAr: 'مرحبًا' },
    });
    const res = await request(app)
      .patch(`/api/quick-replies/${reply.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ bodyEn: 'Hello there, thanks for reaching out!' });

    expect(res.status).toBe(200);
    expect(res.body.bodyEn).toBe('Hello there, thanks for reaching out!');
  });

  it('rejects an update to a non-existent quick reply', async () => {
    const { token } = await createAdmin();
    const res = await request(app)
      .patch('/api/quick-replies/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ titleEn: 'Nope' });
    expect(res.status).toBe(404);
  });
});

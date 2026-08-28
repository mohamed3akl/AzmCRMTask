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

async function seedTargets() {
  await prisma.slaTarget.createMany({
    data: [
      { priority: 'URGENT', responseMinutes: 15, resolutionMinutes: 120 },
      { priority: 'HIGH', responseMinutes: 60, resolutionMinutes: 480 },
      { priority: 'MEDIUM', responseMinutes: 240, resolutionMinutes: 1440 },
      { priority: 'LOW', responseMinutes: 480, resolutionMinutes: 4320 },
    ],
  });
}

describe('/api/sla-targets', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/sla-targets');
    expect(res.status).toBe(401);
  });

  it('lets any authenticated staff read all four seeded targets', async () => {
    const { token } = await createAgent();
    await seedTargets();

    const res = await request(app).get('/api/sla-targets').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    const urgent = res.body.find((t: { priority: string }) => t.priority === 'URGENT');
    expect(urgent.responseMinutes).toBe(15);
  });

  it('rejects a non-admin updating a target', async () => {
    const { token } = await createAgent();
    await seedTargets();

    const res = await request(app)
      .patch('/api/sla-targets/URGENT')
      .set('Authorization', `Bearer ${token}`)
      .send({ responseMinutes: 10 });
    expect(res.status).toBe(403);
  });

  it('lets an admin update a target', async () => {
    const { token } = await createAdmin();
    await seedTargets();

    const res = await request(app)
      .patch('/api/sla-targets/URGENT')
      .set('Authorization', `Bearer ${token}`)
      .send({ responseMinutes: 10, resolutionMinutes: 90 });

    expect(res.status).toBe(200);
    expect(res.body.responseMinutes).toBe(10);
    expect(res.body.resolutionMinutes).toBe(90);
  });

  it('rejects an invalid priority segment', async () => {
    const { token } = await createAdmin();
    await seedTargets();

    const res = await request(app)
      .patch('/api/sla-targets/BOGUS')
      .set('Authorization', `Bearer ${token}`)
      .send({ responseMinutes: 10 });
    expect(res.status).toBe(400);
  });

  it('rejects a non-positive minute value', async () => {
    const { token } = await createAdmin();
    await seedTargets();

    const res = await request(app)
      .patch('/api/sla-targets/URGENT')
      .set('Authorization', `Bearer ${token}`)
      .send({ responseMinutes: 0 });
    expect(res.status).toBe(400);
  });
});

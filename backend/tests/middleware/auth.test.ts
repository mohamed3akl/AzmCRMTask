import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../src/middleware/errorHandler';
import { authenticate } from '../../src/middleware/authenticate';
import { authorize } from '../../src/middleware/authorize';
import { signToken } from '../../src/lib/jwt';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.get('/protected', authenticate, authorize('ADMIN'), (req, res) => {
    res.json({ userId: req.user?.id });
  });
  app.use(errorHandler);
  return app;
}

async function createUser(overrides: Partial<{ role: 'AGENT' | 'SUPERVISOR' | 'ADMIN'; isActive: boolean }> = {}) {
  return prisma.user.create({
    data: {
      email: `${Math.random()}@example.com`,
      passwordHash: await hashPassword('password123'),
      fullName: 'Test User',
      role: overrides.role ?? 'ADMIN',
      isActive: overrides.isActive ?? true,
    },
  });
}

describe('authenticate + authorize middleware', () => {
  it('rejects a request with no token', async () => {
    const res = await request(buildTestApp()).get('/protected');
    expect(res.status).toBe(401);
  });

  it('rejects a request with an invalid token', async () => {
    const res = await request(buildTestApp()).get('/protected').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(401);
  });

  it('rejects a deactivated user even with a valid token', async () => {
    const user = await createUser({ isActive: false });
    const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
    const res = await request(buildTestApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects a valid but under-privileged user', async () => {
    const user = await createUser({ role: 'AGENT' });
    const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
    const res = await request(buildTestApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('allows a valid, active, correctly-roled user', async () => {
    const user = await createUser({ role: 'ADMIN' });
    const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
    const res = await request(buildTestApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(user.id);
  });
});

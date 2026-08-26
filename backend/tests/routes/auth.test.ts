import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';

const app = createApp();

async function createUser(overrides: Partial<{ email: string; password: string; isActive: boolean }> = {}) {
  const password = overrides.password ?? 'password123';
  return {
    user: await prisma.user.create({
      data: {
        email: overrides.email ?? 'agent@example.com',
        passwordHash: await hashPassword(password),
        fullName: 'Test Agent',
        role: 'AGENT',
        isActive: overrides.isActive ?? true,
      },
    }),
    password,
  };
}

describe('POST /api/auth/login', () => {
  it('returns a token and the public user on valid credentials', async () => {
    const { user, password } = await createUser({ email: 'agent@example.com' });
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user.email).toBe(user.email);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('rejects an unknown email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever' });
    expect(res.status).toBe(401);
  });

  it('rejects an incorrect password', async () => {
    const { user } = await createUser({ email: 'agent2@example.com' });
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('rejects a deactivated user', async () => {
    const { user, password } = await createUser({ email: 'agent3@example.com', isActive: false });
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed body', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 204', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(204);
  });
});

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

async function createSupervisor() {
  const user = await prisma.user.create({
    data: {
      email: 'supervisor@example.com',
      passwordHash: await hashPassword('password123'),
      fullName: 'Supervisor User',
      role: 'SUPERVISOR',
    },
  });
  const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
  return { user, token };
}

describe('/api/users', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('rejects non-admin requests', async () => {
    const { token } = await createAgent();
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('lists users for an admin', async () => {
    const { token } = await createAdmin();
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].passwordHash).toBeUndefined();
  });

  it('lets a supervisor list users too', async () => {
    const { token } = await createSupervisor();
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('rejects a supervisor creating a user', async () => {
    const { token } = await createSupervisor();
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'nope@example.com', password: 'password123', fullName: 'Nope', role: 'AGENT' });
    expect(res.status).toBe(403);
  });

  it('creates a user', async () => {
    const { token } = await createAdmin();
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'new@example.com', password: 'password123', fullName: 'New User', role: 'AGENT' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('new@example.com');
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('rejects creating a user with a duplicate email', async () => {
    const { token } = await createAdmin();
    await prisma.user.create({
      data: { email: 'dup@example.com', passwordHash: await hashPassword('x'), fullName: 'Dup', role: 'AGENT' },
    });
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'dup@example.com', password: 'password123', fullName: 'Another', role: 'AGENT' });
    expect(res.status).toBe(400);
  });

  it('updates a user', async () => {
    const { token } = await createAdmin();
    const target = await prisma.user.create({
      data: { email: 'target@example.com', passwordHash: await hashPassword('x'), fullName: 'Target', role: 'AGENT' },
    });
    const res = await request(app)
      .patch(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Updated Name', role: 'SUPERVISOR' });
    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('Updated Name');
    expect(res.body.role).toBe('SUPERVISOR');
  });

  it('deactivates a user', async () => {
    const { token } = await createAdmin();
    const target = await prisma.user.create({
      data: { email: 'deact@example.com', passwordHash: await hashPassword('x'), fullName: 'Deact', role: 'AGENT' },
    });
    const res = await request(app)
      .post(`/api/users/${target.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });
});

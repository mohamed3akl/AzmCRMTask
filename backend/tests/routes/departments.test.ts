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

describe('/api/departments', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/departments');
    expect(res.status).toBe(401);
  });

  it('creates and lists departments', async () => {
    const { token } = await createAdmin();
    const createRes = await request(app)
      .post('/api/departments')
      .set('Authorization', `Bearer ${token}`)
      .send({ nameEn: 'Support', nameAr: 'الدعم' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.nameEn).toBe('Support');

    const listRes = await request(app).get('/api/departments').set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
  });

  it('updates a department', async () => {
    const { token } = await createAdmin();
    const dept = await prisma.department.create({ data: { nameEn: 'Sales', nameAr: 'المبيعات' } });
    const res = await request(app)
      .patch(`/api/departments/${dept.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nameEn: 'Sales & Marketing' });
    expect(res.status).toBe(200);
    expect(res.body.nameEn).toBe('Sales & Marketing');
  });

  it('rejects an update to a non-existent department', async () => {
    const { token } = await createAdmin();
    const res = await request(app)
      .patch('/api/departments/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ nameEn: 'Nope' });
    expect(res.status).toBe(404);
  });
});

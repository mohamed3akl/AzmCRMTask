import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';
import { signToken } from '../../src/lib/jwt';

const app = createApp();

async function createAgent(email: string) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('password123'),
      fullName: 'Agent User',
      role: 'AGENT',
    },
  });
  const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
  return { user, token };
}

async function createCustomerFixture() {
  return prisma.customer.create({ data: { fullName: 'Jane Customer', email: 'jane@example.com' } });
}

describe('/api/tasks', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
  });

  it('creates a task owned by the caller', async () => {
    const { token } = await createAgent('owner1@example.com');
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Call back Jane' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Call back Jane');
    expect(res.body.isDone).toBe(false);
    expect(res.body.ticketId).toBeNull();
  });

  it('creates a task linked to a ticket', async () => {
    const { user, token } = await createAgent('owner2@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Follow up', ticketId: ticket.id });

    expect(res.status).toBe(201);
    expect(res.body.ticketId).toBe(ticket.id);
  });

  it('lists only the caller\'s own tasks', async () => {
    const { token: tokenA } = await createAgent('lister-a@example.com');
    const { token: tokenB } = await createAgent('lister-b@example.com');

    await request(app).post('/api/tasks').set('Authorization', `Bearer ${tokenA}`).send({ title: 'A task' });
    await request(app).post('/api/tasks').set('Authorization', `Bearer ${tokenB}`).send({ title: 'B task' });

    const res = await request(app).get('/api/tasks').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('A task');
  });

  it('filters by done status', async () => {
    const { token } = await createAgent('filterer@example.com');
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'To finish' });
    await request(app)
      .patch(`/api/tasks/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isDone: true });
    await request(app).post('/api/tasks').set('Authorization', `Bearer ${token}`).send({ title: 'Still open' });

    const res = await request(app).get('/api/tasks?done=false').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Still open');
  });

  it('updates and marks a task done', async () => {
    const { token } = await createAgent('updater@example.com');
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Original title' });

    const res = await request(app)
      .patch(`/api/tasks/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated title', isDone: true });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated title');
    expect(res.body.isDone).toBe(true);
  });

  it('returns 404 updating a task owned by someone else', async () => {
    const { token: ownerToken } = await createAgent('owner3@example.com');
    const { token: otherToken } = await createAgent('other1@example.com');
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Private task' });

    const res = await request(app)
      .patch(`/api/tasks/${createRes.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ title: 'Hijacked' });

    expect(res.status).toBe(404);
  });

  it('deletes a task owned by the caller', async () => {
    const { token } = await createAgent('deleter@example.com');
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Delete me' });

    const res = await request(app).delete(`/api/tasks/${createRes.body.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);

    const listRes = await request(app).get('/api/tasks').set('Authorization', `Bearer ${token}`);
    expect(listRes.body).toHaveLength(0);
  });

  it('returns 404 deleting a task owned by someone else', async () => {
    const { token: ownerToken } = await createAgent('owner4@example.com');
    const { token: otherToken } = await createAgent('other2@example.com');
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Not yours' });

    const res = await request(app)
      .delete(`/api/tasks/${createRes.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(404);
  });
});

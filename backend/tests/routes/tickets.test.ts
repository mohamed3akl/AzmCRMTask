import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';
import { signToken } from '../../src/lib/jwt';
import type { Role } from '@prisma/client';

const app = createApp();

async function createStaff(role: Role, email: string) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('password123'),
      fullName: `${role} User`,
      role,
    },
  });
  const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
  return { user, token };
}

async function createCustomerFixture() {
  return prisma.customer.create({ data: { fullName: 'Jane Customer', email: 'jane@example.com' } });
}

describe('/api/tickets', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/tickets');
    expect(res.status).toBe(401);
  });

  it('creates a ticket for an existing customer', async () => {
    const { token } = await createStaff('AGENT', 'agent@example.com');
    const customer = await createCustomerFixture();

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Cannot log in', description: 'Getting an error', customerId: customer.id });

    expect(res.status).toBe(201);
    expect(res.body.subject).toBe('Cannot log in');
    expect(res.body.status).toBe('OPEN');
    expect(res.body.priority).toBe('MEDIUM');
    expect(res.body.customer.fullName).toBe('Jane Customer');
  });

  it('creates a ticket with an inline new customer', async () => {
    const { token } = await createStaff('AGENT', 'agent2@example.com');

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        subject: 'Billing question',
        description: 'Why was I charged twice?',
        newCustomer: { fullName: 'New Customer', email: 'new@example.com' },
        priority: 'HIGH',
      });

    expect(res.status).toBe(201);
    expect(res.body.customer.fullName).toBe('New Customer');
    expect(res.body.priority).toBe('HIGH');
  });

  it('rejects creating a ticket with both customerId and newCustomer', async () => {
    const { token } = await createStaff('AGENT', 'agent3@example.com');
    const customer = await createCustomerFixture();

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        subject: 'Test',
        description: 'Test',
        customerId: customer.id,
        newCustomer: { fullName: 'Another' },
      });

    expect(res.status).toBe(400);
  });

  it('rejects creating a ticket with neither customerId nor newCustomer', async () => {
    const { token } = await createStaff('AGENT', 'agent4@example.com');
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Test', description: 'Test' });
    expect(res.status).toBe(400);
  });

  it('lists tickets', async () => {
    const { user, token } = await createStaff('AGENT', 'agent5@example.com');
    const customer = await createCustomerFixture();
    await prisma.ticket.create({
      data: { subject: 'Ticket 1', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app).get('/api/tickets').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].customer.fullName).toBe('Jane Customer');
  });

  it('filters tickets by status', async () => {
    const { user, token } = await createStaff('AGENT', 'agent6@example.com');
    const customer = await createCustomerFixture();
    await prisma.ticket.create({
      data: { subject: 'Open one', description: 'Desc', customerId: customer.id, createdById: user.id, status: 'OPEN' },
    });
    await prisma.ticket.create({
      data: { subject: 'Closed one', description: 'Desc', customerId: customer.id, createdById: user.id, status: 'CLOSED' },
    });

    const res = await request(app).get('/api/tickets?status=CLOSED').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].subject).toBe('Closed one');
  });

  it('gets a ticket by id with its (empty) event timeline', async () => {
    const { user, token } = await createStaff('AGENT', 'agent7@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app).get(`/api/tickets/${ticket.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe('Ticket');
    expect(res.body.events).toEqual([]);
  });

  it('returns 404 for a non-existent ticket', async () => {
    const { token } = await createStaff('AGENT', 'agent8@example.com');
    const res = await request(app)
      .get('/api/tickets/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/tickets/:id', () => {
  it('updates status and logs a STATUS_CHANGED event', async () => {
    const { user, token } = await createStaff('AGENT', 'updater@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].type).toBe('STATUS_CHANGED');
    expect(res.body.events[0].oldValue).toBe('OPEN');
    expect(res.body.events[0].newValue).toBe('IN_PROGRESS');
  });

  it('updates multiple fields at once and logs one event per changed field', async () => {
    const { user, token } = await createStaff('AGENT', 'updater2@example.com');
    const customer = await createCustomerFixture();
    const category = await prisma.ticketCategory.create({ data: { nameEn: 'Billing', nameAr: 'الفواتير' } });
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ priority: 'URGENT', categoryId: category.id });

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe('URGENT');
    expect(res.body.category.id).toBe(category.id);
    expect(res.body.events).toHaveLength(2);
    const types = res.body.events.map((e: { type: string }) => e.type).sort();
    expect(types).toEqual(['CATEGORY_CHANGED', 'PRIORITY_CHANGED']);
  });

  it('is a no-op when the submitted value matches the current value', async () => {
    const { user, token } = await createStaff('AGENT', 'updater3@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'OPEN' });

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(0);
  });

  it('returns 404 for a non-existent ticket', async () => {
    const { token } = await createStaff('AGENT', 'updater4@example.com');
    const res = await request(app)
      .patch('/api/tickets/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CLOSED' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/tickets/:id/assign', () => {
  it('lets a supervisor assign a ticket to any agent', async () => {
    const { user: supervisor, token: supervisorToken } = await createStaff('SUPERVISOR', 'supervisor@example.com');
    const { user: agent } = await createStaff('AGENT', 'agent-assignee@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: supervisor.id },
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ assigneeId: agent.id });

    expect(res.status).toBe(200);
    expect(res.body.assignee.id).toBe(agent.id);
  });

  it('lets an agent claim an unassigned ticket for themselves', async () => {
    const { user: agent, token } = await createStaff('AGENT', 'claiming-agent@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: agent.id },
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId: agent.id });

    expect(res.status).toBe(200);
    expect(res.body.assignee.id).toBe(agent.id);
  });

  it('lets an agent release their own assignment', async () => {
    const { user: agent, token } = await createStaff('AGENT', 'releasing-agent@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: {
        subject: 'Ticket',
        description: 'Desc',
        customerId: customer.id,
        createdById: agent.id,
        assigneeId: agent.id,
      },
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId: null });

    expect(res.status).toBe(200);
    expect(res.body.assignee).toBeNull();
  });

  it('rejects an agent assigning a ticket to a different agent', async () => {
    const { user: agentA, token: tokenA } = await createStaff('AGENT', 'agent-a@example.com');
    const { user: agentB } = await createStaff('AGENT', 'agent-b@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: agentA.id },
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ assigneeId: agentB.id });

    expect(res.status).toBe(403);
  });

  it('rejects an agent claiming a ticket already assigned to a different agent', async () => {
    const { user: agentOwner } = await createStaff('AGENT', 'agent-owner@example.com');
    const { user: agentThief, token: tokenThief } = await createStaff('AGENT', 'agent-thief@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: {
        subject: 'Ticket',
        description: 'Desc',
        customerId: customer.id,
        createdById: agentOwner.id,
        assigneeId: agentOwner.id,
      },
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${tokenThief}`)
      .send({ assigneeId: agentThief.id });

    expect(res.status).toBe(403);
  });
});

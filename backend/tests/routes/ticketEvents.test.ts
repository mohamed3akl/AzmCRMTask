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

describe('GET /api/ticket-events/recent', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/ticket-events/recent');
    expect(res.status).toBe(401);
  });

  it('returns recent events across tickets in descending order', async () => {
    const { user, token } = await createAgent('events@example.com');
    const customer = await prisma.customer.create({ data: { fullName: 'Jane Customer' } });
    const ticketA = await prisma.ticket.create({
      data: { subject: 'Ticket A', description: 'Desc', customerId: customer.id, createdById: user.id },
    });
    const ticketB = await prisma.ticket.create({
      data: { subject: 'Ticket B', description: 'Desc', customerId: customer.id, createdById: user.id },
    });
    await prisma.ticketEvent.create({
      data: { ticketId: ticketA.id, type: 'NOTE_ADDED', note: 'First', authorId: user.id },
    });
    await prisma.ticketEvent.create({
      data: { ticketId: ticketB.id, type: 'NOTE_ADDED', note: 'Second', authorId: user.id },
    });

    const res = await request(app).get('/api/ticket-events/recent').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].note).toBe('Second');
    expect(res.body[0].ticket.subject).toBe('Ticket B');
    expect(res.body[1].note).toBe('First');
  });

  it('respects the limit query param', async () => {
    const { user, token } = await createAgent('events2@example.com');
    const customer = await prisma.customer.create({ data: { fullName: 'Jane Customer' } });
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });
    for (let i = 0; i < 3; i += 1) {
      await prisma.ticketEvent.create({
        data: { ticketId: ticket.id, type: 'NOTE_ADDED', note: `Note ${i}`, authorId: user.id },
      });
    }

    const res = await request(app)
      .get('/api/ticket-events/recent?limit=2')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

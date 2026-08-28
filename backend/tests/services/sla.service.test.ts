import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';
import { attachSlaStatus } from '../../src/services/sla.service';
import type { TicketPriority } from '@prisma/client';

async function createStaff() {
  return prisma.user.create({
    data: {
      email: `staff-${Math.random()}@example.com`,
      passwordHash: await hashPassword('password123'),
      fullName: 'Staff User',
      role: 'AGENT',
    },
  });
}

async function createCustomerFixture() {
  return prisma.customer.create({ data: { fullName: 'Jane Customer' } });
}

async function seedTarget(priority: TicketPriority, responseMinutes: number, resolutionMinutes: number) {
  return prisma.slaTarget.create({ data: { priority, responseMinutes, resolutionMinutes } });
}

describe('attachSlaStatus', () => {
  it('returns sla: null when no target exists for the ticket priority', async () => {
    const staff = await createStaff();
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Test', description: 'Test', customerId: customer.id, createdById: staff.id, priority: 'HIGH' },
    });

    const [result] = await attachSlaStatus([ticket]);
    expect(result.sla).toBeNull();
  });

  it('marks both clocks PENDING when neither is due yet and nothing has happened', async () => {
    await seedTarget('HIGH', 60, 480);
    const staff = await createStaff();
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Test', description: 'Test', customerId: customer.id, createdById: staff.id, priority: 'HIGH' },
    });

    const [result] = await attachSlaStatus([ticket]);
    expect(result.sla!.response.status).toBe('PENDING');
    expect(result.sla!.resolution.status).toBe('PENDING');
  });

  it('marks the response clock MET when a note was added before the due time', async () => {
    await seedTarget('HIGH', 60, 480);
    const staff = await createStaff();
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: {
        subject: 'Test',
        description: 'Test',
        customerId: customer.id,
        createdById: staff.id,
        priority: 'HIGH',
        createdAt: new Date(Date.now() - 30 * 60_000),
      },
    });
    await prisma.ticketEvent.create({
      data: { ticketId: ticket.id, type: 'NOTE_ADDED', note: 'Responded', authorId: staff.id },
    });

    const [result] = await attachSlaStatus([ticket]);
    expect(result.sla!.response.status).toBe('MET');
    expect(result.sla!.response.respondedAt).not.toBeNull();
  });

  it('marks the response clock BREACHED when still open past its due time', async () => {
    await seedTarget('URGENT', 15, 120);
    const staff = await createStaff();
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: {
        subject: 'Test',
        description: 'Test',
        customerId: customer.id,
        createdById: staff.id,
        priority: 'URGENT',
        createdAt: new Date(Date.now() - 30 * 60_000),
      },
    });

    const [result] = await attachSlaStatus([ticket]);
    expect(result.sla!.response.status).toBe('BREACHED');
  });

  it('marks the resolution clock MET when the ticket was resolved before its due time', async () => {
    await seedTarget('MEDIUM', 240, 60);
    const staff = await createStaff();
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: {
        subject: 'Test',
        description: 'Test',
        customerId: customer.id,
        createdById: staff.id,
        priority: 'MEDIUM',
        status: 'RESOLVED',
      },
    });
    await prisma.ticketEvent.create({
      data: { ticketId: ticket.id, type: 'STATUS_CHANGED', oldValue: 'OPEN', newValue: 'RESOLVED', authorId: staff.id },
    });

    const [result] = await attachSlaStatus([ticket]);
    expect(result.sla!.resolution.status).toBe('MET');
  });

  it('marks the resolution clock BREACHED when resolved after its due time', async () => {
    await seedTarget('MEDIUM', 240, 10);
    const staff = await createStaff();
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: {
        subject: 'Test',
        description: 'Test',
        customerId: customer.id,
        createdById: staff.id,
        priority: 'MEDIUM',
        status: 'RESOLVED',
        createdAt: new Date(Date.now() - 60 * 60_000),
      },
    });
    await prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'STATUS_CHANGED',
        oldValue: 'OPEN',
        newValue: 'RESOLVED',
        authorId: staff.id,
        createdAt: new Date(),
      },
    });

    const [result] = await attachSlaStatus([ticket]);
    expect(result.sla!.resolution.status).toBe('BREACHED');
  });

  it('computes sla status independently for multiple tickets in a single call', async () => {
    await seedTarget('LOW', 480, 4320);
    const staff = await createStaff();
    const customer = await createCustomerFixture();
    const tickets = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        prisma.ticket.create({
          data: {
            subject: `Ticket ${i}`,
            description: 'Test',
            customerId: customer.id,
            createdById: staff.id,
            priority: 'LOW',
          },
        })
      )
    );

    const results = await attachSlaStatus(tickets);
    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.sla!.response.status).toBe('PENDING');
      expect(result.sla!.resolution.status).toBe('PENDING');
    }
  });
});

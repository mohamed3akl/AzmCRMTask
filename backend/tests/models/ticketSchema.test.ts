import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';

describe('ticketing schema', () => {
  it('persists a ticket with its relations and an event', async () => {
    const department = await prisma.department.create({ data: { nameEn: 'Support', nameAr: 'الدعم' } });
    const agent = await prisma.user.create({
      data: {
        email: 'agent@example.com',
        passwordHash: await hashPassword('password123'),
        fullName: 'Agent Smith',
        role: 'AGENT',
        departmentId: department.id,
      },
    });
    const customer = await prisma.customer.create({ data: { fullName: 'Jane Customer', email: 'jane@example.com' } });
    const category = await prisma.ticketCategory.create({ data: { nameEn: 'Billing', nameAr: 'الفواتير' } });

    const ticket = await prisma.ticket.create({
      data: {
        subject: 'Cannot log in',
        description: 'Getting an error on login',
        customerId: customer.id,
        categoryId: category.id,
        departmentId: department.id,
        assigneeId: agent.id,
        createdById: agent.id,
      },
    });

    expect(ticket.status).toBe('OPEN');
    expect(ticket.priority).toBe('MEDIUM');
    expect(ticket.isEscalated).toBe(false);

    const event = await prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'NOTE_ADDED',
        note: 'Called the customer back',
        authorId: agent.id,
      },
    });

    expect(event.ticketId).toBe(ticket.id);

    const found = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      include: { events: true, customer: true, category: true, department: true },
    });
    expect(found?.customer.fullName).toBe('Jane Customer');
    expect(found?.category?.nameEn).toBe('Billing');
    expect(found?.department?.nameEn).toBe('Support');
    expect(found?.events).toHaveLength(1);
  });
});

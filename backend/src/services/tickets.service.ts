import { Prisma, Role, TicketPriority, TicketStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/httpError';

const ticketInclude = {
  customer: true,
  category: true,
  department: true,
  assignee: { select: { id: true, fullName: true, role: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.TicketInclude;

const ticketDetailInclude = {
  ...ticketInclude,
  events: {
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { id: true, fullName: true } } },
  },
} satisfies Prisma.TicketInclude;

export type TicketWithRelations = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;
export type TicketDetail = Prisma.TicketGetPayload<{ include: typeof ticketDetailInclude }>;

export async function listTickets(filters: {
  status?: TicketStatus;
  assigneeId?: string;
  departmentId?: string;
  categoryId?: string;
}): Promise<TicketWithRelations[]> {
  return prisma.ticket.findMany({
    where: {
      status: filters.status,
      assigneeId: filters.assigneeId,
      departmentId: filters.departmentId,
      categoryId: filters.categoryId,
    },
    include: ticketInclude,
    orderBy: { createdAt: 'desc' },
  });
}

export async function getTicketById(id: string): Promise<TicketDetail> {
  const ticket = await prisma.ticket.findUnique({ where: { id }, include: ticketDetailInclude });
  if (!ticket) {
    throw new HttpError(404, 'NOT_FOUND', 'Ticket not found');
  }
  return ticket;
}

export async function createTicket(
  data: {
    subject: string;
    description: string;
    customerId?: string;
    newCustomer?: { fullName: string; email?: string; phone?: string };
    categoryId?: string | null;
    departmentId?: string | null;
    priority?: TicketPriority;
  },
  createdById: string
): Promise<TicketDetail> {
  let customerId = data.customerId;
  if (!customerId && data.newCustomer) {
    const customer = await prisma.customer.create({ data: data.newCustomer });
    customerId = customer.id;
  }
  if (!customerId) {
    throw new HttpError(400, 'CUSTOMER_REQUIRED', 'Provide customerId or newCustomer');
  }

  const ticket = await prisma.ticket.create({
    data: {
      subject: data.subject,
      description: data.description,
      customerId,
      categoryId: data.categoryId ?? null,
      departmentId: data.departmentId ?? null,
      priority: data.priority ?? 'MEDIUM',
      createdById,
    },
  });

  return getTicketById(ticket.id);
}

export async function updateTicketFields(
  id: string,
  data: {
    status?: TicketStatus;
    priority?: TicketPriority;
    categoryId?: string | null;
    departmentId?: string | null;
  },
  authorId: string
): Promise<TicketDetail> {
  const current = await prisma.ticket.findUnique({ where: { id } });
  if (!current) {
    throw new HttpError(404, 'NOT_FOUND', 'Ticket not found');
  }

  await prisma.$transaction(async (tx) => {
    const updateData: Prisma.TicketUncheckedUpdateInput = {};

    if (data.status !== undefined && data.status !== current.status) {
      updateData.status = data.status;
      await tx.ticketEvent.create({
        data: { ticketId: id, type: 'STATUS_CHANGED', oldValue: current.status, newValue: data.status, authorId },
      });
    }
    if (data.priority !== undefined && data.priority !== current.priority) {
      updateData.priority = data.priority;
      await tx.ticketEvent.create({
        data: { ticketId: id, type: 'PRIORITY_CHANGED', oldValue: current.priority, newValue: data.priority, authorId },
      });
    }
    if (data.categoryId !== undefined && data.categoryId !== current.categoryId) {
      updateData.categoryId = data.categoryId;
      await tx.ticketEvent.create({
        data: { ticketId: id, type: 'CATEGORY_CHANGED', oldValue: current.categoryId, newValue: data.categoryId, authorId },
      });
    }
    if (data.departmentId !== undefined && data.departmentId !== current.departmentId) {
      updateData.departmentId = data.departmentId;
      await tx.ticketEvent.create({
        data: { ticketId: id, type: 'DEPARTMENT_CHANGED', oldValue: current.departmentId, newValue: data.departmentId, authorId },
      });
    }

    if (Object.keys(updateData).length > 0) {
      await tx.ticket.update({ where: { id }, data: updateData });
    }
  });

  return getTicketById(id);
}

export async function assignTicket(
  id: string,
  assigneeId: string | null,
  requester: { id: string; role: Role }
): Promise<TicketDetail> {
  const current = await prisma.ticket.findUnique({ where: { id } });
  if (!current) {
    throw new HttpError(404, 'NOT_FOUND', 'Ticket not found');
  }

  if (requester.role === 'AGENT') {
    const claimingSelf = assigneeId === requester.id;
    const releasingSelf = assigneeId === null && current.assigneeId === requester.id;
    if (!claimingSelf && !releasingSelf) {
      throw new HttpError(403, 'INVALID_ASSIGNEE', 'Agents may only claim or release their own assignment');
    }
  }

  if (assigneeId === current.assigneeId) {
    return getTicketById(id);
  }

  await prisma.$transaction([
    prisma.ticket.update({ where: { id }, data: { assigneeId } }),
    prisma.ticketEvent.create({
      data: {
        ticketId: id,
        type: 'ASSIGNEE_CHANGED',
        oldValue: current.assigneeId,
        newValue: assigneeId,
        authorId: requester.id,
      },
    }),
  ]);

  return getTicketById(id);
}

import { Prisma, Role, TicketEventType, TicketPriority, TicketSource, TicketStatus } from '@prisma/client';
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
  unassigned?: boolean;
  escalated?: boolean;
}): Promise<TicketWithRelations[]> {
  return prisma.ticket.findMany({
    where: {
      status: filters.status,
      assigneeId: filters.unassigned ? null : filters.assigneeId,
      departmentId: filters.departmentId,
      categoryId: filters.categoryId,
      isEscalated: filters.escalated ? true : undefined,
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

async function pickAutoAssignee(departmentId: string | null): Promise<string | null> {
  let candidates = await prisma.user.findMany({
    where: { role: 'AGENT', isActive: true, ...(departmentId ? { departmentId } : {}) },
    select: { id: true },
  });
  if (departmentId && candidates.length === 0) {
    candidates = await prisma.user.findMany({
      where: { role: 'AGENT', isActive: true },
      select: { id: true },
    });
  }
  if (candidates.length === 0) {
    return null;
  }

  const counts = await prisma.ticket.groupBy({
    by: ['assigneeId'],
    where: {
      assigneeId: { in: candidates.map((c) => c.id) },
      status: { in: ['OPEN', 'IN_PROGRESS'] },
    },
    _count: true,
  });
  const countByAgent = new Map(counts.map((c) => [c.assigneeId as string, c._count]));

  const sorted = [...candidates].sort((a, b) => {
    const diff = (countByAgent.get(a.id) ?? 0) - (countByAgent.get(b.id) ?? 0);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
  return sorted[0].id;
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
  createdById: string | null,
  source: TicketSource = 'MANUAL'
): Promise<TicketDetail> {
  let customerId = data.customerId;
  if (!customerId && data.newCustomer) {
    const customer = await prisma.customer.create({ data: data.newCustomer });
    customerId = customer.id;
  }
  if (!customerId) {
    throw new HttpError(400, 'CUSTOMER_REQUIRED', 'Provide customerId or newCustomer');
  }

  const departmentId = data.departmentId ?? null;
  const assigneeId = await pickAutoAssignee(departmentId);

  const ticket = await prisma.ticket.create({
    data: {
      subject: data.subject,
      description: data.description,
      customerId,
      categoryId: data.categoryId ?? null,
      departmentId,
      priority: data.priority ?? 'MEDIUM',
      createdById: createdById ?? null,
      source,
      assigneeId,
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
    const claimingSelf = assigneeId === requester.id && current.assigneeId === null;
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

export async function escalateTicket(id: string, note: string | undefined, authorId: string): Promise<TicketDetail> {
  const current = await prisma.ticket.findUnique({ where: { id } });
  if (!current) {
    throw new HttpError(404, 'NOT_FOUND', 'Ticket not found');
  }
  if (current.isEscalated) {
    throw new HttpError(400, 'ALREADY_ESCALATED', 'Ticket is already escalated');
  }

  await prisma.$transaction([
    prisma.ticket.update({ where: { id }, data: { isEscalated: true } }),
    prisma.ticketEvent.create({
      data: { ticketId: id, type: 'ESCALATED', note: note ?? null, authorId },
    }),
  ]);

  return getTicketById(id);
}

export async function unescalateTicket(id: string, authorId: string): Promise<TicketDetail> {
  const current = await prisma.ticket.findUnique({ where: { id } });
  if (!current) {
    throw new HttpError(404, 'NOT_FOUND', 'Ticket not found');
  }
  if (!current.isEscalated) {
    throw new HttpError(400, 'NOT_ESCALATED', 'Ticket is not escalated');
  }

  await prisma.$transaction([
    prisma.ticket.update({ where: { id }, data: { isEscalated: false } }),
    prisma.ticketEvent.create({
      data: { ticketId: id, type: 'UNESCALATED', authorId },
    }),
  ]);

  return getTicketById(id);
}

export async function addTicketNote(id: string, note: string, authorId: string): Promise<TicketDetail> {
  const current = await prisma.ticket.findUnique({ where: { id } });
  if (!current) {
    throw new HttpError(404, 'NOT_FOUND', 'Ticket not found');
  }
  await prisma.ticketEvent.create({
    data: { ticketId: id, type: 'NOTE_ADDED', note, authorId },
  });
  return getTicketById(id);
}

export interface RecentTicketEvent {
  id: string;
  type: TicketEventType;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
  createdAt: Date;
  author: { id: string; fullName: string };
  ticket: { id: string; subject: string };
}

export async function listRecentTicketEvents(limit?: number): Promise<RecentTicketEvent[]> {
  const cappedLimit = Math.min(limit ?? 20, 50);
  return prisma.ticketEvent.findMany({
    take: cappedLimit,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      oldValue: true,
      newValue: true,
      note: true,
      createdAt: true,
      author: { select: { id: true, fullName: true } },
      ticket: { select: { id: true, subject: true } },
    },
  });
}

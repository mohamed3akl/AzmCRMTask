import { Prisma, TicketPriority, TicketStatus } from '@prisma/client';
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

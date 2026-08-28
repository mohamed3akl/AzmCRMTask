import { TicketPriority, TicketStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';

export type SlaClockStatus = 'PENDING' | 'MET' | 'BREACHED';

export interface SlaClock {
  dueAt: string;
  respondedAt?: string | null;
  resolvedAt?: string | null;
  status: SlaClockStatus;
}

export interface SlaStatus {
  response: SlaClock;
  resolution: SlaClock;
}

interface TicketForSla {
  id: string;
  createdAt: Date;
  priority: TicketPriority;
  status: TicketStatus;
}

function computeClockStatus(dueAt: Date, achievedAt: Date | null, now: Date): SlaClockStatus {
  if (achievedAt) {
    return achievedAt <= dueAt ? 'MET' : 'BREACHED';
  }
  return now > dueAt ? 'BREACHED' : 'PENDING';
}

export async function attachSlaStatus<T extends TicketForSla>(
  tickets: T[]
): Promise<(T & { sla: SlaStatus | null })[]> {
  if (tickets.length === 0) return [];

  const ticketIds = tickets.map((t) => t.id);
  const now = new Date();

  const [targets, firstResponses, resolutions] = await Promise.all([
    prisma.slaTarget.findMany(),
    prisma.ticketEvent.groupBy({
      by: ['ticketId'],
      where: { ticketId: { in: ticketIds }, type: 'NOTE_ADDED' },
      _min: { createdAt: true },
    }),
    prisma.ticketEvent.groupBy({
      by: ['ticketId'],
      where: { ticketId: { in: ticketIds }, type: 'STATUS_CHANGED', newValue: 'RESOLVED' },
      _min: { createdAt: true },
    }),
  ]);

  const targetsByPriority = new Map(targets.map((t) => [t.priority, t]));
  const firstResponseByTicket = new Map(firstResponses.map((r) => [r.ticketId, r._min.createdAt]));
  const resolutionByTicket = new Map(resolutions.map((r) => [r.ticketId, r._min.createdAt]));

  return tickets.map((ticket) => {
    const target = targetsByPriority.get(ticket.priority);
    if (!target) {
      return { ...ticket, sla: null };
    }

    const responseDueAt = new Date(ticket.createdAt.getTime() + target.responseMinutes * 60_000);
    const resolutionDueAt = new Date(ticket.createdAt.getTime() + target.resolutionMinutes * 60_000);
    const respondedAt = firstResponseByTicket.get(ticket.id) ?? null;
    const isTerminal = ticket.status === 'RESOLVED' || ticket.status === 'CLOSED';
    const resolvedAt = isTerminal ? (resolutionByTicket.get(ticket.id) ?? null) : null;

    const sla: SlaStatus = {
      response: {
        dueAt: responseDueAt.toISOString(),
        respondedAt: respondedAt ? respondedAt.toISOString() : null,
        status: computeClockStatus(responseDueAt, respondedAt, now),
      },
      resolution: {
        dueAt: resolutionDueAt.toISOString(),
        resolvedAt: resolvedAt ? resolvedAt.toISOString() : null,
        status: computeClockStatus(resolutionDueAt, resolvedAt, now),
      },
    };

    return { ...ticket, sla };
  });
}

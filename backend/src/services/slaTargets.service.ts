import { SlaTarget, TicketPriority } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/httpError';

export async function listSlaTargets(): Promise<SlaTarget[]> {
  return prisma.slaTarget.findMany({ orderBy: { priority: 'asc' } });
}

export async function updateSlaTarget(
  priority: TicketPriority,
  data: Partial<{ responseMinutes: number; resolutionMinutes: number }>
): Promise<SlaTarget> {
  try {
    return await prisma.slaTarget.update({ where: { priority }, data });
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'SLA target not found');
  }
}

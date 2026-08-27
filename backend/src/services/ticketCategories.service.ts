import { TicketCategory } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/httpError';

export async function listTicketCategories(): Promise<TicketCategory[]> {
  return prisma.ticketCategory.findMany({ orderBy: { nameEn: 'asc' } });
}

export async function createTicketCategory(data: { nameEn: string; nameAr: string }): Promise<TicketCategory> {
  return prisma.ticketCategory.create({ data });
}

export async function updateTicketCategory(
  id: string,
  data: Partial<{ nameEn: string; nameAr: string }>
): Promise<TicketCategory> {
  try {
    return await prisma.ticketCategory.update({ where: { id }, data });
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'Ticket category not found');
  }
}

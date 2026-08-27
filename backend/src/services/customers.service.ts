import { Customer } from '@prisma/client';
import { prisma } from '../lib/prisma';

export async function searchCustomers(query: string): Promise<Customer[]> {
  return prisma.customer.findMany({
    where: query
      ? {
          OR: [
            { fullName: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } },
          ],
        }
      : undefined,
    take: 20,
    orderBy: { fullName: 'asc' },
  });
}

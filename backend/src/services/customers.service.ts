import { Customer } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/httpError';

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

export interface CustomerTicketSummary {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: Date;
}

export async function getCustomerById(id: string): Promise<Customer & { tickets: CustomerTicketSummary[] }> {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      tickets: {
        select: { id: true, subject: true, status: true, priority: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!customer) {
    throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
  }
  return customer;
}

export async function findExistingCustomerByContact(
  contact: { email?: string; phone?: string },
  excludeId?: string
): Promise<Customer | null> {
  const email = contact.email?.trim();
  const phone = contact.phone?.trim();
  if (!email && !phone) {
    return null;
  }

  return prisma.customer.findFirst({
    where: {
      id: excludeId ? { not: excludeId } : undefined,
      OR: [
        ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []),
        ...(phone ? [{ phone }] : []),
      ],
    },
  });
}

export async function createCustomer(data: {
  fullName: string;
  email?: string;
  phone?: string;
}): Promise<Customer> {
  const existing = await findExistingCustomerByContact(data);
  if (existing) {
    throw new HttpError(409, 'CUSTOMER_EXISTS', 'A customer with this email or phone already exists', {
      existingCustomerId: existing.id,
    });
  }
  return prisma.customer.create({ data });
}

export async function updateCustomer(
  id: string,
  data: { fullName?: string; email?: string; phone?: string }
): Promise<Customer> {
  const current = await prisma.customer.findUnique({ where: { id } });
  if (!current) {
    throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
  }

  if (data.email !== undefined || data.phone !== undefined) {
    const existing = await findExistingCustomerByContact({ email: data.email, phone: data.phone }, id);
    if (existing) {
      throw new HttpError(409, 'CUSTOMER_EXISTS', 'A customer with this email or phone already exists', {
        existingCustomerId: existing.id,
      });
    }
  }

  return prisma.customer.update({ where: { id }, data });
}

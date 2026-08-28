import { beforeEach, afterAll } from 'vitest';
import { config } from 'dotenv';

config({ path: '.env.test' });

import { prisma } from '../src/lib/prisma';

beforeEach(async () => {
  await prisma.ticketEvent.deleteMany();
  await prisma.task.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.ticketCategory.deleteMany();
  await prisma.quickReply.deleteMany();
  await prisma.slaTarget.deleteMany();
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

import { PrismaClient, TicketPriority } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const defaultSlaTargets: Array<{ priority: TicketPriority; responseMinutes: number; resolutionMinutes: number }> = [
  { priority: 'URGENT', responseMinutes: 15, resolutionMinutes: 120 },
  { priority: 'HIGH', responseMinutes: 60, resolutionMinutes: 480 },
  { priority: 'MEDIUM', responseMinutes: 240, resolutionMinutes: 1440 },
  { priority: 'LOW', responseMinutes: 480, resolutionMinutes: 4320 },
];

async function seedAdminUser() {
  const email = process.env.ADMIN_EMAIL ?? 'admin@azmcrm.local';
  const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin user ${email} already exists, skipping seed.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName: 'System Admin',
      role: 'ADMIN',
      locale: 'en',
    },
  });
  console.log(`Seeded admin user: ${email}`);
}

async function seedSlaTargets() {
  for (const target of defaultSlaTargets) {
    await prisma.slaTarget.upsert({
      where: { priority: target.priority },
      create: target,
      update: {},
    });
  }
  console.log('Seeded default SLA targets (existing rows left unchanged).');
}

async function main() {
  await seedAdminUser();
  await seedSlaTargets();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

# SLA Targets + Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Admin configure response/resolution time targets per ticket priority, compute a `PENDING`/`MET`/`BREACHED` status for each ticket's response and resolution clocks, and surface that status on the ticket list, ticket detail page, and a new Supervisor/Admin dashboard widget. No automated actions (assignment, escalation, alerts) — this sub-project only computes and displays status.

**Architecture:** Extends the existing Foundation/Ticket Management/Agent Dashboard/Web Forms layout. SLA computation lives in a new, separate `sla.service.ts` layered on top of the existing ticket read paths (`tickets.controller.ts` calls it after fetching from `tickets.service.ts`, which is otherwise untouched) — a cross-cutting concern, not a ticket-CRUD concern. `SlaTarget` is a fixed four-row table (one per `TicketPriority` enum value), admin-editable but not creatable/deletable via the API.

**Tech Stack:** Same as every prior sub-project — Express + TypeScript + Prisma (pinned `6.19.3`) + PostgreSQL backend; Vue 3 + Vuetify + TypeScript + Pinia frontend; Vitest for both. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-08-28-sla-targets-design.md](../specs/2026-08-28-sla-targets-design.md)

## Global Constraints

- `prisma`/`@prisma/client` stay pinned to the exact version `6.19.3` — do not `npm install` either unpinned.
- Installed `zod` is v4: `ZodError` has no `.errors` property, use `.issues` (already correct in `validate.ts`).
- `backend/vitest.config.ts` has `fileParallelism: false` (tests share one real Postgres DB) — leave it as-is.
- `frontend/tests/testUtils.ts`'s test Vuetify instance has `attach: true` for VMenu/VDialog/VOverlay/VSelect/VAutocomplete/VTooltip.
- Error responses are always shaped `{ error: { code, message } }` (unchanged).
- `SlaTarget.priority` is the primary key directly (the `TicketPriority` enum, four fixed values) — there is no create or delete route, only `PATCH /api/sla-targets/:priority`. The four rows are seeded and permanent.
- The frontend's `ApiTicketSummary.sla` field is **optional** (`sla?: ApiSlaStatus | null`), not required — this deliberately keeps every existing test fixture in `DashboardView.test.ts`, `TicketCreateView.test.ts`, etc. that constructs ticket-shaped objects without an `sla` field compiling and passing unchanged. Only the files this plan actually touches (`TicketListView.test.ts`, `TicketDetailView.test.ts`, `DashboardView.test.ts`'s SLA-specific additions) need `sla` data.
- SLA computation never fails a request: if no `SlaTarget` row exists for a ticket's priority (shouldn't happen post-seed, but the code doesn't assume it), that ticket's `sla` is `null` rather than the request 500ing.
- "First response" = the earliest `NOTE_ADDED` event on a ticket. "Resolved" = the earliest `STATUS_CHANGED` event on a ticket whose `newValue` is `'RESOLVED'`. The SLA clock is continuous wall-clock time from `ticket.createdAt` — no business-hours awareness.

---

## Backend

### Task 1: SlaTarget schema, seed defaults, admin CRUD endpoints

**Files:**
- Modify: `backend/prisma/schema.prisma` (add `SlaTarget` model)
- Modify: `backend/prisma/seed.ts` (unconditionally seed default rows)
- Modify: `backend/tests/setup.ts` (add `slaTarget.deleteMany()`)
- Create: `backend/src/services/slaTargets.service.ts`
- Create: `backend/src/controllers/slaTargets.controller.ts`
- Create: `backend/src/routes/slaTargets.routes.ts`
- Modify: `backend/src/app.ts` (mount `slaTargetsRouter` at `/api/sla-targets`)
- Test: `backend/tests/routes/slaTargets.test.ts`

**Interfaces:**
- Consumes: `prisma`, `HttpError` (Foundation); `authenticate`, `authorize`, `validate` (Foundation).
- Produces: `GET /api/sla-targets` (any authenticated staff) → `SlaTarget[]`; `PATCH /api/sla-targets/:priority` (`ADMIN`-only) → updated `SlaTarget`. Consumed by Task 2's `sla.service.ts` (reads `SlaTarget` rows directly via `prisma`, not this HTTP API) and by Task 3's frontend admin page.

- [ ] **Step 1: Write the failing test**

`backend/tests/routes/slaTargets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';
import { signToken } from '../../src/lib/jwt';

const app = createApp();

async function createAdmin() {
  const user = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      passwordHash: await hashPassword('password123'),
      fullName: 'Admin User',
      role: 'ADMIN',
    },
  });
  const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
  return { user, token };
}

async function createAgent() {
  const user = await prisma.user.create({
    data: {
      email: 'agent@example.com',
      passwordHash: await hashPassword('password123'),
      fullName: 'Agent User',
      role: 'AGENT',
    },
  });
  const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
  return { user, token };
}

async function seedTargets() {
  await prisma.slaTarget.createMany({
    data: [
      { priority: 'URGENT', responseMinutes: 15, resolutionMinutes: 120 },
      { priority: 'HIGH', responseMinutes: 60, resolutionMinutes: 480 },
      { priority: 'MEDIUM', responseMinutes: 240, resolutionMinutes: 1440 },
      { priority: 'LOW', responseMinutes: 480, resolutionMinutes: 4320 },
    ],
  });
}

describe('/api/sla-targets', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/sla-targets');
    expect(res.status).toBe(401);
  });

  it('lets any authenticated staff read all four seeded targets', async () => {
    const { token } = await createAgent();
    await seedTargets();

    const res = await request(app).get('/api/sla-targets').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    const urgent = res.body.find((t: { priority: string }) => t.priority === 'URGENT');
    expect(urgent.responseMinutes).toBe(15);
  });

  it('rejects a non-admin updating a target', async () => {
    const { token } = await createAgent();
    await seedTargets();

    const res = await request(app)
      .patch('/api/sla-targets/URGENT')
      .set('Authorization', `Bearer ${token}`)
      .send({ responseMinutes: 10 });
    expect(res.status).toBe(403);
  });

  it('lets an admin update a target', async () => {
    const { token } = await createAdmin();
    await seedTargets();

    const res = await request(app)
      .patch('/api/sla-targets/URGENT')
      .set('Authorization', `Bearer ${token}`)
      .send({ responseMinutes: 10, resolutionMinutes: 90 });

    expect(res.status).toBe(200);
    expect(res.body.responseMinutes).toBe(10);
    expect(res.body.resolutionMinutes).toBe(90);
  });

  it('rejects an invalid priority segment', async () => {
    const { token } = await createAdmin();
    await seedTargets();

    const res = await request(app)
      .patch('/api/sla-targets/BOGUS')
      .set('Authorization', `Bearer ${token}`)
      .send({ responseMinutes: 10 });
    expect(res.status).toBe(400);
  });

  it('rejects a non-positive minute value', async () => {
    const { token } = await createAdmin();
    await seedTargets();

    const res = await request(app)
      .patch('/api/sla-targets/URGENT')
      .set('Authorization', `Bearer ${token}`)
      .send({ responseMinutes: 0 });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/routes/slaTargets.test.ts`
Expected: FAIL — `prisma.slaTarget` doesn't exist yet and `/api/sla-targets` isn't mounted.

- [ ] **Step 3: Update the Prisma schema**

`backend/prisma/schema.prisma` — add anywhere after `QuickReply`:

```prisma
model SlaTarget {
  priority          TicketPriority @id
  responseMinutes   Int
  resolutionMinutes Int
  updatedAt         DateTime       @updatedAt
}
```

- [ ] **Step 4: Update the test-DB cleanup order**

`backend/tests/setup.ts` (full file — `SlaTarget` has no relations, added next to `quickReply`):

```ts
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
```

- [ ] **Step 5: Run the migration**

```bash
cd backend
npm run prisma:migrate -- --name add_sla_targets
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/azmcrm_test?schema=public" npx prisma migrate deploy
```

(adjust the test-DB connection string to match your local `.env.test` if it differs).

- [ ] **Step 6: Implement the service, controller, and routes**

`backend/src/services/slaTargets.service.ts`:

```ts
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
```

`backend/src/controllers/slaTargets.controller.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { TicketPriority } from '@prisma/client';
import { HttpError } from '../lib/httpError';
import * as slaTargetsService from '../services/slaTargets.service';

const priorityParamSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

export async function listSlaTargetsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await slaTargetsService.listSlaTargets());
  } catch (err) {
    next(err);
  }
}

export async function updateSlaTargetHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = priorityParamSchema.safeParse(req.params.priority);
    if (!result.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid priority');
    }
    res.json(await slaTargetsService.updateSlaTarget(result.data as TicketPriority, req.body));
  } catch (err) {
    next(err);
  }
}
```

`backend/src/routes/slaTargets.routes.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { listSlaTargetsHandler, updateSlaTargetHandler } from '../controllers/slaTargets.controller';

const updateSlaTargetSchema = z.object({
  responseMinutes: z.number().int().positive().optional(),
  resolutionMinutes: z.number().int().positive().optional(),
});

export const slaTargetsRouter = Router();

slaTargetsRouter.use(authenticate);
slaTargetsRouter.get('/', listSlaTargetsHandler);
slaTargetsRouter.patch('/:priority', authorize('ADMIN'), validate(updateSlaTargetSchema), updateSlaTargetHandler);
```

`backend/src/app.ts` (full file):

```ts
import express, { Express } from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth.routes';
import { usersRouter } from './routes/users.routes';
import { departmentsRouter } from './routes/departments.routes';
import { customersRouter } from './routes/customers.routes';
import { ticketCategoriesRouter } from './routes/ticketCategories.routes';
import { ticketsRouter } from './routes/tickets.routes';
import { tasksRouter } from './routes/tasks.routes';
import { quickRepliesRouter } from './routes/quickReplies.routes';
import { ticketEventsRouter } from './routes/ticketEvents.routes';
import { publicTicketsRouter } from './routes/publicTickets.routes';
import { slaTargetsRouter } from './routes/slaTargets.routes';

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/departments', departmentsRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/ticket-categories', ticketCategoriesRouter);
  app.use('/api/tickets', ticketsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/quick-replies', quickRepliesRouter);
  app.use('/api/ticket-events', ticketEventsRouter);
  app.use('/api/public/tickets', publicTicketsRouter);
  app.use('/api/sla-targets', slaTargetsRouter);

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 7: Seed default targets**

`backend/prisma/seed.ts` (full file):

```ts
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
```

Note: `seedSlaTargets` now runs unconditionally (not inside the admin-user's `if (existing) { return; }` early-return) — it always ensures the four rows exist, whether or not this is a fresh database.

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 9: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/prisma/seed.ts backend/tests/setup.ts backend/src/services/slaTargets.service.ts backend/src/controllers/slaTargets.controller.ts backend/src/routes/slaTargets.routes.ts backend/src/app.ts backend/tests/routes/slaTargets.test.ts
git commit -m "feat(backend): add SLA target schema, seed defaults, and admin CRUD endpoints"
```

---

### Task 2: SLA status computation, wired into ticket reads

**Files:**
- Create: `backend/src/services/sla.service.ts`
- Modify: `backend/src/controllers/tickets.controller.ts` (attach SLA status to list/get responses)
- Test: `backend/tests/services/sla.service.test.ts`
- Modify: `backend/tests/routes/tickets.test.ts` (append SLA integration assertions)

**Interfaces:**
- Consumes: `prisma` (Foundation); `TicketWithRelations`/`TicketDetail` shapes (Ticket Management, unchanged).
- Produces: `attachSlaStatus<T extends { id, createdAt, priority, status }>(tickets: T[]): Promise<(T & { sla: SlaStatus | null })[]>` (`backend/src/services/sla.service.ts`). Consumed by `tickets.controller.ts`'s list/get handlers in this task, and (read-only, via the same `GET /api/tickets` response shape) by Task 6's frontend `BreachedTicketsWidget`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/services/sla.service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';
import { attachSlaStatus } from '../../src/services/sla.service';
import type { TicketPriority } from '@prisma/client';

async function createStaff() {
  return prisma.user.create({
    data: {
      email: `staff-${Math.random()}@example.com`,
      passwordHash: await hashPassword('password123'),
      fullName: 'Staff User',
      role: 'AGENT',
    },
  });
}

async function createCustomerFixture() {
  return prisma.customer.create({ data: { fullName: 'Jane Customer' } });
}

async function seedTarget(priority: TicketPriority, responseMinutes: number, resolutionMinutes: number) {
  return prisma.slaTarget.create({ data: { priority, responseMinutes, resolutionMinutes } });
}

describe('attachSlaStatus', () => {
  it('returns sla: null when no target exists for the ticket priority', async () => {
    const staff = await createStaff();
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Test', description: 'Test', customerId: customer.id, createdById: staff.id, priority: 'HIGH' },
    });

    const [result] = await attachSlaStatus([ticket]);
    expect(result.sla).toBeNull();
  });

  it('marks both clocks PENDING when neither is due yet and nothing has happened', async () => {
    await seedTarget('HIGH', 60, 480);
    const staff = await createStaff();
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Test', description: 'Test', customerId: customer.id, createdById: staff.id, priority: 'HIGH' },
    });

    const [result] = await attachSlaStatus([ticket]);
    expect(result.sla!.response.status).toBe('PENDING');
    expect(result.sla!.resolution.status).toBe('PENDING');
  });

  it('marks the response clock MET when a note was added before the due time', async () => {
    await seedTarget('HIGH', 60, 480);
    const staff = await createStaff();
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: {
        subject: 'Test',
        description: 'Test',
        customerId: customer.id,
        createdById: staff.id,
        priority: 'HIGH',
        createdAt: new Date(Date.now() - 30 * 60_000),
      },
    });
    await prisma.ticketEvent.create({
      data: { ticketId: ticket.id, type: 'NOTE_ADDED', note: 'Responded', authorId: staff.id },
    });

    const [result] = await attachSlaStatus([ticket]);
    expect(result.sla!.response.status).toBe('MET');
    expect(result.sla!.response.respondedAt).not.toBeNull();
  });

  it('marks the response clock BREACHED when still open past its due time', async () => {
    await seedTarget('URGENT', 15, 120);
    const staff = await createStaff();
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: {
        subject: 'Test',
        description: 'Test',
        customerId: customer.id,
        createdById: staff.id,
        priority: 'URGENT',
        createdAt: new Date(Date.now() - 30 * 60_000),
      },
    });

    const [result] = await attachSlaStatus([ticket]);
    expect(result.sla!.response.status).toBe('BREACHED');
  });

  it('marks the resolution clock MET when the ticket was resolved before its due time', async () => {
    await seedTarget('MEDIUM', 240, 60);
    const staff = await createStaff();
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: {
        subject: 'Test',
        description: 'Test',
        customerId: customer.id,
        createdById: staff.id,
        priority: 'MEDIUM',
        status: 'RESOLVED',
      },
    });
    await prisma.ticketEvent.create({
      data: { ticketId: ticket.id, type: 'STATUS_CHANGED', oldValue: 'OPEN', newValue: 'RESOLVED', authorId: staff.id },
    });

    const [result] = await attachSlaStatus([ticket]);
    expect(result.sla!.resolution.status).toBe('MET');
  });

  it('marks the resolution clock BREACHED when resolved after its due time', async () => {
    await seedTarget('MEDIUM', 240, 10);
    const staff = await createStaff();
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: {
        subject: 'Test',
        description: 'Test',
        customerId: customer.id,
        createdById: staff.id,
        priority: 'MEDIUM',
        status: 'RESOLVED',
        createdAt: new Date(Date.now() - 60 * 60_000),
      },
    });
    await prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'STATUS_CHANGED',
        oldValue: 'OPEN',
        newValue: 'RESOLVED',
        authorId: staff.id,
        createdAt: new Date(),
      },
    });

    const [result] = await attachSlaStatus([ticket]);
    expect(result.sla!.resolution.status).toBe('BREACHED');
  });

  it('computes sla status independently for multiple tickets in a single call', async () => {
    await seedTarget('LOW', 480, 4320);
    const staff = await createStaff();
    const customer = await createCustomerFixture();
    const tickets = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        prisma.ticket.create({
          data: {
            subject: `Ticket ${i}`,
            description: 'Test',
            customerId: customer.id,
            createdById: staff.id,
            priority: 'LOW',
          },
        })
      )
    );

    const results = await attachSlaStatus(tickets);
    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.sla!.response.status).toBe('PENDING');
      expect(result.sla!.resolution.status).toBe('PENDING');
    }
  });
});
```

Append to `backend/tests/routes/tickets.test.ts` (new `describe` block, same file/imports/helpers already present):

```ts
describe('ticket SLA status', () => {
  it('includes computed sla status when a target exists for the ticket priority', async () => {
    const { user, token } = await createStaff('AGENT', 'sla-agent@example.com');
    const customer = await createCustomerFixture();
    await prisma.slaTarget.create({ data: { priority: 'MEDIUM', responseMinutes: 240, resolutionMinutes: 1440 } });
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id, priority: 'MEDIUM' },
    });

    const listRes = await request(app).get('/api/tickets').set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    const listed = listRes.body.find((t: { id: string }) => t.id === ticket.id);
    expect(listed.sla.response.status).toBe('PENDING');
    expect(listed.sla.resolution.status).toBe('PENDING');

    const detailRes = await request(app).get(`/api/tickets/${ticket.id}`).set('Authorization', `Bearer ${token}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.sla.response.dueAt).toEqual(expect.any(String));
  });

  it('returns sla: null when no target exists for the ticket priority', async () => {
    const { user, token } = await createStaff('AGENT', 'sla-agent2@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id, priority: 'URGENT' },
    });

    const res = await request(app).get(`/api/tickets/${ticket.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.sla).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run tests/services/sla.service.test.ts tests/routes/tickets.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/sla.service'`, and the new `tickets.test.ts` assertions fail since `res.body.sla` is `undefined`.

- [ ] **Step 3: Implement**

`backend/src/services/sla.service.ts`:

```ts
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
    const resolvedAt = resolutionByTicket.get(ticket.id) ?? null;

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
```

`backend/src/controllers/tickets.controller.ts` — modify only `listTicketsHandler` and `getTicketHandler`, and add the new import (every other handler in the file is unchanged):

```ts
import { Request, Response, NextFunction } from 'express';
import { TicketStatus } from '@prisma/client';
import * as ticketsService from '../services/tickets.service';
import { attachSlaStatus } from '../services/sla.service';

export async function listTicketsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, assigneeId, departmentId, categoryId, unassigned, escalated } = req.query;
    const tickets = await ticketsService.listTickets({
      status: status as TicketStatus | undefined,
      assigneeId: assigneeId as string | undefined,
      departmentId: departmentId as string | undefined,
      categoryId: categoryId as string | undefined,
      unassigned: unassigned === 'true',
      escalated: escalated === 'true',
    });
    res.json(await attachSlaStatus(tickets));
  } catch (err) {
    next(err);
  }
}

export async function getTicketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const ticket = await ticketsService.getTicketById(req.params.id as string);
    const [withSla] = await attachSlaStatus([ticket]);
    res.json(withSla);
  } catch (err) {
    next(err);
  }
}
```

(the rest of `tickets.controller.ts` — `createTicketHandler`, `updateTicketHandler`, `assignTicketHandler`, `escalateTicketHandler`, `unescalateTicketHandler`, `addTicketNoteHandler` — is unchanged; only add the `attachSlaStatus` import and replace the two handlers shown above)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sla.service.ts backend/src/controllers/tickets.controller.ts backend/tests/services/sla.service.test.ts backend/tests/routes/tickets.test.ts
git commit -m "feat(backend): compute and attach SLA status to ticket list/detail responses"
```

---

## Frontend

### Task 3: SLA Targets admin page

**Files:**
- Create: `frontend/src/api/slaTargets.ts`
- Create: `frontend/src/views/slaTargets/SlaTargetListView.vue`
- Modify: `frontend/src/router/index.ts` (add `sla-targets` route, `ADMIN`-only)
- Modify: `frontend/src/layouts/AppShell.vue` (add nav item)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (add `slaTargets` namespace, extend `nav`)
- Modify: `frontend/tests/layouts/AppShell.test.ts` (register the new route in both test router tables — see Global Constraints in the Agent Dashboard plan for why: a rendered `:to` nav item needs its route registered in the test's router table or the mount throws)
- Test: `frontend/tests/views/slaTargets/SlaTargetListView.test.ts`

**Interfaces:**
- Consumes: `apiClient` (Foundation).
- Produces: `fetchSlaTargets`, `updateSlaTarget`, `ApiSlaTarget` (`frontend/src/api/slaTargets.ts`) — used only by this admin page in this plan.

- [ ] **Step 1: Write the failing test**

`frontend/tests/views/slaTargets/SlaTargetListView.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/slaTargets', () => ({
  fetchSlaTargets: vi.fn(),
  updateSlaTarget: vi.fn(),
}));

import { fetchSlaTargets } from '../../../src/api/slaTargets';
import SlaTargetListView from '../../../src/views/slaTargets/SlaTargetListView.vue';

describe('SlaTargetListView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchSlaTargets).mockResolvedValue([
      { priority: 'URGENT', responseMinutes: 15, resolutionMinutes: 120 },
      { priority: 'HIGH', responseMinutes: 60, resolutionMinutes: 480 },
      { priority: 'MEDIUM', responseMinutes: 240, resolutionMinutes: 1440 },
      { priority: 'LOW', responseMinutes: 480, resolutionMinutes: 4320 },
    ]);
  });

  it('renders the four seeded targets', async () => {
    const wrapper = mountWithPlugins(SlaTargetListView);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('URGENT');
    expect(wrapper.text()).toContain('15');
    expect(wrapper.text()).toContain('4320');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/views/slaTargets/SlaTargetListView.test.ts`
Expected: FAIL — `Cannot find module '../../../src/api/slaTargets'`.

- [ ] **Step 3: Implement the API module and the view**

`frontend/src/api/slaTargets.ts`:

```ts
import { apiClient } from './client';

export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface ApiSlaTarget {
  priority: TicketPriority;
  responseMinutes: number;
  resolutionMinutes: number;
}

export async function fetchSlaTargets(): Promise<ApiSlaTarget[]> {
  const res = await apiClient.get('/sla-targets');
  return res.data;
}

export async function updateSlaTarget(
  priority: TicketPriority,
  data: Partial<{ responseMinutes: number; resolutionMinutes: number }>
): Promise<ApiSlaTarget> {
  const res = await apiClient.patch(`/sla-targets/${priority}`, data);
  return res.data;
}
```

`frontend/src/views/slaTargets/SlaTargetListView.vue`:

```vue
<template>
  <v-container fluid>
    <h1 class="mb-4">{{ $t('slaTargets.title') }}</h1>

    <v-data-table :items="targets" :headers="headers">
      <template #item.actions="{ item }">
        <v-btn size="small" variant="text" @click="openEdit(item)">Edit</v-btn>
      </template>
    </v-data-table>

    <v-dialog v-model="dialogOpen" max-width="480">
      <v-card :title="$t('slaTargets.editTitle', { priority: editingPriority })">
        <v-card-text>
          <form @submit.prevent="submit">
            <v-text-field
              v-model.number="form.responseMinutes"
              type="number"
              :label="$t('slaTargets.responseMinutes')"
            />
            <v-text-field
              v-model.number="form.resolutionMinutes"
              type="number"
              :label="$t('slaTargets.resolutionMinutes')"
            />
            <v-btn type="submit" color="primary">Save</v-btn>
          </form>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { fetchSlaTargets, updateSlaTarget, type ApiSlaTarget, type TicketPriority } from '../../api/slaTargets';

const targets = ref<ApiSlaTarget[]>([]);
const dialogOpen = ref(false);
const editingPriority = ref<TicketPriority | null>(null);

const headers = [
  { title: 'Priority', key: 'priority' },
  { title: 'Response target (min)', key: 'responseMinutes' },
  { title: 'Resolution target (min)', key: 'resolutionMinutes' },
  { title: '', key: 'actions', sortable: false },
];

const form = reactive({ responseMinutes: 0, resolutionMinutes: 0 });

async function load() {
  targets.value = await fetchSlaTargets();
}

function openEdit(item: ApiSlaTarget) {
  editingPriority.value = item.priority;
  Object.assign(form, { responseMinutes: item.responseMinutes, resolutionMinutes: item.resolutionMinutes });
  dialogOpen.value = true;
}

async function submit() {
  if (!editingPriority.value) return;
  await updateSlaTarget(editingPriority.value, { ...form });
  dialogOpen.value = false;
  await load();
}

onMounted(load);
</script>
```

- [ ] **Step 4: Add locale keys**

`frontend/src/locales/en.json` — add a new top-level `slaTargets` key (place it after `quickReplies`), and extend `nav`:

```json
"nav": { "home": "Home", "tickets": "Tickets", "users": "Users", "departments": "Departments", "ticketCategories": "Ticket Categories", "quickReplies": "Quick Replies", "slaTargets": "SLA Targets", "logout": "Logout" },
```

```json
"slaTargets": {
  "title": "SLA Targets",
  "editTitle": "Edit {priority} target",
  "responseMinutes": "Response target (minutes)",
  "resolutionMinutes": "Resolution target (minutes)"
}
```

`frontend/src/locales/ar.json`:

```json
"nav": { "home": "الرئيسية", "tickets": "التذاكر", "users": "المستخدمون", "departments": "الأقسام", "ticketCategories": "فئات التذاكر", "quickReplies": "الردود السريعة", "slaTargets": "أهداف اتفاقية مستوى الخدمة", "logout": "تسجيل الخروج" },
```

```json
"slaTargets": {
  "title": "أهداف اتفاقية مستوى الخدمة",
  "editTitle": "تعديل هدف {priority}",
  "responseMinutes": "هدف الاستجابة (دقائق)",
  "resolutionMinutes": "هدف الحل (دقائق)"
}
```

- [ ] **Step 5: Wire up the route and nav item**

`frontend/src/router/index.ts` — add the import and the new child route (rest of the file unchanged from its current version — the last child route is currently `quick-replies`):

```ts
import SlaTargetListView from '../views/slaTargets/SlaTargetListView.vue';
```

```ts
{
  path: 'sla-targets',
  name: 'sla-targets',
  component: SlaTargetListView,
  meta: { roles: ['ADMIN'] },
},
```

(add this object to the `children` array, after the `quick-replies` entry).

`frontend/src/layouts/AppShell.vue` — add one nav item after the existing `quickReplies` one:

```vue
<v-list-item v-if="isAdmin" :title="$t('nav.slaTargets')" :to="{ name: 'sla-targets' }" />
```

`frontend/tests/layouts/AppShell.test.ts` — add `{ path: '/sla-targets', name: 'sla-targets', component: { template: '<div />' } }` to **both** route arrays passed to `mountWithPlugins` in that file.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/slaTargets.ts frontend/src/views/slaTargets/SlaTargetListView.vue frontend/src/router/index.ts frontend/src/layouts/AppShell.vue frontend/src/locales/en.json frontend/src/locales/ar.json frontend/tests/layouts/AppShell.test.ts frontend/tests/views/slaTargets/SlaTargetListView.test.ts
git commit -m "feat(frontend): add admin SLA targets management page"
```

---

### Task 4: SLA chip on the ticket list

**Files:**
- Modify: `frontend/src/api/tickets.ts` (add SLA types, optional `sla` field on `ApiTicketSummary`)
- Modify: `frontend/src/views/tickets/TicketListView.vue` (SLA column + chip)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (extend `tickets`)
- Modify: `frontend/tests/views/tickets/TicketListView.test.ts` (append a test)

**Interfaces:**
- Consumes: nothing new.
- Produces: `SlaClockStatus`, `ApiSlaClock`, `ApiSlaStatus` types (`frontend/src/api/tickets.ts`) — consumed by Task 5 (`TicketDetailView.vue`, via `ApiTicketDetail` which extends `ApiTicketSummary`) and Task 6 (`BreachedTicketsWidget.vue`).

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/views/tickets/TicketListView.test.ts` (new `it` inside the existing `describe` block, after the existing test):

```ts
  it('shows an SLA chip reflecting the worse of the response/resolution clocks', async () => {
    vi.mocked(fetchTickets).mockResolvedValue([
      {
        id: '1',
        subject: 'Cannot log in',
        status: 'OPEN',
        priority: 'HIGH',
        isEscalated: false,
        customer: { id: 'c1', fullName: 'Jane Customer' },
        category: null,
        department: null,
        assignee: null,
        createdAt: '2026-08-27T00:00:00.000Z',
        sla: {
          response: { dueAt: '2026-08-26T00:00:00.000Z', respondedAt: null, status: 'BREACHED' },
          resolution: { dueAt: '2026-08-28T00:00:00.000Z', resolvedAt: null, status: 'PENDING' },
        },
      },
      {
        id: '2',
        subject: 'Billing question',
        status: 'OPEN',
        priority: 'LOW',
        isEscalated: false,
        customer: { id: 'c2', fullName: 'Bob Customer' },
        category: null,
        department: null,
        assignee: null,
        createdAt: '2026-08-27T00:00:00.000Z',
        sla: {
          response: { dueAt: '2099-01-01T00:00:00.000Z', respondedAt: null, status: 'PENDING' },
          resolution: { dueAt: '2099-01-01T00:00:00.000Z', resolvedAt: null, status: 'PENDING' },
        },
      },
    ]);

    const wrapper = mountWithPlugins(TicketListView, {}, [
      { path: '/', component: { template: '<div />' } },
      { path: '/tickets/:id', name: 'ticket-detail', component: { template: '<div />' } },
      { path: '/tickets/new', name: 'ticket-new', component: { template: '<div />' } },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('SLA Breached');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/views/tickets/TicketListView.test.ts`
Expected: FAIL — `sla` isn't rendered anywhere yet, so the text assertion fails.

- [ ] **Step 3: Implement the API additions and the view**

`frontend/src/api/tickets.ts` — add these types near the top of the file (after the existing `TicketEventType` type) and widen `ApiTicketSummary` (rest of the file unchanged):

```ts
export type SlaClockStatus = 'PENDING' | 'MET' | 'BREACHED';

export interface ApiSlaClock {
  dueAt: string;
  respondedAt?: string | null;
  resolvedAt?: string | null;
  status: SlaClockStatus;
}

export interface ApiSlaStatus {
  response: ApiSlaClock;
  resolution: ApiSlaClock;
}
```

```ts
export interface ApiTicketSummary {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  isEscalated: boolean;
  customer: { id: string; fullName: string };
  category: { id: string; nameEn: string; nameAr: string } | null;
  department: { id: string; nameEn: string; nameAr: string } | null;
  assignee: { id: string; fullName: string; role: string } | null;
  createdAt: string;
  sla?: ApiSlaStatus | null;
}
```

`frontend/src/views/tickets/TicketListView.vue` (full file):

```vue
<template>
  <v-container fluid>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1>{{ $t('tickets.title') }}</h1>
      <v-btn color="primary" :to="{ name: 'ticket-new' }">{{ $t('tickets.create') }}</v-btn>
    </div>

    <v-select
      v-model="statusFilter"
      :items="statusOptions"
      :label="$t('tickets.filterStatus')"
      clearable
      class="mb-4"
      style="max-width: 240px"
      @update:model-value="load"
    />

    <v-data-table :items="tickets" :headers="headers" @click:row="goToTicket">
      <template #item.customer="{ item }">{{ item.customer.fullName }}</template>
      <template #item.assignee="{ item }">{{ item.assignee?.fullName ?? '-' }}</template>
      <template #item.isEscalated="{ item }">
        <v-chip v-if="item.isEscalated" color="error" size="small">{{ $t('tickets.escalated') }}</v-chip>
      </template>
      <template #item.sla="{ item }">
        <v-chip v-if="slaStatusLabel(item)" :color="slaStatusColor(item)" size="small">
          {{ slaStatusLabel(item) }}
        </v-chip>
      </template>
    </v-data-table>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { fetchTickets, type ApiTicketSummary, type TicketStatus, type SlaClockStatus } from '../../api/tickets';

const router = useRouter();
const { t } = useI18n();
const tickets = ref<ApiTicketSummary[]>([]);
const statusFilter = ref<TicketStatus | null>(null);

const statusOptions: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

const headers = [
  { title: 'Subject', key: 'subject' },
  { title: 'Customer', key: 'customer' },
  { title: 'Status', key: 'status' },
  { title: 'Priority', key: 'priority' },
  { title: 'Assignee', key: 'assignee' },
  { title: '', key: 'isEscalated', sortable: false },
  { title: 'SLA', key: 'sla', sortable: false },
];

interface WorstClock {
  status: SlaClockStatus;
  dueAt: string;
}

function worstSlaClock(ticket: ApiTicketSummary): WorstClock | null {
  if (!ticket.sla) return null;
  const { response, resolution } = ticket.sla;
  if (response.status === 'BREACHED') return { status: 'BREACHED', dueAt: response.dueAt };
  if (resolution.status === 'BREACHED') return { status: 'BREACHED', dueAt: resolution.dueAt };
  if (response.status === 'PENDING') return { status: 'PENDING', dueAt: response.dueAt };
  if (resolution.status === 'PENDING') return { status: 'PENDING', dueAt: resolution.dueAt };
  return { status: 'MET', dueAt: response.dueAt };
}

function slaStatusLabel(ticket: ApiTicketSummary): string | null {
  const worst = worstSlaClock(ticket);
  if (!worst) return null;
  if (worst.status === 'MET') return t('tickets.slaMet');
  if (worst.status === 'PENDING') {
    const minutes = Math.round((new Date(worst.dueAt).getTime() - Date.now()) / 60000);
    return minutes >= 0 ? t('tickets.slaMinutesLeft', { minutes }) : t('tickets.slaBreached');
  }
  return t('tickets.slaBreached');
}

function slaStatusColor(ticket: ApiTicketSummary): string {
  const worst = worstSlaClock(ticket);
  if (!worst) return 'default';
  if (worst.status === 'BREACHED') return 'error';
  if (worst.status === 'MET') return 'success';
  return 'default';
}

async function load() {
  tickets.value = await fetchTickets(statusFilter.value ? { status: statusFilter.value } : {});
}

function goToTicket(_event: Event, row: { item: ApiTicketSummary }) {
  router.push({ name: 'ticket-detail', params: { id: row.item.id } });
}

onMounted(load);
</script>
```

- [ ] **Step 4: Add locale keys**

`frontend/src/locales/en.json` — add these three keys inside the existing `tickets` object, after `insertQuickReply`:

```json
"slaMet": "SLA Met",
"slaBreached": "SLA Breached",
"slaMinutesLeft": "{minutes}m left"
```

`frontend/src/locales/ar.json` — same position, inside the existing `tickets` object, after `insertQuickReply`:

```json
"slaMet": "تم الوفاء باتفاقية مستوى الخدمة",
"slaBreached": "تم خرق اتفاقية مستوى الخدمة",
"slaMinutesLeft": "متبقي {minutes} د"
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/tickets.ts frontend/src/views/tickets/TicketListView.vue frontend/src/locales/en.json frontend/src/locales/ar.json frontend/tests/views/tickets/TicketListView.test.ts
git commit -m "feat(frontend): show an SLA status chip on the ticket list"
```

---

### Task 5: SLA breakdown on the ticket detail page

**Files:**
- Modify: `frontend/src/views/tickets/TicketDetailView.vue` (response/resolution breakdown section)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (extend `tickets`)
- Modify: `frontend/tests/views/tickets/TicketDetailView.test.ts` (append a test)

**Interfaces:**
- Consumes: `SlaClockStatus`, `ApiSlaStatus` (Task 4) via `ApiTicketDetail` (which extends `ApiTicketSummary`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/views/tickets/TicketDetailView.test.ts`, inside the existing `describe('TicketDetailView', ...)` block, after the last existing `it(...)`:

```ts
  it('shows the response and resolution SLA breakdown when sla data is present', async () => {
    vi.mocked(fetchTicket).mockResolvedValue({
      ...baseTicket,
      sla: {
        response: { dueAt: '2026-08-27T05:00:00.000Z', respondedAt: null, status: 'BREACHED' },
        resolution: { dueAt: '2026-08-28T00:00:00.000Z', resolvedAt: null, status: 'PENDING' },
      },
    });

    const wrapper = mountWithPlugins(
      TicketDetailView,
      { global: { mocks: { $route: { params: { id: 'ticket-1' } } } } },
      [{ path: '/', component: { template: '<div />' } }]
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('SLA Breached');
    expect(wrapper.text()).toContain('Pending');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/views/tickets/TicketDetailView.test.ts`
Expected: FAIL — no SLA breakdown is rendered yet, so the text assertions fail.

- [ ] **Step 3: Implement**

`frontend/src/views/tickets/TicketDetailView.vue` — add this block inside the `<v-col cols="12" md="4">` column, right after the existing `<v-list density="compact" class="mt-4">...</v-list>` block that shows Customer/Created by (i.e. as a new sibling `<v-list>` immediately following it, still inside the same `<v-col>`):

```vue
<v-list v-if="ticket.sla" density="compact" class="mt-4">
  <v-list-item :title="$t('tickets.slaResponse')">
    <template #subtitle>
      <v-chip size="small" :color="slaColor(ticket.sla.response.status)">
        {{ slaLabel(ticket.sla.response.status) }}
      </v-chip>
      <span class="ml-2 text-caption">
        {{ $t('tickets.slaDueAt') }}: {{ new Date(ticket.sla.response.dueAt).toLocaleString() }}
      </span>
    </template>
  </v-list-item>
  <v-list-item :title="$t('tickets.slaResolution')">
    <template #subtitle>
      <v-chip size="small" :color="slaColor(ticket.sla.resolution.status)">
        {{ slaLabel(ticket.sla.resolution.status) }}
      </v-chip>
      <span class="ml-2 text-caption">
        {{ $t('tickets.slaDueAt') }}: {{ new Date(ticket.sla.resolution.dueAt).toLocaleString() }}
      </span>
    </template>
  </v-list-item>
</v-list>
```

Add to the `<script setup>` block — extend the existing import line from `../../api/tickets` to also bring in `SlaClockStatus`, and add the two helper functions (place them near `describeEvent`):

```ts
import {
  fetchTicket,
  updateTicket,
  assignTicket,
  escalateTicket,
  unescalateTicket,
  addTicketNote,
  type ApiTicketDetail,
  type ApiTicketEvent,
  type TicketStatus,
  type TicketPriority,
  type SlaClockStatus,
} from '../../api/tickets';
```

```ts
function slaLabel(status: SlaClockStatus): string {
  if (status === 'BREACHED') return t('tickets.slaBreached');
  if (status === 'MET') return t('tickets.slaMet');
  return t('tickets.slaPending');
}

function slaColor(status: SlaClockStatus): string {
  if (status === 'BREACHED') return 'error';
  if (status === 'MET') return 'success';
  return 'default';
}
```

- [ ] **Step 4: Add locale keys**

`frontend/src/locales/en.json` — add these four keys inside the existing `tickets` object, after `slaMinutesLeft` (added by Task 4):

```json
"slaPending": "Pending",
"slaResponse": "Response",
"slaResolution": "Resolution",
"slaDueAt": "Due"
```

`frontend/src/locales/ar.json` — same position:

```json
"slaPending": "قيد الانتظار",
"slaResponse": "الاستجابة",
"slaResolution": "الحل",
"slaDueAt": "الموعد النهائي"
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/tickets/TicketDetailView.vue frontend/src/locales/en.json frontend/src/locales/ar.json frontend/tests/views/tickets/TicketDetailView.test.ts
git commit -m "feat(frontend): show the response/resolution SLA breakdown on the ticket detail page"
```

---

### Task 6: Breached Tickets dashboard widget

**Files:**
- Create: `frontend/src/components/dashboard/BreachedTicketsWidget.vue`
- Modify: `frontend/src/views/DashboardView.vue` (add the widget to the Supervisor/Admin section)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (extend `dashboard`)
- Modify: `frontend/tests/views/DashboardView.test.ts` (append/extend tests)

**Interfaces:**
- Consumes: `fetchTickets`, `ApiTicketSummary` with its `sla` field (Task 4).
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/views/DashboardView.test.ts`:

```ts
  it('shows only breached tickets in the Breached Tickets widget for a supervisor', async () => {
    loginAs('SUPERVISOR');
    vi.mocked(fetchTickets).mockImplementation(async (filters = {}) => {
      if (filters.unassigned || filters.escalated || filters.status) return [];
      return [
        {
          id: 'b1',
          subject: 'Breached ticket',
          status: 'OPEN',
          priority: 'URGENT',
          isEscalated: false,
          customer: { id: 'c1', fullName: 'Breached Customer' },
          category: null,
          department: null,
          assignee: null,
          createdAt: new Date().toISOString(),
          sla: {
            response: { dueAt: new Date(Date.now() - 60_000).toISOString(), respondedAt: null, status: 'BREACHED' },
            resolution: { dueAt: new Date(Date.now() + 60_000).toISOString(), resolvedAt: null, status: 'PENDING' },
          },
        },
        {
          id: 'ok1',
          subject: 'On track ticket',
          status: 'OPEN',
          priority: 'LOW',
          isEscalated: false,
          customer: { id: 'c2', fullName: 'OnTrack Customer' },
          category: null,
          department: null,
          assignee: null,
          createdAt: new Date().toISOString(),
          sla: {
            response: { dueAt: new Date(Date.now() + 60_000).toISOString(), respondedAt: null, status: 'PENDING' },
            resolution: { dueAt: new Date(Date.now() + 120_000).toISOString(), resolvedAt: null, status: 'PENDING' },
          },
        },
      ];
    });

    const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    const widget = wrapper.find('[data-testid="breached-tickets-widget"]');
    expect(widget.text()).toContain('Breached ticket');
    expect(widget.text()).not.toContain('On track ticket');
  });
```

Also modify the existing `it('does not render team-wide widgets for an agent', ...)` test — add one more assertion line after the existing three `expect(...).exists()).toBe(false)` lines:

```ts
    expect(wrapper.find('[data-testid="breached-tickets-widget"]').exists()).toBe(false);
```

And modify the existing `it('shows error states across all supervisor widgets when their fetches fail', ...)` test — add `'breached-tickets-widget'` to the array of testids it loops over:

```ts
    for (const testid of [
      'my-tickets-widget',
      'my-tasks-widget',
      'team-activity-widget',
      'unassigned-queue-widget',
      'escalated-tickets-widget',
      'team-workload-widget',
      'breached-tickets-widget',
    ]) {
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run tests/views/DashboardView.test.ts`
Expected: FAIL — `[data-testid="breached-tickets-widget"]` doesn't exist yet.

- [ ] **Step 3: Implement**

`frontend/src/components/dashboard/BreachedTicketsWidget.vue`:

```vue
<template>
  <v-card data-testid="breached-tickets-widget">
    <v-card-title>{{ $t('dashboard.breachedTickets') }}</v-card-title>
    <v-card-text>
      <v-alert v-if="error" type="error" density="compact" data-testid="widget-error">
        {{ $t('dashboard.loadError') }}
      </v-alert>
      <v-list v-else-if="tickets.length" density="compact">
        <v-list-item
          v-for="ticket in tickets"
          :key="ticket.id"
          :title="ticket.subject"
          :subtitle="ticket.customer.fullName"
          :to="{ name: 'ticket-detail', params: { id: ticket.id } }"
        />
      </v-list>
      <p v-else class="text-medium-emphasis">{{ $t('dashboard.noBreached') }}</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchTickets, type ApiTicketSummary } from '../../api/tickets';

const tickets = ref<ApiTicketSummary[]>([]);
const error = ref(false);

function isBreached(ticket: ApiTicketSummary): boolean {
  return ticket.sla?.response.status === 'BREACHED' || ticket.sla?.resolution.status === 'BREACHED';
}

onMounted(async () => {
  try {
    const all = await fetchTickets({});
    tickets.value = all.filter(isBreached);
  } catch {
    error.value = true;
  }
});
</script>
```

`frontend/src/views/DashboardView.vue` (full file):

```vue
<template>
  <v-container fluid>
    <h1 class="mb-4">{{ $t('dashboard.title') }}</h1>
    <v-row>
      <v-col cols="12" md="6">
        <MyTicketsWidget />
      </v-col>
      <v-col cols="12" md="6">
        <MyTasksWidget />
      </v-col>
    </v-row>
    <v-row>
      <v-col cols="12">
        <TeamActivityWidget />
      </v-col>
    </v-row>
    <v-row v-if="isSupervisorOrAdmin">
      <v-col cols="12" md="4">
        <UnassignedQueueWidget />
      </v-col>
      <v-col cols="12" md="4">
        <EscalatedTicketsWidget />
      </v-col>
      <v-col cols="12" md="4">
        <TeamWorkloadWidget />
      </v-col>
    </v-row>
    <v-row v-if="isSupervisorOrAdmin">
      <v-col cols="12">
        <BreachedTicketsWidget />
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MyTicketsWidget from '../components/dashboard/MyTicketsWidget.vue';
import MyTasksWidget from '../components/dashboard/MyTasksWidget.vue';
import TeamActivityWidget from '../components/dashboard/TeamActivityWidget.vue';
import UnassignedQueueWidget from '../components/dashboard/UnassignedQueueWidget.vue';
import EscalatedTicketsWidget from '../components/dashboard/EscalatedTicketsWidget.vue';
import TeamWorkloadWidget from '../components/dashboard/TeamWorkloadWidget.vue';
import BreachedTicketsWidget from '../components/dashboard/BreachedTicketsWidget.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const isSupervisorOrAdmin = computed(
  () => auth.currentUser?.role === 'ADMIN' || auth.currentUser?.role === 'SUPERVISOR'
);
</script>
```

- [ ] **Step 4: Add locale keys**

`frontend/src/locales/en.json` — extend the existing `dashboard` object with two new keys (place them anywhere in that object, e.g. after `noWorkload`):

```json
"breachedTickets": "Breached Tickets",
"noBreached": "No breached tickets."
```

`frontend/src/locales/ar.json`:

```json
"breachedTickets": "التذاكر المخالفة لاتفاقية الخدمة",
"noBreached": "لا توجد تذاكر مخالفة."
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all tests). This completes the SLA Targets + Visibility sub-project.

- [ ] **Step 6: Manual end-to-end check**

With the backend (`cd backend && npm run dev`) and frontend (`cd frontend && npm run dev`) both running against real Postgres dev/test databases (and `npm run prisma:seed` run at least once so the four default `SlaTarget` rows exist):

1. Log in as Admin. Open the new "SLA Targets" nav item, confirm all four priorities show their seeded defaults, edit URGENT's response target to something small (e.g. 1 minute), save, confirm it persists on reload.
2. Create a new ticket with priority URGENT. Confirm the ticket list shows an SLA chip; wait past the 1-minute target (or re-check after a minute) and confirm the chip flips to "SLA Breached".
3. Open that ticket's detail page, confirm the SLA breakdown section shows both the response and resolution clocks with their due dates.
4. Add a note to a different, on-track ticket and confirm its response clock becomes "SLA Met" (not breached) once its due time passes.
5. Log in as Supervisor (or Admin), confirm the new "Breached Tickets" dashboard widget lists the breached URGENT ticket from step 2.
6. Log in as an Agent (non-admin), confirm there is no "SLA Targets" nav item and no "Breached Tickets" widget on the dashboard.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/dashboard/BreachedTicketsWidget.vue frontend/src/views/DashboardView.vue frontend/src/locales/en.json frontend/src/locales/ar.json frontend/tests/views/DashboardView.test.ts
git commit -m "feat(frontend): add breached tickets dashboard widget"
```

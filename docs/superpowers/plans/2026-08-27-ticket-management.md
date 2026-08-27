# Ticket Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core ticketing engine — a minimal Customer entity, admin-managed Ticket Categories, and Tickets with status/priority/manual assignment/manual escalation, all logged to a unified chronological event timeline — on top of the completed Foundation sub-project.

**Architecture:** Extends Foundation's existing layered pattern with no new top-level structure: backend `routes → controllers → services → Prisma`, frontend `api/ → store/view`. Every mutating ticket action (status/priority/category/department change, assignment, escalation, note) writes a `TicketEvent` row in the same Prisma transaction as the state change, giving one query a full audit trail.

**Tech Stack:** Same as Foundation — Express + TypeScript + Prisma (pinned `6.19.3`) + PostgreSQL backend; Vue 3 + Vuetify + TypeScript + Pinia frontend; Vitest for both (backend against a real test Postgres DB, frontend with the `api/*` layer mocked via the shared `mountWithPlugins` helper).

**Spec:** [docs/superpowers/specs/2026-08-27-ticket-management-design.md](../specs/2026-08-27-ticket-management-design.md)

## Global Constraints

- Fixed enums: `TicketStatus` (OPEN/IN_PROGRESS/RESOLVED/CLOSED), `TicketPriority` (LOW/MEDIUM/HIGH/URGENT). `TicketCategory` is admin-managed data (like `Department`), not an enum.
- No automated assignment or escalation in this phase — only manual actions (Supervisor/Admin assign; Agent claims/releases own assignment; anyone escalates/unescalates with an optional note).
- Every authenticated staff member sees every ticket — no department/assignment-based visibility filtering in this phase.
- `Customer` is a minimal record (`fullName`, optional `email`/`phone`) — no update/delete endpoints, no dedup logic. Customer creation happens only inline via ticket creation's `newCustomer` field in this phase; there is no standalone `POST /api/customers` (nothing in this phase's UI needs it — cut during planning for YAGNI, see Task 2).
- Error responses are always shaped `{ error: { code, message } }` (unchanged from Foundation).
- `prisma`/`@prisma/client` stay pinned to the exact version `6.19.3` (Foundation ruling) — do not `npm install` either unpinned.
- Installed `zod` is v4: `ZodError` has no `.errors` property, use `.issues` (already correct in the existing `validate.ts`, which every task here reuses unchanged — no new zod-version work needed).
- `backend/vitest.config.ts` has `fileParallelism: false` (Foundation ruling, standing strategy) — leave it as-is.
- `frontend/tests/testUtils.ts`'s test-only Vuetify instance has `attach: true` for VMenu/VDialog/VOverlay/VSelect/VAutocomplete/VTooltip — dialogs, selects, and autocompletes in new tests should just work without extra setup.
- A `v-list-item :to="{name: '...'}"` resolves its target **eagerly at render**, not lazily on click (a real vue-router/Vuetify behavior discovered in Foundation, not a bug) — any test that mounts `AppShell.vue` with a role that renders a given nav item MUST have that route registered in the test's router table, or the mount will throw.

---

## Backend

### Task 1: Ticketing schema — Customer, TicketCategory, Ticket, TicketEvent

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/tests/setup.ts`
- Test: `backend/tests/models/ticketSchema.test.ts`

**Interfaces:**
- Produces: Prisma models `Customer`, `TicketCategory`, `Ticket`, `TicketEvent`; enums `TicketStatus`, `TicketPriority`, `TicketEventType`; reverse relations `User.assignedTickets`, `User.createdTickets`, `User.ticketEvents`, `Department.tickets` — consumed by every later task in this plan via `prisma.customer`, `prisma.ticketCategory`, `prisma.ticket`, `prisma.ticketEvent`.

- [ ] **Step 1: Write the failing smoke test**

`backend/tests/models/ticketSchema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';

describe('ticketing schema', () => {
  it('persists a ticket with its relations and an event', async () => {
    const department = await prisma.department.create({ data: { nameEn: 'Support', nameAr: 'الدعم' } });
    const agent = await prisma.user.create({
      data: {
        email: 'agent@example.com',
        passwordHash: await hashPassword('password123'),
        fullName: 'Agent Smith',
        role: 'AGENT',
        departmentId: department.id,
      },
    });
    const customer = await prisma.customer.create({ data: { fullName: 'Jane Customer', email: 'jane@example.com' } });
    const category = await prisma.ticketCategory.create({ data: { nameEn: 'Billing', nameAr: 'الفواتير' } });

    const ticket = await prisma.ticket.create({
      data: {
        subject: 'Cannot log in',
        description: 'Getting an error on login',
        customerId: customer.id,
        categoryId: category.id,
        departmentId: department.id,
        assigneeId: agent.id,
        createdById: agent.id,
      },
    });

    expect(ticket.status).toBe('OPEN');
    expect(ticket.priority).toBe('MEDIUM');
    expect(ticket.isEscalated).toBe(false);

    const event = await prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'NOTE_ADDED',
        note: 'Called the customer back',
        authorId: agent.id,
      },
    });

    expect(event.ticketId).toBe(ticket.id);

    const found = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      include: { events: true, customer: true, category: true, department: true },
    });
    expect(found?.customer.fullName).toBe('Jane Customer');
    expect(found?.category?.nameEn).toBe('Billing');
    expect(found?.department?.nameEn).toBe('Support');
    expect(found?.events).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/models/ticketSchema.test.ts`
Expected: FAIL — `prisma.customer` (and `ticketCategory`/`ticket`/`ticketEvent`) don't exist on the generated Prisma Client yet (`TypeError: Cannot read properties of undefined`).

- [ ] **Step 3: Update the Prisma schema**

`backend/prisma/schema.prisma` (full file, replacing the existing content):

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  AGENT
  SUPERVISOR
  ADMIN
}

enum TicketStatus {
  OPEN
  IN_PROGRESS
  RESOLVED
  CLOSED
}

enum TicketPriority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

enum TicketEventType {
  STATUS_CHANGED
  PRIORITY_CHANGED
  CATEGORY_CHANGED
  DEPARTMENT_CHANGED
  ASSIGNEE_CHANGED
  ESCALATED
  UNESCALATED
  NOTE_ADDED
}

model Department {
  id        String   @id @default(uuid())
  nameEn    String
  nameAr    String
  users     User[]
  tickets   Ticket[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model User {
  id              String        @id @default(uuid())
  email           String        @unique
  passwordHash    String
  fullName        String
  role            Role
  department      Department?   @relation(fields: [departmentId], references: [id])
  departmentId    String?
  isActive        Boolean       @default(true)
  locale          String        @default("en")
  assignedTickets Ticket[]      @relation("TicketAssignee")
  createdTickets  Ticket[]      @relation("TicketCreatedBy")
  ticketEvents    TicketEvent[]
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
}

model Customer {
  id        String   @id @default(uuid())
  fullName  String
  email     String?
  phone     String?
  tickets   Ticket[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model TicketCategory {
  id        String   @id @default(uuid())
  nameEn    String
  nameAr    String
  tickets   Ticket[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Ticket {
  id           String         @id @default(uuid())
  subject      String
  description  String
  status       TicketStatus   @default(OPEN)
  priority     TicketPriority @default(MEDIUM)
  isEscalated  Boolean        @default(false)

  customer     Customer       @relation(fields: [customerId], references: [id])
  customerId   String

  category     TicketCategory? @relation(fields: [categoryId], references: [id])
  categoryId   String?

  department   Department?    @relation(fields: [departmentId], references: [id])
  departmentId String?

  assignee     User?          @relation("TicketAssignee", fields: [assigneeId], references: [id])
  assigneeId   String?

  createdBy    User           @relation("TicketCreatedBy", fields: [createdById], references: [id])
  createdById  String

  events       TicketEvent[]

  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
}

model TicketEvent {
  id        String          @id @default(uuid())
  ticket    Ticket          @relation(fields: [ticketId], references: [id])
  ticketId  String
  type      TicketEventType
  oldValue  String?
  newValue  String?
  note      String?
  author    User            @relation(fields: [authorId], references: [id])
  authorId  String
  createdAt DateTime        @default(now())
}
```

- [ ] **Step 4: Update the test-DB cleanup order**

`backend/tests/setup.ts` (full file — `TicketEvent`/`Ticket` reference `User`/`Department`, so they must be cleared first; `Customer`/`TicketCategory` must clear before `User`/`Department` don't actually depend on them, but must clear after `Ticket` since `Ticket` references them):

```ts
import { beforeEach, afterAll } from 'vitest';
import { config } from 'dotenv';

config({ path: '.env.test' });

import { prisma } from '../src/lib/prisma';

beforeEach(async () => {
  await prisma.ticketEvent.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.ticketCategory.deleteMany();
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
npm run prisma:migrate -- --name add_tickets
```

Expected: a new migration is created and applied against your local `azmcrm` dev DB, and the Prisma Client is regenerated (you'll see `✔ Generated Prisma Client...` in the output). This also needs to run against the **test** database before the test in this task can pass — run:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/azmcrm_test?schema=public" npx prisma migrate deploy
```

(adjust the connection string to match your local `.env.test` if it differs).

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS — all tests, including the new schema smoke test and every pre-existing Foundation test (28 tests → 29 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/tests/setup.ts backend/tests/models
git commit -m "feat(backend): add Customer, TicketCategory, Ticket, TicketEvent schema"
```

---

### Task 2: Customer search endpoint

**Files:**
- Create: `backend/src/services/customers.service.ts`
- Create: `backend/src/controllers/customers.controller.ts`
- Create: `backend/src/routes/customers.routes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/routes/customers.test.ts`

**Interfaces:**
- Consumes: `prisma`, `authenticate` middleware.
- Produces: `GET /api/customers?query=<string>` → `Customer[]` (any authenticated staff, any role). No create/update/delete endpoint exists — nothing in this phase's frontend needs one, since ticket creation (Task 4) creates a `Customer` directly via `prisma.customer.create` inside `tickets.service.ts`, not through this route. (This narrows the design spec's originally-documented `POST /api/customers` — cut here as a YAGNI trim since nothing consumes it; noted as a deliberate plan-time deviation, not an oversight.)

- [ ] **Step 1: Write the failing test**

`backend/tests/routes/customers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';
import { signToken } from '../../src/lib/jwt';

const app = createApp();

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

describe('/api/customers', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/customers');
    expect(res.status).toBe(401);
  });

  it('searches customers by partial name match', async () => {
    const { token } = await createAgent();
    await prisma.customer.create({ data: { fullName: 'Jane Customer', email: 'jane@example.com' } });
    await prisma.customer.create({ data: { fullName: 'Bob Other', email: 'bob@example.com' } });

    const res = await request(app).get('/api/customers?query=jane').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].fullName).toBe('Jane Customer');
  });

  it('returns all customers when query is empty', async () => {
    const { token } = await createAgent();
    await prisma.customer.create({ data: { fullName: 'Jane Customer' } });
    const res = await request(app).get('/api/customers').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/routes/customers.test.ts`
Expected: FAIL — 404s, `/api/customers` isn't mounted yet.

- [ ] **Step 3: Implement**

`backend/src/services/customers.service.ts`:

```ts
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
```

`backend/src/controllers/customers.controller.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import * as customersService from '../services/customers.service';

export async function searchCustomersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    res.json(await customersService.searchCustomers(query));
  } catch (err) {
    next(err);
  }
}
```

`backend/src/routes/customers.routes.ts`:

```ts
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { searchCustomersHandler } from '../controllers/customers.controller';

export const customersRouter = Router();

customersRouter.use(authenticate);
customersRouter.get('/', searchCustomersHandler);
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

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/customers.service.ts backend/src/controllers/customers.controller.ts backend/src/routes/customers.routes.ts backend/src/app.ts backend/tests/routes/customers.test.ts
git commit -m "feat(backend): add customer search endpoint"
```

---

### Task 3: Ticket Categories endpoints (Admin-only)

**Files:**
- Create: `backend/src/services/ticketCategories.service.ts`
- Create: `backend/src/controllers/ticketCategories.controller.ts`
- Create: `backend/src/routes/ticketCategories.routes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/routes/ticketCategories.test.ts`

**Interfaces:**
- Consumes: `prisma`, `HttpError`, `authenticate`, `authorize`, `validate`.
- Produces: `GET/POST /api/ticket-categories`, `PATCH /api/ticket-categories/:id` — `authorize('ADMIN')`, identical shape to `/api/departments`. Consumed by the frontend's `api/ticketCategories.ts` (Task 8) and by ticket creation/update forms (Tasks 10, 12) for the category dropdown.

- [ ] **Step 1: Write the failing test**

`backend/tests/routes/ticketCategories.test.ts`:

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

describe('/api/ticket-categories', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/ticket-categories');
    expect(res.status).toBe(401);
  });

  it('rejects non-admin requests', async () => {
    const { token } = await createAgent();
    const res = await request(app).get('/api/ticket-categories').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('creates and lists ticket categories', async () => {
    const { token } = await createAdmin();
    const createRes = await request(app)
      .post('/api/ticket-categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ nameEn: 'Billing', nameAr: 'الفواتير' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.nameEn).toBe('Billing');

    const listRes = await request(app).get('/api/ticket-categories').set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
  });

  it('updates a ticket category', async () => {
    const { token } = await createAdmin();
    const category = await prisma.ticketCategory.create({ data: { nameEn: 'Technical', nameAr: 'تقني' } });
    const res = await request(app)
      .patch(`/api/ticket-categories/${category.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nameEn: 'Technical Support' });
    expect(res.status).toBe(200);
    expect(res.body.nameEn).toBe('Technical Support');
  });

  it('rejects an update to a non-existent category', async () => {
    const { token } = await createAdmin();
    const res = await request(app)
      .patch('/api/ticket-categories/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ nameEn: 'Nope' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/routes/ticketCategories.test.ts`
Expected: FAIL — 404s, `/api/ticket-categories` isn't mounted yet.

- [ ] **Step 3: Implement**

`backend/src/services/ticketCategories.service.ts`:

```ts
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
```

`backend/src/controllers/ticketCategories.controller.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import * as ticketCategoriesService from '../services/ticketCategories.service';

export async function listTicketCategoriesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await ticketCategoriesService.listTicketCategories());
  } catch (err) {
    next(err);
  }
}

export async function createTicketCategoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await ticketCategoriesService.createTicketCategory(req.body));
  } catch (err) {
    next(err);
  }
}

export async function updateTicketCategoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await ticketCategoriesService.updateTicketCategory(req.params.id as string, req.body));
  } catch (err) {
    next(err);
  }
}
```

`backend/src/routes/ticketCategories.routes.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  listTicketCategoriesHandler,
  createTicketCategoryHandler,
  updateTicketCategoryHandler,
} from '../controllers/ticketCategories.controller';

const createTicketCategorySchema = z.object({
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
});

const updateTicketCategorySchema = z.object({
  nameEn: z.string().min(1).optional(),
  nameAr: z.string().min(1).optional(),
});

export const ticketCategoriesRouter = Router();

ticketCategoriesRouter.use(authenticate, authorize('ADMIN'));
ticketCategoriesRouter.get('/', listTicketCategoriesHandler);
ticketCategoriesRouter.post('/', validate(createTicketCategorySchema), createTicketCategoryHandler);
ticketCategoriesRouter.patch('/:id', validate(updateTicketCategorySchema), updateTicketCategoryHandler);
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

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/ticketCategories.service.ts backend/src/controllers/ticketCategories.controller.ts backend/src/routes/ticketCategories.routes.ts backend/src/app.ts backend/tests/routes/ticketCategories.test.ts
git commit -m "feat(backend): add admin ticket category endpoints"
```

---

### Task 4: Tickets — create, list, get detail

**Files:**
- Create: `backend/src/services/tickets.service.ts`
- Create: `backend/src/controllers/tickets.controller.ts`
- Create: `backend/src/routes/tickets.routes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/routes/tickets.test.ts`

**Interfaces:**
- Consumes: `prisma`, `HttpError`, `authenticate`, `validate`.
- Produces: `GET /api/tickets?status=&assigneeId=&departmentId=&categoryId=`, `POST /api/tickets`, `GET /api/tickets/:id` (any authenticated staff). `TicketWithRelations`/`TicketDetail` types and the `ticketInclude`/`ticketDetailInclude` Prisma include shapes — every later ticket-mutating task (5, 6, 7) imports and reuses `getTicketById` to build its response. `tickets.service.ts`, `.controller.ts`, `.routes.ts` are each extended (not replaced) by Tasks 5-7.

- [ ] **Step 1: Write the failing test**

`backend/tests/routes/tickets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';
import { signToken } from '../../src/lib/jwt';
import type { Role } from '@prisma/client';

const app = createApp();

async function createStaff(role: Role, email: string) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('password123'),
      fullName: `${role} User`,
      role,
    },
  });
  const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
  return { user, token };
}

async function createCustomerFixture() {
  return prisma.customer.create({ data: { fullName: 'Jane Customer', email: 'jane@example.com' } });
}

describe('/api/tickets', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/tickets');
    expect(res.status).toBe(401);
  });

  it('creates a ticket for an existing customer', async () => {
    const { token } = await createStaff('AGENT', 'agent@example.com');
    const customer = await createCustomerFixture();

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Cannot log in', description: 'Getting an error', customerId: customer.id });

    expect(res.status).toBe(201);
    expect(res.body.subject).toBe('Cannot log in');
    expect(res.body.status).toBe('OPEN');
    expect(res.body.priority).toBe('MEDIUM');
    expect(res.body.customer.fullName).toBe('Jane Customer');
  });

  it('creates a ticket with an inline new customer', async () => {
    const { token } = await createStaff('AGENT', 'agent2@example.com');

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        subject: 'Billing question',
        description: 'Why was I charged twice?',
        newCustomer: { fullName: 'New Customer', email: 'new@example.com' },
        priority: 'HIGH',
      });

    expect(res.status).toBe(201);
    expect(res.body.customer.fullName).toBe('New Customer');
    expect(res.body.priority).toBe('HIGH');
  });

  it('rejects creating a ticket with both customerId and newCustomer', async () => {
    const { token } = await createStaff('AGENT', 'agent3@example.com');
    const customer = await createCustomerFixture();

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        subject: 'Test',
        description: 'Test',
        customerId: customer.id,
        newCustomer: { fullName: 'Another' },
      });

    expect(res.status).toBe(400);
  });

  it('rejects creating a ticket with neither customerId nor newCustomer', async () => {
    const { token } = await createStaff('AGENT', 'agent4@example.com');
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Test', description: 'Test' });
    expect(res.status).toBe(400);
  });

  it('lists tickets', async () => {
    const { user, token } = await createStaff('AGENT', 'agent5@example.com');
    const customer = await createCustomerFixture();
    await prisma.ticket.create({
      data: { subject: 'Ticket 1', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app).get('/api/tickets').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].customer.fullName).toBe('Jane Customer');
  });

  it('filters tickets by status', async () => {
    const { user, token } = await createStaff('AGENT', 'agent6@example.com');
    const customer = await createCustomerFixture();
    await prisma.ticket.create({
      data: { subject: 'Open one', description: 'Desc', customerId: customer.id, createdById: user.id, status: 'OPEN' },
    });
    await prisma.ticket.create({
      data: { subject: 'Closed one', description: 'Desc', customerId: customer.id, createdById: user.id, status: 'CLOSED' },
    });

    const res = await request(app).get('/api/tickets?status=CLOSED').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].subject).toBe('Closed one');
  });

  it('gets a ticket by id with its (empty) event timeline', async () => {
    const { user, token } = await createStaff('AGENT', 'agent7@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app).get(`/api/tickets/${ticket.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe('Ticket');
    expect(res.body.events).toEqual([]);
  });

  it('returns 404 for a non-existent ticket', async () => {
    const { token } = await createStaff('AGENT', 'agent8@example.com');
    const res = await request(app)
      .get('/api/tickets/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/routes/tickets.test.ts`
Expected: FAIL — 404s, `/api/tickets` isn't mounted yet.

- [ ] **Step 3: Implement**

`backend/src/services/tickets.service.ts`:

```ts
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
```

`backend/src/controllers/tickets.controller.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import { TicketStatus } from '@prisma/client';
import * as ticketsService from '../services/tickets.service';

export async function listTicketsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, assigneeId, departmentId, categoryId } = req.query;
    res.json(
      await ticketsService.listTickets({
        status: status as TicketStatus | undefined,
        assigneeId: assigneeId as string | undefined,
        departmentId: departmentId as string | undefined,
        categoryId: categoryId as string | undefined,
      })
    );
  } catch (err) {
    next(err);
  }
}

export async function getTicketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await ticketsService.getTicketById(req.params.id as string));
  } catch (err) {
    next(err);
  }
}

export async function createTicketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await ticketsService.createTicket(req.body, req.user!.id));
  } catch (err) {
    next(err);
  }
}
```

`backend/src/routes/tickets.routes.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { listTicketsHandler, getTicketHandler, createTicketHandler } from '../controllers/tickets.controller';

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

const newCustomerSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
});

const createTicketSchema = z
  .object({
    subject: z.string().min(1),
    description: z.string().min(1),
    customerId: z.string().uuid().optional(),
    newCustomer: newCustomerSchema.optional(),
    categoryId: z.string().uuid().nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
    priority: priorityEnum.optional(),
  })
  .refine((data) => Boolean(data.customerId) !== Boolean(data.newCustomer), {
    message: 'Provide exactly one of customerId or newCustomer',
  });

export const ticketsRouter = Router();

ticketsRouter.use(authenticate);
ticketsRouter.get('/', listTicketsHandler);
ticketsRouter.post('/', validate(createTicketSchema), createTicketHandler);
ticketsRouter.get('/:id', getTicketHandler);
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

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tickets.service.ts backend/src/controllers/tickets.controller.ts backend/src/routes/tickets.routes.ts backend/src/app.ts backend/tests/routes/tickets.test.ts
git commit -m "feat(backend): add ticket create/list/get endpoints"
```

---

### Task 5: Tickets — update status/priority/category/department

**Files:**
- Modify: `backend/src/services/tickets.service.ts`
- Modify: `backend/src/controllers/tickets.controller.ts`
- Modify: `backend/src/routes/tickets.routes.ts`
- Modify: `backend/tests/routes/tickets.test.ts`

**Interfaces:**
- Consumes: everything from Task 4 (`getTicketById`, `ticketInclude` types).
- Produces: `updateTicketFields(id, data, authorId): Promise<TicketDetail>` and `PATCH /api/tickets/:id` — writes one `TicketEvent` per changed field, in one transaction. Consumed by Task 12's frontend mutation controls.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/routes/tickets.test.ts` (add this new `describe` block after the existing `describe('/api/tickets', ...)` block, same file, same imports/helpers already present):

```ts
describe('PATCH /api/tickets/:id', () => {
  it('updates status and logs a STATUS_CHANGED event', async () => {
    const { user, token } = await createStaff('AGENT', 'updater@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].type).toBe('STATUS_CHANGED');
    expect(res.body.events[0].oldValue).toBe('OPEN');
    expect(res.body.events[0].newValue).toBe('IN_PROGRESS');
  });

  it('updates multiple fields at once and logs one event per changed field', async () => {
    const { user, token } = await createStaff('AGENT', 'updater2@example.com');
    const customer = await createCustomerFixture();
    const category = await prisma.ticketCategory.create({ data: { nameEn: 'Billing', nameAr: 'الفواتير' } });
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ priority: 'URGENT', categoryId: category.id });

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe('URGENT');
    expect(res.body.category.id).toBe(category.id);
    expect(res.body.events).toHaveLength(2);
    const types = res.body.events.map((e: { type: string }) => e.type).sort();
    expect(types).toEqual(['CATEGORY_CHANGED', 'PRIORITY_CHANGED']);
  });

  it('is a no-op when the submitted value matches the current value', async () => {
    const { user, token } = await createStaff('AGENT', 'updater3@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'OPEN' });

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(0);
  });

  it('returns 404 for a non-existent ticket', async () => {
    const { token } = await createStaff('AGENT', 'updater4@example.com');
    const res = await request(app)
      .patch('/api/tickets/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CLOSED' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/routes/tickets.test.ts`
Expected: FAIL — the new tests get 404 (no `PATCH /:id` route mounted yet); all pre-existing tests in the file still pass.

- [ ] **Step 3: Implement**

Add to `backend/src/services/tickets.service.ts` (append after `createTicket`; also change the top import line to include `TicketStatus` if not already there — it already is from Task 4):

```ts
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
    const updateData: Prisma.TicketUpdateInput = {};

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
```

Add to `backend/src/controllers/tickets.controller.ts` (append after `createTicketHandler`):

```ts
export async function updateTicketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await ticketsService.updateTicketFields(req.params.id as string, req.body, req.user!.id));
  } catch (err) {
    next(err);
  }
}
```

Update `backend/src/routes/tickets.routes.ts` (full file — adds the `statusEnum`, `updateTicketSchema`, the `updateTicketHandler` import, and the `PATCH /:id` route):

```ts
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import {
  listTicketsHandler,
  getTicketHandler,
  createTicketHandler,
  updateTicketHandler,
} from '../controllers/tickets.controller';

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const statusEnum = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);

const newCustomerSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
});

const createTicketSchema = z
  .object({
    subject: z.string().min(1),
    description: z.string().min(1),
    customerId: z.string().uuid().optional(),
    newCustomer: newCustomerSchema.optional(),
    categoryId: z.string().uuid().nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
    priority: priorityEnum.optional(),
  })
  .refine((data) => Boolean(data.customerId) !== Boolean(data.newCustomer), {
    message: 'Provide exactly one of customerId or newCustomer',
  });

const updateTicketSchema = z.object({
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  categoryId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
});

export const ticketsRouter = Router();

ticketsRouter.use(authenticate);
ticketsRouter.get('/', listTicketsHandler);
ticketsRouter.post('/', validate(createTicketSchema), createTicketHandler);
ticketsRouter.get('/:id', getTicketHandler);
ticketsRouter.patch('/:id', validate(updateTicketSchema), updateTicketHandler);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tickets.service.ts backend/src/controllers/tickets.controller.ts backend/src/routes/tickets.routes.ts backend/tests/routes/tickets.test.ts
git commit -m "feat(backend): add ticket field update endpoint with event logging"
```

---

### Task 6: Tickets — assign (role rule), plus letting Supervisors list users

**Files:**
- Modify: `backend/src/services/tickets.service.ts`
- Modify: `backend/src/controllers/tickets.controller.ts`
- Modify: `backend/src/routes/tickets.routes.ts`
- Modify: `backend/tests/routes/tickets.test.ts`
- Modify: `backend/src/routes/users.routes.ts`
- Modify: `backend/tests/routes/users.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4-5.
- Produces: `assignTicket(id, assigneeId, requester): Promise<TicketDetail>` and `POST /api/tickets/:id/assign`. Also loosens `GET /api/users` from `ADMIN`-only to `ADMIN`+`SUPERVISOR` (Supervisors need the staff list to reassign tickets in Task 12's frontend) — `POST/PATCH/deactivate` on `/api/users` stay `ADMIN`-only, unchanged.

**Why the `users.routes.ts` change:** Task 12's frontend "assign to any agent" dropdown (for Supervisors/Admins) needs to fetch the staff list via the existing `GET /api/users`, but that endpoint is currently gated `authorize('ADMIN')` only — a Supervisor calling it today gets `403`. This task splits that router's authorization per-route instead of applying one blanket `authorize('ADMIN')` to the whole router.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/routes/tickets.test.ts` (new `describe` block, same file/imports):

```ts
describe('POST /api/tickets/:id/assign', () => {
  it('lets a supervisor assign a ticket to any agent', async () => {
    const { user: supervisor, token: supervisorToken } = await createStaff('SUPERVISOR', 'supervisor@example.com');
    const { user: agent } = await createStaff('AGENT', 'agent-assignee@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: supervisor.id },
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ assigneeId: agent.id });

    expect(res.status).toBe(200);
    expect(res.body.assignee.id).toBe(agent.id);
  });

  it('lets an agent claim an unassigned ticket for themselves', async () => {
    const { user: agent, token } = await createStaff('AGENT', 'claiming-agent@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: agent.id },
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId: agent.id });

    expect(res.status).toBe(200);
    expect(res.body.assignee.id).toBe(agent.id);
  });

  it('lets an agent release their own assignment', async () => {
    const { user: agent, token } = await createStaff('AGENT', 'releasing-agent@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: {
        subject: 'Ticket',
        description: 'Desc',
        customerId: customer.id,
        createdById: agent.id,
        assigneeId: agent.id,
      },
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId: null });

    expect(res.status).toBe(200);
    expect(res.body.assignee).toBeNull();
  });

  it('rejects an agent assigning a ticket to a different agent', async () => {
    const { user: agentA, token: tokenA } = await createStaff('AGENT', 'agent-a@example.com');
    const { user: agentB } = await createStaff('AGENT', 'agent-b@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: agentA.id },
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ assigneeId: agentB.id });

    expect(res.status).toBe(403);
  });
});
```

Append to `backend/tests/routes/users.test.ts` (new test inside the existing `describe('/api/users', ...)` block, right after the `'lists users for an admin'` test — this file already has a `createAgent` helper; add a `createSupervisor` helper next to it):

```ts
async function createSupervisor() {
  const user = await prisma.user.create({
    data: {
      email: 'supervisor@example.com',
      passwordHash: await hashPassword('password123'),
      fullName: 'Supervisor User',
      role: 'SUPERVISOR',
    },
  });
  const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
  return { user, token };
}
```

```ts
  it('lets a supervisor list users too', async () => {
    const { token } = await createSupervisor();
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('rejects a supervisor creating a user', async () => {
    const { token } = await createSupervisor();
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'nope@example.com', password: 'password123', fullName: 'Nope', role: 'AGENT' });
    expect(res.status).toBe(403);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run tests/routes/tickets.test.ts tests/routes/users.test.ts`
Expected: FAIL — the assign tests get 404 (no route yet); `'lets a supervisor list users too'` gets 403 (still ADMIN-only); `'rejects a supervisor creating a user'` currently already passes (already 403) — that's fine, it's asserting behavior that must *stay* true after this task's change.

- [ ] **Step 3: Implement**

Add to `backend/src/services/tickets.service.ts` (append after `updateTicketFields`; add `Role` to the existing `@prisma/client` import at the top, so it reads `import { Prisma, Role, TicketPriority, TicketStatus } from '@prisma/client';`):

```ts
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
    const claimingSelf = assigneeId === requester.id;
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
```

Add to `backend/src/controllers/tickets.controller.ts` (append after `updateTicketHandler`):

```ts
export async function assignTicketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await ticketsService.assignTicket(req.params.id as string, req.body.assigneeId, {
        id: req.user!.id,
        role: req.user!.role,
      })
    );
  } catch (err) {
    next(err);
  }
}
```

Update `backend/src/routes/tickets.routes.ts` (full file — adds `assignTicketSchema`, the `assignTicketHandler` import, and the `POST /:id/assign` route):

```ts
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import {
  listTicketsHandler,
  getTicketHandler,
  createTicketHandler,
  updateTicketHandler,
  assignTicketHandler,
} from '../controllers/tickets.controller';

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const statusEnum = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);

const newCustomerSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
});

const createTicketSchema = z
  .object({
    subject: z.string().min(1),
    description: z.string().min(1),
    customerId: z.string().uuid().optional(),
    newCustomer: newCustomerSchema.optional(),
    categoryId: z.string().uuid().nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
    priority: priorityEnum.optional(),
  })
  .refine((data) => Boolean(data.customerId) !== Boolean(data.newCustomer), {
    message: 'Provide exactly one of customerId or newCustomer',
  });

const updateTicketSchema = z.object({
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  categoryId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
});

const assignTicketSchema = z.object({
  assigneeId: z.string().uuid().nullable(),
});

export const ticketsRouter = Router();

ticketsRouter.use(authenticate);
ticketsRouter.get('/', listTicketsHandler);
ticketsRouter.post('/', validate(createTicketSchema), createTicketHandler);
ticketsRouter.get('/:id', getTicketHandler);
ticketsRouter.patch('/:id', validate(updateTicketSchema), updateTicketHandler);
ticketsRouter.post('/:id/assign', validate(assignTicketSchema), assignTicketHandler);
```

Update `backend/src/routes/users.routes.ts` (full file — splits the router-level `authorize('ADMIN')` into per-route authorization so `GET /` also allows `SUPERVISOR`):

```ts
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  listUsersHandler,
  createUserHandler,
  updateUserHandler,
  deactivateUserHandler,
} from '../controllers/users.controller';

const roleEnum = z.enum(['AGENT', 'SUPERVISOR', 'ADMIN']);

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  role: roleEnum,
  departmentId: z.string().uuid().nullable().optional(),
  locale: z.enum(['en', 'ar']).optional(),
});

const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  role: roleEnum.optional(),
  departmentId: z.string().uuid().nullable().optional(),
  locale: z.enum(['en', 'ar']).optional(),
});

export const usersRouter = Router();

usersRouter.use(authenticate);
usersRouter.get('/', authorize('ADMIN', 'SUPERVISOR'), listUsersHandler);
usersRouter.post('/', authorize('ADMIN'), validate(createUserSchema), createUserHandler);
usersRouter.patch('/:id', authorize('ADMIN'), validate(updateUserSchema), updateUserHandler);
usersRouter.post('/:id/deactivate', authorize('ADMIN'), deactivateUserHandler);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npm test`
Expected: PASS (all tests, including every pre-existing Foundation test in `users.test.ts` — the `'rejects non-admin requests'` test there uses an Agent token and must still get 403).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tickets.service.ts backend/src/controllers/tickets.controller.ts backend/src/routes/tickets.routes.ts backend/tests/routes/tickets.test.ts backend/src/routes/users.routes.ts backend/tests/routes/users.test.ts
git commit -m "feat(backend): add ticket assignment with agent self-assign rule; let supervisors list users"
```

---

### Task 7: Tickets — escalate, unescalate, add note

**Files:**
- Modify: `backend/src/services/tickets.service.ts`
- Modify: `backend/src/controllers/tickets.controller.ts`
- Modify: `backend/src/routes/tickets.routes.ts`
- Modify: `backend/tests/routes/tickets.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4-6.
- Produces: `escalateTicket`, `unescalateTicket`, `addTicketNote` (all `(id, ..., authorId): Promise<TicketDetail>`) and `POST /api/tickets/:id/escalate`, `/unescalate`, `/notes`. This completes the backend for this sub-project. Consumed by Task 12's frontend.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/routes/tickets.test.ts` (two new `describe` blocks, same file/imports):

```ts
describe('POST /api/tickets/:id/escalate and /unescalate', () => {
  it('escalates a ticket with a note', async () => {
    const { user, token } = await createStaff('AGENT', 'escalator@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/escalate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'Customer is very upset' });

    expect(res.status).toBe(200);
    expect(res.body.isEscalated).toBe(true);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].type).toBe('ESCALATED');
    expect(res.body.events[0].note).toBe('Customer is very upset');
  });

  it('rejects escalating an already-escalated ticket', async () => {
    const { user, token } = await createStaff('AGENT', 'escalator2@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: {
        subject: 'Ticket',
        description: 'Desc',
        customerId: customer.id,
        createdById: user.id,
        isEscalated: true,
      },
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/escalate`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('unescalates a ticket', async () => {
    const { user, token } = await createStaff('AGENT', 'unescalator@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: {
        subject: 'Ticket',
        description: 'Desc',
        customerId: customer.id,
        createdById: user.id,
        isEscalated: true,
      },
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/unescalate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.isEscalated).toBe(false);
  });

  it('rejects unescalating a non-escalated ticket', async () => {
    const { user, token } = await createStaff('AGENT', 'unescalator2@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/unescalate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});

describe('POST /api/tickets/:id/notes', () => {
  it('adds a note to a ticket', async () => {
    const { user, token } = await createStaff('AGENT', 'note-author@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'Called the customer back' });

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].type).toBe('NOTE_ADDED');
    expect(res.body.events[0].note).toBe('Called the customer back');
    expect(res.body.events[0].author.fullName).toBe('AGENT User');
  });

  it('rejects an empty note', async () => {
    const { user, token } = await createStaff('AGENT', 'note-author2@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: '' });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run tests/routes/tickets.test.ts`
Expected: FAIL — the new tests get 404 (`/escalate`, `/unescalate`, `/notes` aren't mounted yet).

- [ ] **Step 3: Implement**

Add to `backend/src/services/tickets.service.ts` (append after `assignTicket`):

```ts
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
```

Add to `backend/src/controllers/tickets.controller.ts` (append after `assignTicketHandler`):

```ts
export async function escalateTicketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await ticketsService.escalateTicket(req.params.id as string, req.body.note, req.user!.id));
  } catch (err) {
    next(err);
  }
}

export async function unescalateTicketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await ticketsService.unescalateTicket(req.params.id as string, req.user!.id));
  } catch (err) {
    next(err);
  }
}

export async function addTicketNoteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await ticketsService.addTicketNote(req.params.id as string, req.body.note, req.user!.id));
  } catch (err) {
    next(err);
  }
}
```

Update `backend/src/routes/tickets.routes.ts` (full file — final version for this sub-project):

```ts
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import {
  listTicketsHandler,
  getTicketHandler,
  createTicketHandler,
  updateTicketHandler,
  assignTicketHandler,
  escalateTicketHandler,
  unescalateTicketHandler,
  addTicketNoteHandler,
} from '../controllers/tickets.controller';

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const statusEnum = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);

const newCustomerSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
});

const createTicketSchema = z
  .object({
    subject: z.string().min(1),
    description: z.string().min(1),
    customerId: z.string().uuid().optional(),
    newCustomer: newCustomerSchema.optional(),
    categoryId: z.string().uuid().nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
    priority: priorityEnum.optional(),
  })
  .refine((data) => Boolean(data.customerId) !== Boolean(data.newCustomer), {
    message: 'Provide exactly one of customerId or newCustomer',
  });

const updateTicketSchema = z.object({
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  categoryId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
});

const assignTicketSchema = z.object({
  assigneeId: z.string().uuid().nullable(),
});

const escalateTicketSchema = z.object({
  note: z.string().min(1).optional(),
});

const addNoteSchema = z.object({
  note: z.string().min(1),
});

export const ticketsRouter = Router();

ticketsRouter.use(authenticate);
ticketsRouter.get('/', listTicketsHandler);
ticketsRouter.post('/', validate(createTicketSchema), createTicketHandler);
ticketsRouter.get('/:id', getTicketHandler);
ticketsRouter.patch('/:id', validate(updateTicketSchema), updateTicketHandler);
ticketsRouter.post('/:id/assign', validate(assignTicketSchema), assignTicketHandler);
ticketsRouter.post('/:id/escalate', validate(escalateTicketSchema), escalateTicketHandler);
ticketsRouter.post('/:id/unescalate', unescalateTicketHandler);
ticketsRouter.post('/:id/notes', validate(addNoteSchema), addTicketNoteHandler);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npm test`
Expected: PASS (all tests). This completes the backend for this sub-project.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tickets.service.ts backend/src/controllers/tickets.controller.ts backend/src/routes/tickets.routes.ts backend/tests/routes/tickets.test.ts
git commit -m "feat(backend): add ticket escalate/unescalate/add-note endpoints"
```

---

## Frontend

### Task 8: Ticket Categories UI (Admin)

**Files:**
- Create: `frontend/src/api/ticketCategories.ts`
- Create: `frontend/src/views/ticketCategories/TicketCategoryListView.vue`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/layouts/AppShell.vue`
- Modify: `frontend/tests/layouts/AppShell.test.ts`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/ar.json`
- Test: `frontend/tests/views/ticketCategories/TicketCategoryListView.test.ts`

**Interfaces:**
- Consumes: `apiClient` (from Foundation's `api/client.ts`), `mountWithPlugins`.
- Produces: `ApiTicketCategory` type and `fetchTicketCategories`/`createTicketCategory`/`updateTicketCategory` in `frontend/src/api/ticketCategories.ts` — consumed by Tasks 10 and 12 for the category dropdown.

- [ ] **Step 1: Write the failing test**

`frontend/tests/views/ticketCategories/TicketCategoryListView.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/ticketCategories', () => ({
  fetchTicketCategories: vi.fn(),
  createTicketCategory: vi.fn(),
  updateTicketCategory: vi.fn(),
}));

import { fetchTicketCategories } from '../../../src/api/ticketCategories';
import TicketCategoryListView from '../../../src/views/ticketCategories/TicketCategoryListView.vue';

describe('TicketCategoryListView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchTicketCategories).mockResolvedValue([{ id: '1', nameEn: 'Billing', nameAr: 'الفواتير' }]);
  });

  it('renders fetched categories', async () => {
    const wrapper = mountWithPlugins(TicketCategoryListView);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Billing');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `Cannot find module '../../../src/api/ticketCategories'`.

- [ ] **Step 3: Add locale keys**

`frontend/src/locales/en.json` (full file):

```json
{
  "nav": { "home": "Home", "users": "Users", "departments": "Departments", "ticketCategories": "Ticket Categories", "logout": "Logout" },
  "login": { "title": "Sign in", "email": "Email", "password": "Password", "submit": "Sign in", "error": "Invalid email or password" },
  "home": { "welcome": "Welcome, {name}" },
  "users": {
    "title": "Users",
    "create": "New user",
    "email": "Email",
    "fullName": "Full name",
    "role": "Role",
    "department": "Department",
    "active": "Active",
    "deactivate": "Deactivate"
  },
  "departments": { "title": "Departments", "create": "New department", "nameEn": "Name (English)", "nameAr": "Name (Arabic)" },
  "ticketCategories": { "title": "Ticket Categories", "create": "New category", "nameEn": "Name (English)", "nameAr": "Name (Arabic)" }
}
```

`frontend/src/locales/ar.json` (full file):

```json
{
  "nav": { "home": "الرئيسية", "users": "المستخدمون", "departments": "الأقسام", "ticketCategories": "فئات التذاكر", "logout": "تسجيل الخروج" },
  "login": { "title": "تسجيل الدخول", "email": "البريد الإلكتروني", "password": "كلمة المرور", "submit": "تسجيل الدخول", "error": "بريد إلكتروني أو كلمة مرور غير صحيحة" },
  "home": { "welcome": "مرحبًا، {name}" },
  "users": {
    "title": "المستخدمون",
    "create": "مستخدم جديد",
    "email": "البريد الإلكتروني",
    "fullName": "الاسم الكامل",
    "role": "الدور",
    "department": "القسم",
    "active": "نشط",
    "deactivate": "إيقاف"
  },
  "departments": { "title": "الأقسام", "create": "قسم جديد", "nameEn": "الاسم (إنجليزي)", "nameAr": "الاسم (عربي)" },
  "ticketCategories": { "title": "فئات التذاكر", "create": "فئة جديدة", "nameEn": "الاسم (إنجليزي)", "nameAr": "الاسم (عربي)" }
}
```

- [ ] **Step 4: Implement the API module and the view**

`frontend/src/api/ticketCategories.ts`:

```ts
import { apiClient } from './client';

export interface ApiTicketCategory {
  id: string;
  nameEn: string;
  nameAr: string;
}

export async function fetchTicketCategories(): Promise<ApiTicketCategory[]> {
  const res = await apiClient.get('/ticket-categories');
  return res.data;
}

export async function createTicketCategory(data: { nameEn: string; nameAr: string }): Promise<ApiTicketCategory> {
  const res = await apiClient.post('/ticket-categories', data);
  return res.data;
}

export async function updateTicketCategory(
  id: string,
  data: Partial<{ nameEn: string; nameAr: string }>
): Promise<ApiTicketCategory> {
  const res = await apiClient.patch(`/ticket-categories/${id}`, data);
  return res.data;
}
```

`frontend/src/views/ticketCategories/TicketCategoryListView.vue`:

```vue
<template>
  <v-container>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1>{{ $t('ticketCategories.title') }}</h1>
      <v-btn color="primary" @click="openCreate">{{ $t('ticketCategories.create') }}</v-btn>
    </div>

    <v-data-table :items="categories" :headers="headers">
      <template #item.actions="{ item }">
        <v-btn size="small" variant="text" @click="openEdit(item)">Edit</v-btn>
      </template>
    </v-data-table>

    <v-dialog v-model="dialogOpen" max-width="480">
      <v-card :title="editingId ? 'Edit category' : $t('ticketCategories.create')">
        <v-card-text>
          <form @submit.prevent="submit">
            <v-text-field v-model="form.nameEn" :label="$t('ticketCategories.nameEn')" />
            <v-text-field v-model="form.nameAr" :label="$t('ticketCategories.nameAr')" />
            <v-btn type="submit" color="primary">Save</v-btn>
          </form>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import {
  fetchTicketCategories,
  createTicketCategory,
  updateTicketCategory,
  type ApiTicketCategory,
} from '../../api/ticketCategories';

const categories = ref<ApiTicketCategory[]>([]);
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);

const headers = [
  { title: 'Name (EN)', key: 'nameEn' },
  { title: 'Name (AR)', key: 'nameAr' },
  { title: '', key: 'actions', sortable: false },
];

const form = reactive({ nameEn: '', nameAr: '' });

async function load() {
  categories.value = await fetchTicketCategories();
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, { nameEn: '', nameAr: '' });
  dialogOpen.value = true;
}

function openEdit(item: ApiTicketCategory) {
  editingId.value = item.id;
  Object.assign(form, { nameEn: item.nameEn, nameAr: item.nameAr });
  dialogOpen.value = true;
}

async function submit() {
  if (editingId.value) {
    await updateTicketCategory(editingId.value, { nameEn: form.nameEn, nameAr: form.nameAr });
  } else {
    await createTicketCategory({ nameEn: form.nameEn, nameAr: form.nameAr });
  }
  dialogOpen.value = false;
  await load();
}

onMounted(load);
</script>
```

- [ ] **Step 5: Wire up the route and nav item**

`frontend/src/router/index.ts` (full file):

```ts
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import LoginView from '../views/LoginView.vue';
import HomeView from '../views/HomeView.vue';
import AppShell from '../layouts/AppShell.vue';
import UserListView from '../views/users/UserListView.vue';
import DepartmentListView from '../views/departments/DepartmentListView.vue';
import TicketCategoryListView from '../views/ticketCategories/TicketCategoryListView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/',
      component: AppShell,
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'home', component: HomeView },
        { path: 'users', name: 'users', component: UserListView, meta: { roles: ['ADMIN'] } },
        { path: 'departments', name: 'departments', component: DepartmentListView, meta: { roles: ['ADMIN'] } },
        {
          path: 'ticket-categories',
          name: 'ticket-categories',
          component: TicketCategoryListView,
          meta: { roles: ['ADMIN'] },
        },
      ],
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login' };
  }
  const roles = to.meta.roles as string[] | undefined;
  if (roles && (!auth.currentUser || !roles.includes(auth.currentUser.role))) {
    return { name: 'home' };
  }
  return true;
});

export default router;
```

`frontend/src/layouts/AppShell.vue` — add one nav item (full file):

```vue
<template>
  <v-app>
    <v-navigation-drawer permanent>
      <v-list>
        <v-list-item :title="$t('nav.home')" :to="{ name: 'home' }" />
        <v-list-item v-if="isAdmin" :title="$t('nav.users')" :to="{ name: 'users' }" />
        <v-list-item v-if="isAdmin" :title="$t('nav.departments')" :to="{ name: 'departments' }" />
        <v-list-item v-if="isAdmin" :title="$t('nav.ticketCategories')" :to="{ name: 'ticket-categories' }" />
      </v-list>
    </v-navigation-drawer>

    <v-app-bar>
      <v-app-bar-title>AzmCRM</v-app-bar-title>
      <v-spacer />
      <v-btn-toggle :model-value="currentLocale" mandatory density="compact" class="mr-4">
        <v-btn value="en" @click="setLocale('en')">EN</v-btn>
        <v-btn value="ar" @click="setLocale('ar')">AR</v-btn>
      </v-btn-toggle>
      <v-menu>
        <template #activator="{ props }">
          <v-btn v-bind="props" data-testid="user-menu-activator">{{ auth.currentUser?.fullName }}</v-btn>
        </template>
        <v-list>
          <v-list-item :title="$t('nav.logout')" data-testid="logout-item" @click="handleLogout" />
        </v-list>
      </v-menu>
    </v-app-bar>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLocale } from 'vuetify';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const { locale: i18nLocale } = useI18n();
const { current: vuetifyLocale } = useLocale();

const isAdmin = computed(() => auth.currentUser?.role === 'ADMIN');

const currentLocale = ref(auth.currentUser?.locale === 'ar' ? 'ar' : 'en');

function setLocale(value: 'en' | 'ar') {
  currentLocale.value = value;
  i18nLocale.value = value;
  vuetifyLocale.value = value;
  document.documentElement.dir = value === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = value;
}

onMounted(() => {
  setLocale(auth.currentUser?.locale === 'ar' ? 'ar' : 'en');
});

function handleLogout() {
  auth.logout();
  router.push({ name: 'login' });
}
</script>
```

`frontend/tests/layouts/AppShell.test.ts` (full file — adds a `ticket-categories` route stub to both mounts' route tables, per this plan's Global Constraints note on eager `:to` resolution):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../testUtils';
import { useAuthStore } from '../../src/stores/auth';
import AppShell from '../../src/layouts/AppShell.vue';

describe('AppShell', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.documentElement.dir = '';
    document.documentElement.lang = '';
  });

  it('switches document direction to rtl when Arabic is selected', async () => {
    const auth = useAuthStore();
    auth.currentUser = {
      id: '1',
      email: 'a@b.com',
      fullName: 'A B',
      role: 'ADMIN',
      departmentId: null,
      isActive: true,
      locale: 'en',
    };
    auth.token = 'fake-token';

    const wrapper = mountWithPlugins(AppShell, {}, [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/users', name: 'users', component: { template: '<div />' } },
      { path: '/departments', name: 'departments', component: { template: '<div />' } },
      { path: '/ticket-categories', name: 'ticket-categories', component: { template: '<div />' } },
    ]);

    const arButton = wrapper.findAll('button').find((btn) => btn.text() === 'AR');
    expect(arButton).toBeTruthy();
    await arButton!.trigger('click');

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });

  it('logs out and redirects to login on logout click', async () => {
    const auth = useAuthStore();
    auth.currentUser = {
      id: '1',
      email: 'a@b.com',
      fullName: 'A B',
      role: 'ADMIN',
      departmentId: null,
      isActive: true,
      locale: 'en',
    };
    auth.token = 'fake-token';

    const wrapper = mountWithPlugins(AppShell, {}, [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/users', name: 'users', component: { template: '<div />' } },
      { path: '/departments', name: 'departments', component: { template: '<div />' } },
      { path: '/ticket-categories', name: 'ticket-categories', component: { template: '<div />' } },
    ]);

    await wrapper.find('[data-testid="user-menu-activator"]').trigger('click');
    await wrapper.find('[data-testid="logout-item"]').trigger('click');

    expect(auth.isAuthenticated).toBe(false);
  });
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/ticketCategories.ts frontend/src/views/ticketCategories frontend/src/router/index.ts frontend/src/layouts/AppShell.vue frontend/tests/layouts/AppShell.test.ts frontend/src/locales/en.json frontend/src/locales/ar.json frontend/tests/views/ticketCategories
git commit -m "feat(frontend): add admin ticket category management UI"
```

---

### Task 9: Ticket list

**Files:**
- Create: `frontend/src/api/tickets.ts`
- Create: `frontend/src/views/tickets/TicketListView.vue`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/layouts/AppShell.vue`
- Modify: `frontend/tests/layouts/AppShell.test.ts`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/ar.json`
- Test: `frontend/tests/views/tickets/TicketListView.test.ts`

**Interfaces:**
- Consumes: `apiClient`, `mountWithPlugins`.
- Produces: `TicketStatus`, `TicketPriority`, `ApiTicketSummary` types and `fetchTickets` in `frontend/src/api/tickets.ts` — the `tickets` route (`name: 'tickets'`), visible to **all** authenticated roles (no `meta.roles`), unlike the admin-only routes. Extended by Tasks 10-12.

- [ ] **Step 1: Write the failing test**

`frontend/tests/views/tickets/TicketListView.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/tickets', () => ({
  fetchTickets: vi.fn(),
}));

import { fetchTickets } from '../../../src/api/tickets';
import TicketListView from '../../../src/views/tickets/TicketListView.vue';

describe('TicketListView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
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
      },
    ]);
  });

  it('renders fetched tickets', async () => {
    const wrapper = mountWithPlugins(TicketListView, {}, [
      { path: '/', component: { template: '<div />' } },
      { path: '/tickets/:id', name: 'ticket-detail', component: { template: '<div />' } },
      { path: '/tickets/new', name: 'ticket-new', component: { template: '<div />' } },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Cannot log in');
    expect(wrapper.text()).toContain('Jane Customer');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `Cannot find module '../../../src/api/tickets'`.

- [ ] **Step 3: Add locale keys**

`frontend/src/locales/en.json` (full file — adds `nav.tickets` and a `tickets` section):

```json
{
  "nav": { "home": "Home", "tickets": "Tickets", "users": "Users", "departments": "Departments", "ticketCategories": "Ticket Categories", "logout": "Logout" },
  "login": { "title": "Sign in", "email": "Email", "password": "Password", "submit": "Sign in", "error": "Invalid email or password" },
  "home": { "welcome": "Welcome, {name}" },
  "users": {
    "title": "Users",
    "create": "New user",
    "email": "Email",
    "fullName": "Full name",
    "role": "Role",
    "department": "Department",
    "active": "Active",
    "deactivate": "Deactivate"
  },
  "departments": { "title": "Departments", "create": "New department", "nameEn": "Name (English)", "nameAr": "Name (Arabic)" },
  "ticketCategories": { "title": "Ticket Categories", "create": "New category", "nameEn": "Name (English)", "nameAr": "Name (Arabic)" },
  "tickets": {
    "title": "Tickets",
    "create": "New Ticket",
    "filterStatus": "Status",
    "escalated": "Escalated",
    "subject": "Subject",
    "description": "Description",
    "customer": "Customer",
    "status": "Status",
    "priority": "Priority",
    "assignee": "Assignee",
    "category": "Category",
    "department": "Department",
    "createdBy": "Created by",
    "timeline": "History",
    "addNote": "Add a note",
    "escalate": "Escalate",
    "unescalate": "Unescalate",
    "escalateNote": "Note (optional)",
    "claim": "Claim",
    "release": "Release",
    "newCustomer": "New customer",
    "pickExistingCustomer": "Pick existing customer",
    "customerFullName": "Full name",
    "customerEmail": "Email",
    "customerPhone": "Phone"
  }
}
```

`frontend/src/locales/ar.json` (full file):

```json
{
  "nav": { "home": "الرئيسية", "tickets": "التذاكر", "users": "المستخدمون", "departments": "الأقسام", "ticketCategories": "فئات التذاكر", "logout": "تسجيل الخروج" },
  "login": { "title": "تسجيل الدخول", "email": "البريد الإلكتروني", "password": "كلمة المرور", "submit": "تسجيل الدخول", "error": "بريد إلكتروني أو كلمة مرور غير صحيحة" },
  "home": { "welcome": "مرحبًا، {name}" },
  "users": {
    "title": "المستخدمون",
    "create": "مستخدم جديد",
    "email": "البريد الإلكتروني",
    "fullName": "الاسم الكامل",
    "role": "الدور",
    "department": "القسم",
    "active": "نشط",
    "deactivate": "إيقاف"
  },
  "departments": { "title": "الأقسام", "create": "قسم جديد", "nameEn": "الاسم (إنجليزي)", "nameAr": "الاسم (عربي)" },
  "ticketCategories": { "title": "فئات التذاكر", "create": "فئة جديدة", "nameEn": "الاسم (إنجليزي)", "nameAr": "الاسم (عربي)" },
  "tickets": {
    "title": "التذاكر",
    "create": "تذكرة جديدة",
    "filterStatus": "الحالة",
    "escalated": "تم التصعيد",
    "subject": "الموضوع",
    "description": "الوصف",
    "customer": "العميل",
    "status": "الحالة",
    "priority": "الأولوية",
    "assignee": "المسؤول",
    "category": "الفئة",
    "department": "القسم",
    "createdBy": "أنشأها",
    "timeline": "السجل",
    "addNote": "إضافة ملاحظة",
    "escalate": "تصعيد",
    "unescalate": "إلغاء التصعيد",
    "escalateNote": "ملاحظة (اختياري)",
    "claim": "استلام",
    "release": "تحرير",
    "newCustomer": "عميل جديد",
    "pickExistingCustomer": "اختيار عميل موجود",
    "customerFullName": "الاسم الكامل",
    "customerEmail": "البريد الإلكتروني",
    "customerPhone": "الهاتف"
  }
}
```

- [ ] **Step 4: Implement the API module and the view**

`frontend/src/api/tickets.ts`:

```ts
import { apiClient } from './client';

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

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
}

export async function fetchTickets(filters: { status?: TicketStatus } = {}): Promise<ApiTicketSummary[]> {
  const res = await apiClient.get('/tickets', { params: filters });
  return res.data;
}
```

`frontend/src/views/tickets/TicketListView.vue`:

```vue
<template>
  <v-container>
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
    </v-data-table>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { fetchTickets, type ApiTicketSummary, type TicketStatus } from '../../api/tickets';

const router = useRouter();
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
];

async function load() {
  tickets.value = await fetchTickets(statusFilter.value ? { status: statusFilter.value } : {});
}

function goToTicket(_event: Event, row: { item: ApiTicketSummary }) {
  router.push({ name: 'ticket-detail', params: { id: row.item.id } });
}

onMounted(load);
</script>
```

**Environment note — verify this works:** `@click:row`'s second argument shape (`{ item }`) is Vuetify's documented pattern; this app's Vuetify resolved to v4.1.12 (see Task 9 of the Foundation plan, which found `useLocale` unchanged from v3 in this version). If `@click:row`'s payload shape differs in the installed v4, adjust `goToTicket`'s signature to match what you observe (log the second argument if unsure), keep the row-click-navigates-to-detail behavior, and disclose the exact shape you found in your report — same pattern as every other version surprise in this codebase's plans so far.

- [ ] **Step 5: Wire up the route and nav item**

`frontend/src/router/index.ts` (full file — adds the `tickets` route, visible to all roles, as a child right after `home`):

```ts
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import LoginView from '../views/LoginView.vue';
import HomeView from '../views/HomeView.vue';
import AppShell from '../layouts/AppShell.vue';
import UserListView from '../views/users/UserListView.vue';
import DepartmentListView from '../views/departments/DepartmentListView.vue';
import TicketCategoryListView from '../views/ticketCategories/TicketCategoryListView.vue';
import TicketListView from '../views/tickets/TicketListView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/',
      component: AppShell,
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'home', component: HomeView },
        { path: 'tickets', name: 'tickets', component: TicketListView },
        { path: 'users', name: 'users', component: UserListView, meta: { roles: ['ADMIN'] } },
        { path: 'departments', name: 'departments', component: DepartmentListView, meta: { roles: ['ADMIN'] } },
        {
          path: 'ticket-categories',
          name: 'ticket-categories',
          component: TicketCategoryListView,
          meta: { roles: ['ADMIN'] },
        },
      ],
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login' };
  }
  const roles = to.meta.roles as string[] | undefined;
  if (roles && (!auth.currentUser || !roles.includes(auth.currentUser.role))) {
    return { name: 'home' };
  }
  return true;
});

export default router;
```

`frontend/src/layouts/AppShell.vue` — add the "Tickets" nav item, visible to everyone (full file):

```vue
<template>
  <v-app>
    <v-navigation-drawer permanent>
      <v-list>
        <v-list-item :title="$t('nav.home')" :to="{ name: 'home' }" />
        <v-list-item :title="$t('nav.tickets')" :to="{ name: 'tickets' }" />
        <v-list-item v-if="isAdmin" :title="$t('nav.users')" :to="{ name: 'users' }" />
        <v-list-item v-if="isAdmin" :title="$t('nav.departments')" :to="{ name: 'departments' }" />
        <v-list-item v-if="isAdmin" :title="$t('nav.ticketCategories')" :to="{ name: 'ticket-categories' }" />
      </v-list>
    </v-navigation-drawer>

    <v-app-bar>
      <v-app-bar-title>AzmCRM</v-app-bar-title>
      <v-spacer />
      <v-btn-toggle :model-value="currentLocale" mandatory density="compact" class="mr-4">
        <v-btn value="en" @click="setLocale('en')">EN</v-btn>
        <v-btn value="ar" @click="setLocale('ar')">AR</v-btn>
      </v-btn-toggle>
      <v-menu>
        <template #activator="{ props }">
          <v-btn v-bind="props" data-testid="user-menu-activator">{{ auth.currentUser?.fullName }}</v-btn>
        </template>
        <v-list>
          <v-list-item :title="$t('nav.logout')" data-testid="logout-item" @click="handleLogout" />
        </v-list>
      </v-menu>
    </v-app-bar>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLocale } from 'vuetify';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const { locale: i18nLocale } = useI18n();
const { current: vuetifyLocale } = useLocale();

const isAdmin = computed(() => auth.currentUser?.role === 'ADMIN');

const currentLocale = ref(auth.currentUser?.locale === 'ar' ? 'ar' : 'en');

function setLocale(value: 'en' | 'ar') {
  currentLocale.value = value;
  i18nLocale.value = value;
  vuetifyLocale.value = value;
  document.documentElement.dir = value === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = value;
}

onMounted(() => {
  setLocale(auth.currentUser?.locale === 'ar' ? 'ar' : 'en');
});

function handleLogout() {
  auth.logout();
  router.push({ name: 'login' });
}
</script>
```

`frontend/tests/layouts/AppShell.test.ts` (full file — adds a `tickets` route stub to both mounts' route tables; the "Tickets" nav item is visible to every role, including the `ADMIN` user these tests already mount as):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../testUtils';
import { useAuthStore } from '../../src/stores/auth';
import AppShell from '../../src/layouts/AppShell.vue';

describe('AppShell', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.documentElement.dir = '';
    document.documentElement.lang = '';
  });

  it('switches document direction to rtl when Arabic is selected', async () => {
    const auth = useAuthStore();
    auth.currentUser = {
      id: '1',
      email: 'a@b.com',
      fullName: 'A B',
      role: 'ADMIN',
      departmentId: null,
      isActive: true,
      locale: 'en',
    };
    auth.token = 'fake-token';

    const wrapper = mountWithPlugins(AppShell, {}, [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/tickets', name: 'tickets', component: { template: '<div />' } },
      { path: '/users', name: 'users', component: { template: '<div />' } },
      { path: '/departments', name: 'departments', component: { template: '<div />' } },
      { path: '/ticket-categories', name: 'ticket-categories', component: { template: '<div />' } },
    ]);

    const arButton = wrapper.findAll('button').find((btn) => btn.text() === 'AR');
    expect(arButton).toBeTruthy();
    await arButton!.trigger('click');

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });

  it('logs out and redirects to login on logout click', async () => {
    const auth = useAuthStore();
    auth.currentUser = {
      id: '1',
      email: 'a@b.com',
      fullName: 'A B',
      role: 'ADMIN',
      departmentId: null,
      isActive: true,
      locale: 'en',
    };
    auth.token = 'fake-token';

    const wrapper = mountWithPlugins(AppShell, {}, [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/tickets', name: 'tickets', component: { template: '<div />' } },
      { path: '/users', name: 'users', component: { template: '<div />' } },
      { path: '/departments', name: 'departments', component: { template: '<div />' } },
      { path: '/ticket-categories', name: 'ticket-categories', component: { template: '<div />' } },
    ]);

    await wrapper.find('[data-testid="user-menu-activator"]').trigger('click');
    await wrapper.find('[data-testid="logout-item"]').trigger('click');

    expect(auth.isAuthenticated).toBe(false);
  });
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/tickets.ts frontend/src/views/tickets/TicketListView.vue frontend/src/router/index.ts frontend/src/layouts/AppShell.vue frontend/tests/layouts/AppShell.test.ts frontend/src/locales/en.json frontend/src/locales/ar.json frontend/tests/views/tickets/TicketListView.test.ts
git commit -m "feat(frontend): add ticket list view"
```

---

### Task 10: Ticket creation

**Files:**
- Modify: `frontend/src/api/tickets.ts`
- Create: `frontend/src/api/customers.ts`
- Create: `frontend/src/views/tickets/TicketCreateView.vue`
- Modify: `frontend/src/router/index.ts`
- Test: `frontend/tests/views/tickets/TicketCreateView.test.ts`

**Interfaces:**
- Consumes: `ApiTicketSummary`, `TicketPriority` (Task 9); `ApiTicketCategory`, `fetchTicketCategories` (Task 8); `fetchDepartments`, `ApiDepartment` (Foundation).
- Produces: `createTicket` in `api/tickets.ts` (returns `{ id: string }`, the minimum `TicketCreateView` needs to navigate to the new ticket); `ApiCustomer` type and `searchCustomers` in `api/customers.ts` — consumed by Task 12 too if it needs customer info (it doesn't; kept here since this is the only consumer in this phase).

- [ ] **Step 1: Write the failing test**

`frontend/tests/views/tickets/TicketCreateView.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/tickets', () => ({
  createTicket: vi.fn(),
}));
vi.mock('../../../src/api/customers', () => ({
  searchCustomers: vi.fn(),
}));
vi.mock('../../../src/api/ticketCategories', () => ({
  fetchTicketCategories: vi.fn(),
}));
vi.mock('../../../src/api/departments', () => ({
  fetchDepartments: vi.fn(),
}));

import { createTicket } from '../../../src/api/tickets';
import { searchCustomers } from '../../../src/api/customers';
import { fetchTicketCategories } from '../../../src/api/ticketCategories';
import { fetchDepartments } from '../../../src/api/departments';
import TicketCreateView from '../../../src/views/tickets/TicketCreateView.vue';

describe('TicketCreateView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(searchCustomers).mockResolvedValue([]);
    vi.mocked(fetchTicketCategories).mockResolvedValue([]);
    vi.mocked(fetchDepartments).mockResolvedValue([]);
    vi.mocked(createTicket).mockResolvedValue({ id: 'new-ticket-id' });
  });

  it('creates a ticket with an inline new customer and navigates to it', async () => {
    const wrapper = mountWithPlugins(TicketCreateView, {}, [
      { path: '/', component: { template: '<div />' } },
      { path: '/tickets/:id', name: 'ticket-detail', component: { template: '<div />' } },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await wrapper.find('[data-testid="toggle-new-customer"]').trigger('click');
    await wrapper.find('[data-testid="new-customer-name"] input').setValue('Jane Customer');
    await wrapper.find('[data-testid="ticket-subject"] input').setValue('Cannot log in');
    await wrapper.find('[data-testid="ticket-description"] textarea').setValue('Getting an error');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Cannot log in',
        description: 'Getting an error',
        newCustomer: expect.objectContaining({ fullName: 'Jane Customer' }),
      })
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `Cannot find module '../../../src/views/tickets/TicketCreateView.vue'`.

- [ ] **Step 3: Implement**

`frontend/src/api/customers.ts`:

```ts
import { apiClient } from './client';

export interface ApiCustomer {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}

export async function searchCustomers(query: string): Promise<ApiCustomer[]> {
  const res = await apiClient.get('/customers', { params: { query } });
  return res.data;
}
```

Update `frontend/src/api/tickets.ts` (full file — adds `createTicket`):

```ts
import { apiClient } from './client';

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

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
}

export async function fetchTickets(filters: { status?: TicketStatus } = {}): Promise<ApiTicketSummary[]> {
  const res = await apiClient.get('/tickets', { params: filters });
  return res.data;
}

export async function createTicket(data: {
  subject: string;
  description: string;
  customerId?: string;
  newCustomer?: { fullName: string; email?: string; phone?: string };
  categoryId?: string | null;
  departmentId?: string | null;
  priority?: TicketPriority;
}): Promise<{ id: string }> {
  const res = await apiClient.post('/tickets', data);
  return res.data;
}
```

`frontend/src/views/tickets/TicketCreateView.vue`:

```vue
<template>
  <v-container>
    <h1 class="mb-4">{{ $t('tickets.create') }}</h1>
    <form @submit.prevent="submit">
      <v-autocomplete
        v-if="!creatingNewCustomer"
        v-model="selectedCustomerId"
        v-model:search="customerQuery"
        :items="customerOptions"
        item-title="fullName"
        item-value="id"
        :label="$t('tickets.customer')"
        @update:search="onCustomerSearch"
      />
      <v-btn data-testid="toggle-new-customer" variant="text" class="mb-4" @click="toggleNewCustomer">
        {{ creatingNewCustomer ? $t('tickets.pickExistingCustomer') : $t('tickets.newCustomer') }}
      </v-btn>

      <template v-if="creatingNewCustomer">
        <v-text-field
          v-model="newCustomer.fullName"
          data-testid="new-customer-name"
          :label="$t('tickets.customerFullName')"
        />
        <v-text-field v-model="newCustomer.email" :label="$t('tickets.customerEmail')" />
        <v-text-field v-model="newCustomer.phone" :label="$t('tickets.customerPhone')" />
      </template>

      <v-text-field v-model="form.subject" data-testid="ticket-subject" :label="$t('tickets.subject')" />
      <v-textarea v-model="form.description" data-testid="ticket-description" :label="$t('tickets.description')" />
      <v-select v-model="form.priority" :items="priorityOptions" :label="$t('tickets.priority')" />
      <v-select
        v-model="form.categoryId"
        :items="categories"
        item-title="nameEn"
        item-value="id"
        :label="$t('tickets.category')"
        clearable
      />
      <v-select
        v-model="form.departmentId"
        :items="departments"
        item-title="nameEn"
        item-value="id"
        :label="$t('tickets.department')"
        clearable
      />
      <v-btn type="submit" color="primary">{{ $t('tickets.create') }}</v-btn>
    </form>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { createTicket, type TicketPriority } from '../../api/tickets';
import { searchCustomers, type ApiCustomer } from '../../api/customers';
import { fetchTicketCategories, type ApiTicketCategory } from '../../api/ticketCategories';
import { fetchDepartments, type ApiDepartment } from '../../api/departments';

const router = useRouter();

const creatingNewCustomer = ref(false);
const selectedCustomerId = ref<string | null>(null);
const customerQuery = ref('');
const customerOptions = ref<ApiCustomer[]>([]);
const newCustomer = reactive({ fullName: '', email: '', phone: '' });

const categories = ref<ApiTicketCategory[]>([]);
const departments = ref<ApiDepartment[]>([]);
const priorityOptions: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const form = reactive({
  subject: '',
  description: '',
  priority: 'MEDIUM' as TicketPriority,
  categoryId: null as string | null,
  departmentId: null as string | null,
});

function toggleNewCustomer() {
  creatingNewCustomer.value = !creatingNewCustomer.value;
  selectedCustomerId.value = null;
}

async function onCustomerSearch(query: string) {
  customerOptions.value = await searchCustomers(query);
}

async function submit() {
  let customerId: string | undefined;
  let newCustomerPayload: { fullName: string; email?: string; phone?: string } | undefined;

  if (creatingNewCustomer.value) {
    newCustomerPayload = {
      fullName: newCustomer.fullName,
      email: newCustomer.email || undefined,
      phone: newCustomer.phone || undefined,
    };
  } else {
    customerId = selectedCustomerId.value ?? undefined;
  }

  const ticket = await createTicket({
    subject: form.subject,
    description: form.description,
    customerId,
    newCustomer: newCustomerPayload,
    priority: form.priority,
    categoryId: form.categoryId,
    departmentId: form.departmentId,
  });

  router.push({ name: 'ticket-detail', params: { id: ticket.id } });
}

onMounted(async () => {
  categories.value = await fetchTicketCategories();
  departments.value = await fetchDepartments();
});
</script>
```

- [ ] **Step 4: Wire up the route**

`frontend/src/router/index.ts` — add one line to the `children` array of Task 9's router file, right after the `tickets` route:

```ts
        { path: 'tickets/new', name: 'ticket-new', component: TicketCreateView },
```

Full file (with the new import and route line in place):

```ts
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import LoginView from '../views/LoginView.vue';
import HomeView from '../views/HomeView.vue';
import AppShell from '../layouts/AppShell.vue';
import UserListView from '../views/users/UserListView.vue';
import DepartmentListView from '../views/departments/DepartmentListView.vue';
import TicketCategoryListView from '../views/ticketCategories/TicketCategoryListView.vue';
import TicketListView from '../views/tickets/TicketListView.vue';
import TicketCreateView from '../views/tickets/TicketCreateView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/',
      component: AppShell,
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'home', component: HomeView },
        { path: 'tickets', name: 'tickets', component: TicketListView },
        { path: 'tickets/new', name: 'ticket-new', component: TicketCreateView },
        { path: 'users', name: 'users', component: UserListView, meta: { roles: ['ADMIN'] } },
        { path: 'departments', name: 'departments', component: DepartmentListView, meta: { roles: ['ADMIN'] } },
        {
          path: 'ticket-categories',
          name: 'ticket-categories',
          component: TicketCategoryListView,
          meta: { roles: ['ADMIN'] },
        },
      ],
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login' };
  }
  const roles = to.meta.roles as string[] | undefined;
  if (roles && (!auth.currentUser || !roles.includes(auth.currentUser.role))) {
    return { name: 'home' };
  }
  return true;
});

export default router;
```

Note: `/tickets/new` must be registered **before** any `/tickets/:id` route would be (Task 11 adds `tickets/:id`) — vue-router matches routes in array order, and a literal `tickets/new` must win over a `tickets/:id` pattern that would otherwise also match the literal path `/tickets/new` with `id: 'new'`. This task registers `tickets/new` first; Task 11 must add `tickets/:id` **after** it in the array — this is called out again in Task 11.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/tickets.ts frontend/src/api/customers.ts frontend/src/views/tickets/TicketCreateView.vue frontend/src/router/index.ts frontend/tests/views/tickets/TicketCreateView.test.ts
git commit -m "feat(frontend): add ticket creation view with inline customer creation"
```

---

### Task 11: Ticket detail — read-only display and event timeline

**Files:**
- Modify: `frontend/src/api/tickets.ts`
- Create: `frontend/src/views/tickets/TicketDetailView.vue`
- Modify: `frontend/src/router/index.ts`
- Test: `frontend/tests/views/tickets/TicketDetailView.test.ts`

**Interfaces:**
- Consumes: `ApiTicketSummary`, `TicketStatus`, `TicketPriority` (Task 9).
- Produces: `TicketEventType`, `ApiTicketEvent`, `ApiTicketDetail` types and `fetchTicket` in `api/tickets.ts`; the `ticket-detail` route (`path: 'tickets/:id'`). Extended by Task 12 with the mutation controls on the same component.

- [ ] **Step 1: Write the failing test**

`frontend/tests/views/tickets/TicketDetailView.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/tickets', () => ({
  fetchTicket: vi.fn(),
}));

import { fetchTicket } from '../../../src/api/tickets';
import TicketDetailView from '../../../src/views/tickets/TicketDetailView.vue';

describe('TicketDetailView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchTicket).mockResolvedValue({
      id: 'ticket-1',
      subject: 'Cannot log in',
      description: 'Getting an error on login',
      status: 'OPEN',
      priority: 'HIGH',
      isEscalated: false,
      customer: { id: 'c1', fullName: 'Jane Customer' },
      category: null,
      department: null,
      assignee: null,
      createdBy: { id: 'u1', fullName: 'Agent Smith' },
      createdAt: '2026-08-27T00:00:00.000Z',
      events: [
        {
          id: 'e1',
          type: 'NOTE_ADDED',
          oldValue: null,
          newValue: null,
          note: 'Called the customer back',
          author: { id: 'u1', fullName: 'Agent Smith' },
          createdAt: '2026-08-27T01:00:00.000Z',
        },
      ],
    });
  });

  it('renders the ticket and its event timeline', async () => {
    const wrapper = mountWithPlugins(
      TicketDetailView,
      { global: { mocks: { $route: { params: { id: 'ticket-1' } } } } },
      [{ path: '/', component: { template: '<div />' } }]
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Cannot log in');
    expect(wrapper.text()).toContain('Jane Customer');
    expect(wrapper.text()).toContain('Called the customer back');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `Cannot find module '../../../src/views/tickets/TicketDetailView.vue'`.

- [ ] **Step 3: Implement**

Update `frontend/src/api/tickets.ts` (full file — adds the event/detail types and `fetchTicket`):

```ts
import { apiClient } from './client';

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketEventType =
  | 'STATUS_CHANGED'
  | 'PRIORITY_CHANGED'
  | 'CATEGORY_CHANGED'
  | 'DEPARTMENT_CHANGED'
  | 'ASSIGNEE_CHANGED'
  | 'ESCALATED'
  | 'UNESCALATED'
  | 'NOTE_ADDED';

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
}

export interface ApiTicketEvent {
  id: string;
  type: TicketEventType;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
  author: { id: string; fullName: string };
  createdAt: string;
}

export interface ApiTicketDetail extends ApiTicketSummary {
  description: string;
  createdBy: { id: string; fullName: string };
  events: ApiTicketEvent[];
}

export async function fetchTickets(filters: { status?: TicketStatus } = {}): Promise<ApiTicketSummary[]> {
  const res = await apiClient.get('/tickets', { params: filters });
  return res.data;
}

export async function createTicket(data: {
  subject: string;
  description: string;
  customerId?: string;
  newCustomer?: { fullName: string; email?: string; phone?: string };
  categoryId?: string | null;
  departmentId?: string | null;
  priority?: TicketPriority;
}): Promise<{ id: string }> {
  const res = await apiClient.post('/tickets', data);
  return res.data;
}

export async function fetchTicket(id: string): Promise<ApiTicketDetail> {
  const res = await apiClient.get(`/tickets/${id}`);
  return res.data;
}
```

`frontend/src/views/tickets/TicketDetailView.vue`:

```vue
<template>
  <v-container v-if="ticket">
    <div class="d-flex justify-space-between align-center mb-4">
      <h1>{{ ticket.subject }}</h1>
      <v-chip v-if="ticket.isEscalated" color="error">{{ $t('tickets.escalated') }}</v-chip>
    </div>

    <v-row>
      <v-col cols="12" md="8">
        <p class="mb-4">{{ ticket.description }}</p>

        <h2 class="text-h6 mb-2">{{ $t('tickets.timeline') }}</h2>
        <v-timeline density="compact" side="end">
          <v-timeline-item v-for="event in ticket.events" :key="event.id" size="small">
            <div>{{ describeEvent(event) }}</div>
            <div class="text-caption">{{ event.author.fullName }} — {{ new Date(event.createdAt).toLocaleString() }}</div>
          </v-timeline-item>
        </v-timeline>
      </v-col>

      <v-col cols="12" md="4">
        <v-list density="compact">
          <v-list-item :title="$t('tickets.customer')" :subtitle="ticket.customer.fullName" />
          <v-list-item :title="$t('tickets.status')" :subtitle="ticket.status" />
          <v-list-item :title="$t('tickets.priority')" :subtitle="ticket.priority" />
          <v-list-item :title="$t('tickets.assignee')" :subtitle="ticket.assignee?.fullName ?? '-'" />
          <v-list-item :title="$t('tickets.category')" :subtitle="ticket.category?.nameEn ?? '-'" />
          <v-list-item :title="$t('tickets.department')" :subtitle="ticket.department?.nameEn ?? '-'" />
          <v-list-item :title="$t('tickets.createdBy')" :subtitle="ticket.createdBy.fullName" />
        </v-list>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { fetchTicket, type ApiTicketDetail, type ApiTicketEvent } from '../../api/tickets';

const route = useRoute();
const ticket = ref<ApiTicketDetail | null>(null);

const eventDescriptions: Record<string, (event: ApiTicketEvent) => string> = {
  STATUS_CHANGED: (e) => `Status changed from ${e.oldValue} to ${e.newValue}`,
  PRIORITY_CHANGED: (e) => `Priority changed from ${e.oldValue} to ${e.newValue}`,
  CATEGORY_CHANGED: () => 'Category changed',
  DEPARTMENT_CHANGED: () => 'Department changed',
  ASSIGNEE_CHANGED: () => 'Assignee changed',
  ESCALATED: (e) => `Escalated${e.note ? `: ${e.note}` : ''}`,
  UNESCALATED: () => 'Unescalated',
  NOTE_ADDED: (e) => e.note ?? '',
};

function describeEvent(event: ApiTicketEvent): string {
  return eventDescriptions[event.type]?.(event) ?? event.type;
}

async function load() {
  ticket.value = await fetchTicket(route.params.id as string);
}

onMounted(load);
</script>
```

- [ ] **Step 4: Wire up the route**

`frontend/src/router/index.ts` (full file — adds `tickets/:id`, registered **after** `tickets/new` so the literal path wins the match, per Task 10's note):

```ts
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import LoginView from '../views/LoginView.vue';
import HomeView from '../views/HomeView.vue';
import AppShell from '../layouts/AppShell.vue';
import UserListView from '../views/users/UserListView.vue';
import DepartmentListView from '../views/departments/DepartmentListView.vue';
import TicketCategoryListView from '../views/ticketCategories/TicketCategoryListView.vue';
import TicketListView from '../views/tickets/TicketListView.vue';
import TicketCreateView from '../views/tickets/TicketCreateView.vue';
import TicketDetailView from '../views/tickets/TicketDetailView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/',
      component: AppShell,
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'home', component: HomeView },
        { path: 'tickets', name: 'tickets', component: TicketListView },
        { path: 'tickets/new', name: 'ticket-new', component: TicketCreateView },
        { path: 'tickets/:id', name: 'ticket-detail', component: TicketDetailView },
        { path: 'users', name: 'users', component: UserListView, meta: { roles: ['ADMIN'] } },
        { path: 'departments', name: 'departments', component: DepartmentListView, meta: { roles: ['ADMIN'] } },
        {
          path: 'ticket-categories',
          name: 'ticket-categories',
          component: TicketCategoryListView,
          meta: { roles: ['ADMIN'] },
        },
      ],
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login' };
  }
  const roles = to.meta.roles as string[] | undefined;
  if (roles && (!auth.currentUser || !roles.includes(auth.currentUser.role))) {
    return { name: 'home' };
  }
  return true;
});

export default router;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/tickets.ts frontend/src/views/tickets/TicketDetailView.vue frontend/src/router/index.ts frontend/tests/views/tickets/TicketDetailView.test.ts
git commit -m "feat(frontend): add read-only ticket detail view with event timeline"
```

---

### Task 12: Ticket detail — mutations (status/priority/category/department, assign, escalate, notes)

**Files:**
- Modify: `frontend/src/api/tickets.ts`
- Modify: `frontend/src/views/tickets/TicketDetailView.vue`
- Test: `frontend/tests/views/tickets/TicketDetailView.test.ts`

**Interfaces:**
- Consumes: everything from Task 11; `fetchUsers`, `ApiUser` (Foundation's `api/users.ts` — now reachable by `SUPERVISOR` too, per backend Task 6); `fetchTicketCategories` (Task 8); `fetchDepartments` (Foundation); `useAuthStore` (Foundation).
- Produces: `updateTicket`, `assignTicket`, `escalateTicket`, `unescalateTicket`, `addTicketNote` in `api/tickets.ts`. This is the last task in the plan — after it, the Foundation phase's ticketing engine is feature-complete.

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/views/tickets/TicketDetailView.test.ts` (extend the existing mocks and add a new test; full file shown since the mock setup needs new entries):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';
import { useAuthStore } from '../../../src/stores/auth';

vi.mock('../../../src/api/tickets', () => ({
  fetchTicket: vi.fn(),
  updateTicket: vi.fn(),
  assignTicket: vi.fn(),
  escalateTicket: vi.fn(),
  unescalateTicket: vi.fn(),
  addTicketNote: vi.fn(),
}));
vi.mock('../../../src/api/ticketCategories', () => ({
  fetchTicketCategories: vi.fn(),
}));
vi.mock('../../../src/api/departments', () => ({
  fetchDepartments: vi.fn(),
}));
vi.mock('../../../src/api/users', () => ({
  fetchUsers: vi.fn(),
}));

import { fetchTicket, addTicketNote } from '../../../src/api/tickets';
import { fetchTicketCategories } from '../../../src/api/ticketCategories';
import { fetchDepartments } from '../../../src/api/departments';
import { fetchUsers } from '../../../src/api/users';
import TicketDetailView from '../../../src/views/tickets/TicketDetailView.vue';

const baseTicket = {
  id: 'ticket-1',
  subject: 'Cannot log in',
  description: 'Getting an error on login',
  status: 'OPEN' as const,
  priority: 'HIGH' as const,
  isEscalated: false,
  customer: { id: 'c1', fullName: 'Jane Customer' },
  category: null,
  department: null,
  assignee: null,
  createdBy: { id: 'u1', fullName: 'Agent Smith' },
  createdAt: '2026-08-27T00:00:00.000Z',
  events: [
    {
      id: 'e1',
      type: 'NOTE_ADDED' as const,
      oldValue: null,
      newValue: null,
      note: 'Called the customer back',
      author: { id: 'u1', fullName: 'Agent Smith' },
      createdAt: '2026-08-27T01:00:00.000Z',
    },
  ],
};

describe('TicketDetailView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchTicket).mockResolvedValue(baseTicket);
    vi.mocked(fetchTicketCategories).mockResolvedValue([]);
    vi.mocked(fetchDepartments).mockResolvedValue([]);
    vi.mocked(fetchUsers).mockResolvedValue([]);
  });

  it('renders the ticket and its event timeline', async () => {
    const wrapper = mountWithPlugins(
      TicketDetailView,
      { global: { mocks: { $route: { params: { id: 'ticket-1' } } } } },
      [{ path: '/', component: { template: '<div />' } }]
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Cannot log in');
    expect(wrapper.text()).toContain('Jane Customer');
    expect(wrapper.text()).toContain('Called the customer back');
  });

  it('adds a note', async () => {
    vi.mocked(addTicketNote).mockResolvedValue({
      ...baseTicket,
      events: [
        ...baseTicket.events,
        {
          id: 'e2',
          type: 'NOTE_ADDED',
          oldValue: null,
          newValue: null,
          note: 'Follow-up call scheduled',
          author: { id: 'u1', fullName: 'Agent Smith' },
          createdAt: '2026-08-27T02:00:00.000Z',
        },
      ],
    });

    const auth = useAuthStore();
    auth.currentUser = {
      id: 'u1',
      email: 'agent@example.com',
      fullName: 'Agent Smith',
      role: 'AGENT',
      departmentId: null,
      isActive: true,
      locale: 'en',
    };

    const wrapper = mountWithPlugins(
      TicketDetailView,
      { global: { mocks: { $route: { params: { id: 'ticket-1' } } } } },
      [{ path: '/', component: { template: '<div />' } }]
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="note-input"] input').setValue('Follow-up call scheduled');
    await wrapper.find('[data-testid="add-note-button"]').trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(addTicketNote).toHaveBeenCalledWith('ticket-1', 'Follow-up call scheduled');
    expect(wrapper.text()).toContain('Follow-up call scheduled');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — the new `'adds a note'` test fails (`[data-testid="note-input"]` doesn't exist yet); the first test still passes against Task 11's read-only view.

- [ ] **Step 3: Implement**

Update `frontend/src/api/tickets.ts` (full file — adds the five mutation functions):

```ts
import { apiClient } from './client';

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketEventType =
  | 'STATUS_CHANGED'
  | 'PRIORITY_CHANGED'
  | 'CATEGORY_CHANGED'
  | 'DEPARTMENT_CHANGED'
  | 'ASSIGNEE_CHANGED'
  | 'ESCALATED'
  | 'UNESCALATED'
  | 'NOTE_ADDED';

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
}

export interface ApiTicketEvent {
  id: string;
  type: TicketEventType;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
  author: { id: string; fullName: string };
  createdAt: string;
}

export interface ApiTicketDetail extends ApiTicketSummary {
  description: string;
  createdBy: { id: string; fullName: string };
  events: ApiTicketEvent[];
}

export async function fetchTickets(filters: { status?: TicketStatus } = {}): Promise<ApiTicketSummary[]> {
  const res = await apiClient.get('/tickets', { params: filters });
  return res.data;
}

export async function createTicket(data: {
  subject: string;
  description: string;
  customerId?: string;
  newCustomer?: { fullName: string; email?: string; phone?: string };
  categoryId?: string | null;
  departmentId?: string | null;
  priority?: TicketPriority;
}): Promise<{ id: string }> {
  const res = await apiClient.post('/tickets', data);
  return res.data;
}

export async function fetchTicket(id: string): Promise<ApiTicketDetail> {
  const res = await apiClient.get(`/tickets/${id}`);
  return res.data;
}

export async function updateTicket(
  id: string,
  data: Partial<{ status: TicketStatus; priority: TicketPriority; categoryId: string | null; departmentId: string | null }>
): Promise<ApiTicketDetail> {
  const res = await apiClient.patch(`/tickets/${id}`, data);
  return res.data;
}

export async function assignTicket(id: string, assigneeId: string | null): Promise<ApiTicketDetail> {
  const res = await apiClient.post(`/tickets/${id}/assign`, { assigneeId });
  return res.data;
}

export async function escalateTicket(id: string, note?: string): Promise<ApiTicketDetail> {
  const res = await apiClient.post(`/tickets/${id}/escalate`, { note });
  return res.data;
}

export async function unescalateTicket(id: string): Promise<ApiTicketDetail> {
  const res = await apiClient.post(`/tickets/${id}/unescalate`);
  return res.data;
}

export async function addTicketNote(id: string, note: string): Promise<ApiTicketDetail> {
  const res = await apiClient.post(`/tickets/${id}/notes`, { note });
  return res.data;
}
```

`frontend/src/views/tickets/TicketDetailView.vue` (full file — replaces Task 11's version with the mutation controls added):

```vue
<template>
  <v-container v-if="ticket">
    <div class="d-flex justify-space-between align-center mb-4">
      <h1>{{ ticket.subject }}</h1>
      <v-chip v-if="ticket.isEscalated" color="error">{{ $t('tickets.escalated') }}</v-chip>
    </div>

    <v-row>
      <v-col cols="12" md="8">
        <p class="mb-4">{{ ticket.description }}</p>

        <v-text-field
          v-model="noteText"
          data-testid="note-input"
          :label="$t('tickets.addNote')"
          append-inner-icon="mdi-send"
          @click:append-inner="submitNote"
          @keyup.enter="submitNote"
        />
        <v-btn data-testid="add-note-button" class="d-none" @click="submitNote">{{ $t('tickets.addNote') }}</v-btn>

        <h2 class="text-h6 mb-2 mt-4">{{ $t('tickets.timeline') }}</h2>
        <v-timeline density="compact" side="end">
          <v-timeline-item v-for="event in ticket.events" :key="event.id" size="small">
            <div>{{ describeEvent(event) }}</div>
            <div class="text-caption">{{ event.author.fullName }} — {{ new Date(event.createdAt).toLocaleString() }}</div>
          </v-timeline-item>
        </v-timeline>
      </v-col>

      <v-col cols="12" md="4">
        <v-select
          :model-value="ticket.status"
          :items="statusOptions"
          :label="$t('tickets.status')"
          @update:model-value="onStatusChange"
        />
        <v-select
          :model-value="ticket.priority"
          :items="priorityOptions"
          :label="$t('tickets.priority')"
          @update:model-value="onPriorityChange"
        />
        <v-select
          :model-value="ticket.category?.id ?? null"
          :items="categories"
          item-title="nameEn"
          item-value="id"
          :label="$t('tickets.category')"
          clearable
          @update:model-value="onCategoryChange"
        />
        <v-select
          :model-value="ticket.department?.id ?? null"
          :items="departments"
          item-title="nameEn"
          item-value="id"
          :label="$t('tickets.department')"
          clearable
          @update:model-value="onDepartmentChange"
        />

        <v-select
          v-if="canReassignFreely"
          :model-value="ticket.assignee?.id ?? null"
          :items="agents"
          item-title="fullName"
          item-value="id"
          :label="$t('tickets.assignee')"
          clearable
          @update:model-value="onAssign"
        />
        <template v-else>
          <v-list-item :title="$t('tickets.assignee')" :subtitle="ticket.assignee?.fullName ?? '-'" />
          <v-btn v-if="!ticket.assignee" size="small" @click="claim">{{ $t('tickets.claim') }}</v-btn>
          <v-btn v-else-if="isAssignedToMe" size="small" @click="release">{{ $t('tickets.release') }}</v-btn>
        </template>

        <v-btn v-if="!ticket.isEscalated" class="mt-4" color="warning" block @click="escalateDialogOpen = true">
          {{ $t('tickets.escalate') }}
        </v-btn>
        <v-btn v-else class="mt-4" block @click="unescalate">{{ $t('tickets.unescalate') }}</v-btn>

        <v-list density="compact" class="mt-4">
          <v-list-item :title="$t('tickets.customer')" :subtitle="ticket.customer.fullName" />
          <v-list-item :title="$t('tickets.createdBy')" :subtitle="ticket.createdBy.fullName" />
        </v-list>
      </v-col>
    </v-row>

    <v-dialog v-model="escalateDialogOpen" max-width="480">
      <v-card :title="$t('tickets.escalate')">
        <v-card-text>
          <v-text-field v-model="escalateNote" :label="$t('tickets.escalateNote')" />
          <v-btn color="warning" @click="escalate">{{ $t('tickets.escalate') }}</v-btn>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
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
} from '../../api/tickets';
import { fetchTicketCategories, type ApiTicketCategory } from '../../api/ticketCategories';
import { fetchDepartments, type ApiDepartment } from '../../api/departments';
import { fetchUsers, type ApiUser } from '../../api/users';
import { useAuthStore } from '../../stores/auth';

const route = useRoute();
const auth = useAuthStore();
const ticket = ref<ApiTicketDetail | null>(null);
const categories = ref<ApiTicketCategory[]>([]);
const departments = ref<ApiDepartment[]>([]);
const agents = ref<ApiUser[]>([]);
const noteText = ref('');
const escalateDialogOpen = ref(false);
const escalateNote = ref('');

const statusOptions: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const priorityOptions: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const canReassignFreely = computed(
  () => auth.currentUser?.role === 'ADMIN' || auth.currentUser?.role === 'SUPERVISOR'
);
const isAssignedToMe = computed(() => ticket.value?.assignee?.id === auth.currentUser?.id);

const eventDescriptions: Record<string, (event: ApiTicketEvent) => string> = {
  STATUS_CHANGED: (e) => `Status changed from ${e.oldValue} to ${e.newValue}`,
  PRIORITY_CHANGED: (e) => `Priority changed from ${e.oldValue} to ${e.newValue}`,
  CATEGORY_CHANGED: () => 'Category changed',
  DEPARTMENT_CHANGED: () => 'Department changed',
  ASSIGNEE_CHANGED: () => 'Assignee changed',
  ESCALATED: (e) => `Escalated${e.note ? `: ${e.note}` : ''}`,
  UNESCALATED: () => 'Unescalated',
  NOTE_ADDED: (e) => e.note ?? '',
};

function describeEvent(event: ApiTicketEvent): string {
  return eventDescriptions[event.type]?.(event) ?? event.type;
}

async function load() {
  ticket.value = await fetchTicket(route.params.id as string);
}

async function onStatusChange(value: TicketStatus) {
  ticket.value = await updateTicket(route.params.id as string, { status: value });
}

async function onPriorityChange(value: TicketPriority) {
  ticket.value = await updateTicket(route.params.id as string, { priority: value });
}

async function onCategoryChange(value: string | null) {
  ticket.value = await updateTicket(route.params.id as string, { categoryId: value });
}

async function onDepartmentChange(value: string | null) {
  ticket.value = await updateTicket(route.params.id as string, { departmentId: value });
}

async function onAssign(value: string | null) {
  ticket.value = await assignTicket(route.params.id as string, value);
}

async function claim() {
  ticket.value = await assignTicket(route.params.id as string, auth.currentUser!.id);
}

async function release() {
  ticket.value = await assignTicket(route.params.id as string, null);
}

async function escalate() {
  ticket.value = await escalateTicket(route.params.id as string, escalateNote.value || undefined);
  escalateDialogOpen.value = false;
  escalateNote.value = '';
}

async function unescalate() {
  ticket.value = await unescalateTicket(route.params.id as string);
}

async function submitNote() {
  if (!noteText.value.trim()) return;
  ticket.value = await addTicketNote(route.params.id as string, noteText.value);
  noteText.value = '';
}

onMounted(async () => {
  await load();
  categories.value = await fetchTicketCategories();
  departments.value = await fetchDepartments();
  if (canReassignFreely.value) {
    agents.value = await fetchUsers();
  }
});
</script>
```

Note on the hidden `data-testid="add-note-button"`: the visible way to submit a note is the text field's send icon (`@click:append-inner`) or pressing Enter; the hidden button (`class="d-none"`, same `submitNote` handler) exists solely so the test can trigger the action without depending on Vuetify's icon-slot DOM structure, which is more fragile to select in tests. This mirrors the codebase's existing preference for `data-testid` attributes on interactive elements the tests need to reach (see `AppShell.vue`'s `user-menu-activator`/`logout-item`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all tests). This completes the Ticket Management sub-project.

- [ ] **Step 5: Manual end-to-end check**

With both dev servers running (`cd backend && npm run dev`, `cd frontend && npm run dev`) and Postgres up:

1. Log in as the seeded admin. Go to **Tickets → New Ticket**. Toggle "New customer", fill in a name, subject, and description, submit. Confirm you land on the new ticket's detail page.
2. On the detail page, change the status dropdown — confirm the timeline gets a new "Status changed..." entry immediately.
3. Add a note — confirm it appears in the timeline.
4. Click **Escalate**, add a note, confirm — confirm the escalated chip appears and the button becomes **Unescalate**.
5. As the same agent, if the ticket is unassigned, click **Claim** — confirm you become the assignee and a "Release" button appears.
6. Log in as an Admin (or Supervisor), open the same ticket — confirm the assignee field is now a dropdown you can freely change to any agent.
7. Go to **Ticket Categories** (Admin) — confirm you can create a category, then go back to a ticket and confirm it now appears in the category dropdown.

Report exactly what you did and observed, the same way the Foundation plan's final manual check was reported.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/tickets.ts frontend/src/views/tickets/TicketDetailView.vue frontend/tests/views/tickets/TicketDetailView.test.ts
git commit -m "feat(frontend): add ticket detail mutations (status/priority/category/department, assign, escalate, notes)"
```

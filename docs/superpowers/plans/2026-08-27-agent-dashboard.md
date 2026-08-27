# Agent Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `/home` page with a role-adaptive Agent Dashboard (assigned tickets, personal tasks, team activity, and — for Supervisors/Admins — unassigned queue, escalations, and team workload), plus admin-managed quick-reply snippets usable when adding a ticket note.

**Architecture:** Extends the existing Foundation/Ticket Management layout — no new top-level structure. Backend adds two new Prisma models (`Task`, `QuickReply`) with their own `routes → controllers → services` slices, plus small extensions to the existing ticket list filters and a new cross-ticket recent-events endpoint. Frontend replaces `HomeView.vue` with a `DashboardView.vue` composed of small, independently-fetching widget components under `components/dashboard/`, and adds a `QuickReplyListView.vue` admin page plus a quick-reply picker on the existing `TicketDetailView.vue`.

**Tech Stack:** Same as Foundation/Ticket Management — Express + TypeScript + Prisma (pinned `6.19.3`) + PostgreSQL backend; Vue 3 + Vuetify + TypeScript + Pinia frontend; Vitest for both.

**Spec:** [docs/superpowers/specs/2026-08-27-agent-dashboard-design.md](../specs/2026-08-27-agent-dashboard-design.md)

## Global Constraints

- `prisma`/`@prisma/client` stay pinned to the exact version `6.19.3` — do not `npm install` either unpinned.
- Installed `zod` is v4: `ZodError` has no `.errors` property, use `.issues` (already correct in `validate.ts`).
- `backend/vitest.config.ts` has `fileParallelism: false` (standing strategy, tests share one real Postgres DB) — leave it as-is.
- `frontend/tests/testUtils.ts`'s test-only Vuetify instance has `attach: true` for VMenu/VDialog/VOverlay/VSelect/VAutocomplete/VTooltip — dialogs/selects/autocompletes in new tests just work without extra setup.
- A `v-list-item :to="{name: '...'}"` resolves its target **eagerly at render**, not lazily on click — any test that mounts a component containing such a nav item or link MUST have that route registered in the test's router table, or the mount will throw. This applies to `AppShell.vue` nav tests and to `DashboardView.vue` widget tests that render ticket links (`{ name: 'ticket-detail' }`).
- Error responses are always shaped `{ error: { code, message } }` (unchanged).
- Tasks are strictly self-scoped: no admin override, no cross-user visibility, in this phase.
- Quick replies carry no relation to `TicketEvent` — their text is copied into a note at insertion time, not referenced by id.

---

## Backend

### Task 1: Task entity — personal tasks CRUD, self-scoped

**Files:**
- Modify: `backend/prisma/schema.prisma` (add `Task` model; add `tasks Task[]` reverse relation to `User` and to `Ticket`)
- Create: `backend/src/services/tasks.service.ts`
- Create: `backend/src/controllers/tasks.controller.ts`
- Create: `backend/src/routes/tasks.routes.ts`
- Modify: `backend/src/app.ts` (mount `tasksRouter` at `/api/tasks`)
- Modify: `backend/tests/setup.ts` (delete `Task` rows before `Ticket`/`User`, since `Task` references both)
- Test: `backend/tests/routes/tasks.test.ts`

**Interfaces:**
- Consumes: `prisma`, `HttpError` (Foundation); `authenticate` (Foundation); `validate` (Foundation).
- Produces: `GET/POST /api/tasks`, `PATCH/DELETE /api/tasks/:id` — always scoped to `req.user.id` as owner. Consumed by the frontend's `MyTasksWidget` (Task 5).

- [ ] **Step 1: Write the failing test**

`backend/tests/routes/tasks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';
import { signToken } from '../../src/lib/jwt';

const app = createApp();

async function createAgent(email: string) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('password123'),
      fullName: 'Agent User',
      role: 'AGENT',
    },
  });
  const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
  return { user, token };
}

async function createCustomerFixture() {
  return prisma.customer.create({ data: { fullName: 'Jane Customer', email: 'jane@example.com' } });
}

describe('/api/tasks', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
  });

  it('creates a task owned by the caller', async () => {
    const { token } = await createAgent('owner1@example.com');
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Call back Jane' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Call back Jane');
    expect(res.body.isDone).toBe(false);
    expect(res.body.ticketId).toBeNull();
  });

  it('creates a task linked to a ticket', async () => {
    const { user, token } = await createAgent('owner2@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Follow up', ticketId: ticket.id });

    expect(res.status).toBe(201);
    expect(res.body.ticketId).toBe(ticket.id);
  });

  it('lists only the caller\'s own tasks', async () => {
    const { token: tokenA } = await createAgent('lister-a@example.com');
    const { token: tokenB } = await createAgent('lister-b@example.com');

    await request(app).post('/api/tasks').set('Authorization', `Bearer ${tokenA}`).send({ title: 'A task' });
    await request(app).post('/api/tasks').set('Authorization', `Bearer ${tokenB}`).send({ title: 'B task' });

    const res = await request(app).get('/api/tasks').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('A task');
  });

  it('filters by done status', async () => {
    const { token } = await createAgent('filterer@example.com');
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'To finish' });
    await request(app)
      .patch(`/api/tasks/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isDone: true });
    await request(app).post('/api/tasks').set('Authorization', `Bearer ${token}`).send({ title: 'Still open' });

    const res = await request(app).get('/api/tasks?done=false').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Still open');
  });

  it('updates and marks a task done', async () => {
    const { token } = await createAgent('updater@example.com');
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Original title' });

    const res = await request(app)
      .patch(`/api/tasks/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated title', isDone: true });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated title');
    expect(res.body.isDone).toBe(true);
  });

  it('returns 404 updating a task owned by someone else', async () => {
    const { token: ownerToken } = await createAgent('owner3@example.com');
    const { token: otherToken } = await createAgent('other1@example.com');
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Private task' });

    const res = await request(app)
      .patch(`/api/tasks/${createRes.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ title: 'Hijacked' });

    expect(res.status).toBe(404);
  });

  it('deletes a task owned by the caller', async () => {
    const { token } = await createAgent('deleter@example.com');
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Delete me' });

    const res = await request(app).delete(`/api/tasks/${createRes.body.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);

    const listRes = await request(app).get('/api/tasks').set('Authorization', `Bearer ${token}`);
    expect(listRes.body).toHaveLength(0);
  });

  it('returns 404 deleting a task owned by someone else', async () => {
    const { token: ownerToken } = await createAgent('owner4@example.com');
    const { token: otherToken } = await createAgent('other2@example.com');
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Not yours' });

    const res = await request(app)
      .delete(`/api/tasks/${createRes.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/routes/tasks.test.ts`
Expected: FAIL — 404s, `/api/tasks` isn't mounted yet, and `prisma.task` doesn't exist on the client.

- [ ] **Step 3: Update the Prisma schema**

`backend/prisma/schema.prisma` — add the `Task` model, and add one line each to `User` and `Ticket`:

```prisma
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
  tasks           Task[]
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
}
```

```prisma
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
  tasks        Task[]

  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
}
```

Add the new model anywhere after `Ticket`:

```prisma
model Task {
  id        String    @id @default(uuid())
  title     String
  dueAt     DateTime?
  isDone    Boolean   @default(false)
  owner     User      @relation(fields: [ownerId], references: [id])
  ownerId   String
  ticket    Ticket?   @relation(fields: [ticketId], references: [id])
  ticketId  String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}
```

- [ ] **Step 4: Update the test-DB cleanup order**

`backend/tests/setup.ts` (full file — `Task` references `User` and `Ticket`, so it must clear before both):

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
npm run prisma:migrate -- --name add_tasks
```

Expected: a new migration is created and applied against your local `azmcrm` dev DB, and the Prisma Client is regenerated. Then apply it to the **test** database:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/azmcrm_test?schema=public" npx prisma migrate deploy
```

(adjust the connection string to match your local `.env.test` if it differs).

- [ ] **Step 6: Implement the service, controller, and routes**

`backend/src/services/tasks.service.ts`:

```ts
import { Task } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/httpError';

export async function listTasks(
  ownerId: string,
  filters: { done?: boolean; ticketId?: string }
): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      ownerId,
      isDone: filters.done,
      ticketId: filters.ticketId,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createTask(
  ownerId: string,
  data: { title: string; dueAt?: Date | null; ticketId?: string | null }
): Promise<Task> {
  return prisma.task.create({
    data: {
      title: data.title,
      dueAt: data.dueAt ?? null,
      ticketId: data.ticketId ?? null,
      ownerId,
    },
  });
}

async function requireOwnedTask(id: string, ownerId: string): Promise<Task> {
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task || task.ownerId !== ownerId) {
    throw new HttpError(404, 'NOT_FOUND', 'Task not found');
  }
  return task;
}

export async function updateTask(
  id: string,
  ownerId: string,
  data: Partial<{ title: string; dueAt: Date | null; ticketId: string | null; isDone: boolean }>
): Promise<Task> {
  await requireOwnedTask(id, ownerId);
  return prisma.task.update({ where: { id }, data });
}

export async function deleteTask(id: string, ownerId: string): Promise<void> {
  await requireOwnedTask(id, ownerId);
  await prisma.task.delete({ where: { id } });
}
```

`backend/src/controllers/tasks.controller.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import * as tasksService from '../services/tasks.service';

export async function listTasksHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { done, ticketId } = req.query;
    res.json(
      await tasksService.listTasks(req.user!.id, {
        done: done === undefined ? undefined : done === 'true',
        ticketId: ticketId as string | undefined,
      })
    );
  } catch (err) {
    next(err);
  }
}

export async function createTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await tasksService.createTask(req.user!.id, req.body));
  } catch (err) {
    next(err);
  }
}

export async function updateTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await tasksService.updateTask(req.params.id as string, req.user!.id, req.body));
  } catch (err) {
    next(err);
  }
}

export async function deleteTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await tasksService.deleteTask(req.params.id as string, req.user!.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
```

`backend/src/routes/tasks.routes.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import {
  listTasksHandler,
  createTaskHandler,
  updateTaskHandler,
  deleteTaskHandler,
} from '../controllers/tasks.controller';

const createTaskSchema = z.object({
  title: z.string().min(1),
  dueAt: z.coerce.date().nullable().optional(),
  ticketId: z.string().uuid().nullable().optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  dueAt: z.coerce.date().nullable().optional(),
  ticketId: z.string().uuid().nullable().optional(),
  isDone: z.boolean().optional(),
});

export const tasksRouter = Router();

tasksRouter.use(authenticate);
tasksRouter.get('/', listTasksHandler);
tasksRouter.post('/', validate(createTaskSchema), createTaskHandler);
tasksRouter.patch('/:id', validate(updateTaskSchema), updateTaskHandler);
tasksRouter.delete('/:id', deleteTaskHandler);
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

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/services/tasks.service.ts backend/src/controllers/tasks.controller.ts backend/src/routes/tasks.routes.ts backend/src/app.ts backend/tests/setup.ts backend/tests/routes/tasks.test.ts
git commit -m "feat(backend): add self-scoped personal tasks"
```

---

### Task 2: QuickReply entity — admin-managed canned text CRUD

**Files:**
- Modify: `backend/prisma/schema.prisma` (add `QuickReply` model — no relations)
- Create: `backend/src/services/quickReplies.service.ts`
- Create: `backend/src/controllers/quickReplies.controller.ts`
- Create: `backend/src/routes/quickReplies.routes.ts`
- Modify: `backend/src/app.ts` (mount `quickRepliesRouter` at `/api/quick-replies`)
- Modify: `backend/tests/setup.ts` (add `quickReply.deleteMany()`)
- Test: `backend/tests/routes/quickReplies.test.ts`

**Interfaces:**
- Consumes: `prisma`, `HttpError` (Foundation); `authenticate`, `authorize`, `validate` (Foundation).
- Produces: `GET /api/quick-replies` (any authenticated staff), `POST/PATCH /api/quick-replies/:id` (`ADMIN`-only). Consumed by the frontend's `QuickReplyListView` (Task 8) and `TicketDetailView`'s note picker (Task 9).

- [ ] **Step 1: Write the failing test**

`backend/tests/routes/quickReplies.test.ts`:

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

describe('/api/quick-replies', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/quick-replies');
    expect(res.status).toBe(401);
  });

  it('lets any authenticated staff read quick replies', async () => {
    const { token } = await createAgent();
    await prisma.quickReply.create({
      data: {
        titleEn: 'Greeting',
        titleAr: 'ترحيب',
        bodyEn: 'Hello, thanks for reaching out!',
        bodyAr: 'مرحبًا، شكرًا لتواصلك معنا!',
      },
    });

    const res = await request(app).get('/api/quick-replies').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('rejects a non-admin creating a quick reply', async () => {
    const { token } = await createAgent();
    const res = await request(app)
      .post('/api/quick-replies')
      .set('Authorization', `Bearer ${token}`)
      .send({ titleEn: 'Greeting', titleAr: 'ترحيب', bodyEn: 'Hello', bodyAr: 'مرحبًا' });
    expect(res.status).toBe(403);
  });

  it('creates and lists quick replies for an admin', async () => {
    const { token } = await createAdmin();
    const createRes = await request(app)
      .post('/api/quick-replies')
      .set('Authorization', `Bearer ${token}`)
      .send({
        titleEn: 'Greeting',
        titleAr: 'ترحيب',
        bodyEn: 'Hello, thanks for reaching out!',
        bodyAr: 'مرحبًا، شكرًا لتواصلك معنا!',
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.titleEn).toBe('Greeting');

    const listRes = await request(app).get('/api/quick-replies').set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
  });

  it('updates a quick reply', async () => {
    const { token } = await createAdmin();
    const reply = await prisma.quickReply.create({
      data: { titleEn: 'Greeting', titleAr: 'ترحيب', bodyEn: 'Hello', bodyAr: 'مرحبًا' },
    });
    const res = await request(app)
      .patch(`/api/quick-replies/${reply.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ bodyEn: 'Hello there, thanks for reaching out!' });

    expect(res.status).toBe(200);
    expect(res.body.bodyEn).toBe('Hello there, thanks for reaching out!');
  });

  it('rejects an update to a non-existent quick reply', async () => {
    const { token } = await createAdmin();
    const res = await request(app)
      .patch('/api/quick-replies/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ titleEn: 'Nope' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/routes/quickReplies.test.ts`
Expected: FAIL — `prisma.quickReply` doesn't exist and `/api/quick-replies` isn't mounted.

- [ ] **Step 3: Update the Prisma schema**

`backend/prisma/schema.prisma` — add anywhere after `TicketCategory`:

```prisma
model QuickReply {
  id        String   @id @default(uuid())
  titleEn   String
  titleAr   String
  bodyEn    String
  bodyAr    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 4: Update the test-DB cleanup order**

`backend/tests/setup.ts` (full file — `QuickReply` has no relations, so it can be deleted anywhere; grouped next to `TicketCategory`):

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
npm run prisma:migrate -- --name add_quick_replies
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/azmcrm_test?schema=public" npx prisma migrate deploy
```

(adjust the test-DB connection string to match your local `.env.test` if it differs).

- [ ] **Step 6: Implement the service, controller, and routes**

`backend/src/services/quickReplies.service.ts`:

```ts
import { QuickReply } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/httpError';

export async function listQuickReplies(): Promise<QuickReply[]> {
  return prisma.quickReply.findMany({ orderBy: { titleEn: 'asc' } });
}

export async function createQuickReply(data: {
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}): Promise<QuickReply> {
  return prisma.quickReply.create({ data });
}

export async function updateQuickReply(
  id: string,
  data: Partial<{ titleEn: string; titleAr: string; bodyEn: string; bodyAr: string }>
): Promise<QuickReply> {
  try {
    return await prisma.quickReply.update({ where: { id }, data });
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'Quick reply not found');
  }
}
```

`backend/src/controllers/quickReplies.controller.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import * as quickRepliesService from '../services/quickReplies.service';

export async function listQuickRepliesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await quickRepliesService.listQuickReplies());
  } catch (err) {
    next(err);
  }
}

export async function createQuickReplyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await quickRepliesService.createQuickReply(req.body));
  } catch (err) {
    next(err);
  }
}

export async function updateQuickReplyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await quickRepliesService.updateQuickReply(req.params.id as string, req.body));
  } catch (err) {
    next(err);
  }
}
```

`backend/src/routes/quickReplies.routes.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  listQuickRepliesHandler,
  createQuickReplyHandler,
  updateQuickReplyHandler,
} from '../controllers/quickReplies.controller';

const createQuickReplySchema = z.object({
  titleEn: z.string().min(1),
  titleAr: z.string().min(1),
  bodyEn: z.string().min(1),
  bodyAr: z.string().min(1),
});

const updateQuickReplySchema = z.object({
  titleEn: z.string().min(1).optional(),
  titleAr: z.string().min(1).optional(),
  bodyEn: z.string().min(1).optional(),
  bodyAr: z.string().min(1).optional(),
});

export const quickRepliesRouter = Router();

quickRepliesRouter.use(authenticate);
quickRepliesRouter.get('/', listQuickRepliesHandler);
quickRepliesRouter.post(
  '/',
  authorize('ADMIN'),
  validate(createQuickReplySchema),
  createQuickReplyHandler
);
quickRepliesRouter.patch(
  '/:id',
  authorize('ADMIN'),
  validate(updateQuickReplySchema),
  updateQuickReplyHandler
);
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

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/services/quickReplies.service.ts backend/src/controllers/quickReplies.controller.ts backend/src/routes/quickReplies.routes.ts backend/src/app.ts backend/tests/setup.ts backend/tests/routes/quickReplies.test.ts
git commit -m "feat(backend): add admin-managed quick replies"
```

---

### Task 3: Ticket list filter extensions + recent team activity endpoint

**Files:**
- Modify: `backend/src/services/tickets.service.ts` (add `unassigned`/`escalated` filters to `listTickets`; add `listRecentTicketEvents`)
- Modify: `backend/src/controllers/tickets.controller.ts` (pass through the two new query params)
- Create: `backend/src/controllers/ticketEvents.controller.ts`
- Create: `backend/src/routes/ticketEvents.routes.ts`
- Modify: `backend/src/app.ts` (mount `ticketEventsRouter` at `/api/ticket-events`)
- Modify: `backend/tests/routes/tickets.test.ts` (append filter tests)
- Test: `backend/tests/routes/ticketEvents.test.ts`

**Interfaces:**
- Consumes: everything already in `tickets.service.ts` (Ticket Management).
- Produces: `GET /api/tickets?unassigned=true`, `GET /api/tickets?escalated=true` (compose with existing filters); `GET /api/ticket-events/recent?limit=` (any authenticated staff, default 20, capped 50) returning `{ id, type, oldValue, newValue, note, createdAt, author: { id, fullName }, ticket: { id, subject } }[]`. Consumed by the frontend's `UnassignedQueueWidget`/`EscalatedTicketsWidget` (Task 7) and `TeamActivityWidget` (Task 6).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/routes/tickets.test.ts` (new `describe` block after the existing ones, same file/imports/helpers already present):

```ts
describe('GET /api/tickets filters', () => {
  it('filters unassigned tickets', async () => {
    const { user, token } = await createStaff('AGENT', 'filter1@example.com');
    const { user: agent2 } = await createStaff('AGENT', 'filter1b@example.com');
    const customer = await createCustomerFixture();
    await prisma.ticket.create({
      data: { subject: 'Unassigned', description: 'Desc', customerId: customer.id, createdById: user.id },
    });
    await prisma.ticket.create({
      data: {
        subject: 'Assigned',
        description: 'Desc',
        customerId: customer.id,
        createdById: user.id,
        assigneeId: agent2.id,
      },
    });

    const res = await request(app).get('/api/tickets?unassigned=true').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].subject).toBe('Unassigned');
  });

  it('filters escalated tickets', async () => {
    const { user, token } = await createStaff('AGENT', 'filter2@example.com');
    const customer = await createCustomerFixture();
    await prisma.ticket.create({
      data: { subject: 'Normal', description: 'Desc', customerId: customer.id, createdById: user.id },
    });
    await prisma.ticket.create({
      data: {
        subject: 'Escalated',
        description: 'Desc',
        customerId: customer.id,
        createdById: user.id,
        isEscalated: true,
      },
    });

    const res = await request(app).get('/api/tickets?escalated=true').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].subject).toBe('Escalated');
  });
});
```

`backend/tests/routes/ticketEvents.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';
import { signToken } from '../../src/lib/jwt';

const app = createApp();

async function createAgent(email: string) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('password123'),
      fullName: 'Agent User',
      role: 'AGENT',
    },
  });
  const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
  return { user, token };
}

describe('GET /api/ticket-events/recent', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/ticket-events/recent');
    expect(res.status).toBe(401);
  });

  it('returns recent events across tickets in descending order', async () => {
    const { user, token } = await createAgent('events@example.com');
    const customer = await prisma.customer.create({ data: { fullName: 'Jane Customer' } });
    const ticketA = await prisma.ticket.create({
      data: { subject: 'Ticket A', description: 'Desc', customerId: customer.id, createdById: user.id },
    });
    const ticketB = await prisma.ticket.create({
      data: { subject: 'Ticket B', description: 'Desc', customerId: customer.id, createdById: user.id },
    });
    await prisma.ticketEvent.create({
      data: { ticketId: ticketA.id, type: 'NOTE_ADDED', note: 'First', authorId: user.id },
    });
    await prisma.ticketEvent.create({
      data: { ticketId: ticketB.id, type: 'NOTE_ADDED', note: 'Second', authorId: user.id },
    });

    const res = await request(app).get('/api/ticket-events/recent').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].note).toBe('Second');
    expect(res.body[0].ticket.subject).toBe('Ticket B');
    expect(res.body[1].note).toBe('First');
  });

  it('respects the limit query param', async () => {
    const { user, token } = await createAgent('events2@example.com');
    const customer = await prisma.customer.create({ data: { fullName: 'Jane Customer' } });
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });
    for (let i = 0; i < 3; i += 1) {
      await prisma.ticketEvent.create({
        data: { ticketId: ticket.id, type: 'NOTE_ADDED', note: `Note ${i}`, authorId: user.id },
      });
    }

    const res = await request(app)
      .get('/api/ticket-events/recent?limit=2')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run tests/routes/tickets.test.ts tests/routes/ticketEvents.test.ts`
Expected: FAIL — the two new filter tests get unfiltered results back (400 or wrong length), and `/api/ticket-events/recent` 404s.

- [ ] **Step 3: Implement**

`backend/src/services/tickets.service.ts` — modify the top import line, `listTickets`, and append `listRecentTicketEvents` (full file):

```ts
import { Prisma, Role, TicketEventType, TicketPriority, TicketStatus } from '@prisma/client';
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
  unassigned?: boolean;
  escalated?: boolean;
}): Promise<TicketWithRelations[]> {
  return prisma.ticket.findMany({
    where: {
      status: filters.status,
      assigneeId: filters.unassigned ? null : filters.assigneeId,
      departmentId: filters.departmentId,
      categoryId: filters.categoryId,
      isEscalated: filters.escalated ? true : undefined,
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
    const updateData: Prisma.TicketUncheckedUpdateInput = {};

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
    const claimingSelf = assigneeId === requester.id && current.assigneeId === null;
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

export interface RecentTicketEvent {
  id: string;
  type: TicketEventType;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
  createdAt: Date;
  author: { id: string; fullName: string };
  ticket: { id: string; subject: string };
}

export async function listRecentTicketEvents(limit?: number): Promise<RecentTicketEvent[]> {
  const cappedLimit = Math.min(limit ?? 20, 50);
  return prisma.ticketEvent.findMany({
    take: cappedLimit,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      oldValue: true,
      newValue: true,
      note: true,
      createdAt: true,
      author: { select: { id: true, fullName: true } },
      ticket: { select: { id: true, subject: true } },
    },
  });
}
```

`backend/src/controllers/tickets.controller.ts` — modify only `listTicketsHandler` (rest of the file unchanged):

```ts
export async function listTicketsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, assigneeId, departmentId, categoryId, unassigned, escalated } = req.query;
    res.json(
      await ticketsService.listTickets({
        status: status as TicketStatus | undefined,
        assigneeId: assigneeId as string | undefined,
        departmentId: departmentId as string | undefined,
        categoryId: categoryId as string | undefined,
        unassigned: unassigned === 'true',
        escalated: escalated === 'true',
      })
    );
  } catch (err) {
    next(err);
  }
}
```

`backend/src/controllers/ticketEvents.controller.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import * as ticketsService from '../services/tickets.service';

export async function listRecentTicketEventsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await ticketsService.listRecentTicketEvents(limit));
  } catch (err) {
    next(err);
  }
}
```

`backend/src/routes/ticketEvents.routes.ts`:

```ts
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { listRecentTicketEventsHandler } from '../controllers/ticketEvents.controller';

export const ticketEventsRouter = Router();

ticketEventsRouter.use(authenticate);
ticketEventsRouter.get('/recent', listRecentTicketEventsHandler);
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

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tickets.service.ts backend/src/controllers/tickets.controller.ts backend/src/controllers/ticketEvents.controller.ts backend/src/routes/ticketEvents.routes.ts backend/src/app.ts backend/tests/routes/tickets.test.ts backend/tests/routes/ticketEvents.test.ts
git commit -m "feat(backend): add unassigned/escalated ticket filters and recent activity endpoint"
```

---

## Frontend

### Task 4: DashboardView + My Tickets widget (replaces HomeView, all roles)

**Files:**
- Create: `frontend/src/views/DashboardView.vue`
- Create: `frontend/src/components/dashboard/MyTicketsWidget.vue`
- Modify: `frontend/src/api/tickets.ts` (extend `fetchTickets` filter type)
- Modify: `frontend/src/router/index.ts` (import `DashboardView` instead of `HomeView` for the `home` route)
- Delete: `frontend/src/views/HomeView.vue`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (add `dashboard` namespace)
- Test: `frontend/tests/views/DashboardView.test.ts`

**Interfaces:**
- Consumes: `fetchTickets` (Ticket Management, extended here), `useAuthStore` (Foundation).
- Produces: `DashboardView.vue` at route name `home` — the composition root every later task in this plan adds a widget to.

- [ ] **Step 1: Write the failing test**

`frontend/tests/views/DashboardView.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../testUtils';

vi.mock('../../src/api/tickets', () => ({
  fetchTickets: vi.fn(),
}));

import { fetchTickets } from '../../src/api/tickets';
import { useAuthStore } from '../../src/stores/auth';
import DashboardView from '../../src/views/DashboardView.vue';

export function loginAs(role: 'AGENT' | 'SUPERVISOR' | 'ADMIN') {
  const auth = useAuthStore();
  auth.currentUser = {
    id: 'me',
    email: 'me@example.com',
    fullName: 'Me',
    role,
    departmentId: null,
    isActive: true,
    locale: 'en',
  };
  auth.token = 'fake-token';
}

const dashboardRoutes = [
  { path: '/', name: 'home', component: { template: '<div />' } },
  { path: '/tickets/:id', name: 'ticket-detail', component: { template: '<div />' } },
];

describe('DashboardView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchTickets).mockResolvedValue([]);
  });

  it("renders the agent's assigned open tickets", async () => {
    vi.mocked(fetchTickets).mockResolvedValue([
      {
        id: 't1',
        subject: 'Cannot log in',
        status: 'OPEN',
        priority: 'MEDIUM',
        isEscalated: false,
        customer: { id: 'c1', fullName: 'Jane Customer' },
        category: null,
        department: null,
        assignee: { id: 'me', fullName: 'Me', role: 'AGENT' },
        createdAt: new Date().toISOString(),
      },
    ]);
    loginAs('AGENT');

    const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Cannot log in');
    expect(fetchTickets).toHaveBeenCalledWith({ assigneeId: 'me' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/views/DashboardView.test.ts`
Expected: FAIL — `Cannot find module '../../src/views/DashboardView.vue'`.

- [ ] **Step 3: Extend the tickets API filter type**

`frontend/src/api/tickets.ts` — replace only the `fetchTickets` function (rest of the file unchanged):

```ts
export async function fetchTickets(
  filters: {
    status?: TicketStatus;
    assigneeId?: string;
    departmentId?: string;
    categoryId?: string;
    unassigned?: boolean;
    escalated?: boolean;
  } = {}
): Promise<ApiTicketSummary[]> {
  const res = await apiClient.get('/tickets', { params: filters });
  return res.data;
}
```

- [ ] **Step 4: Implement MyTicketsWidget and DashboardView**

`frontend/src/components/dashboard/MyTicketsWidget.vue`:

```vue
<template>
  <v-card data-testid="my-tickets-widget">
    <v-card-title>{{ $t('dashboard.myTickets') }}</v-card-title>
    <v-card-text>
      <v-list v-if="tickets.length" density="compact">
        <v-list-item
          v-for="ticket in tickets"
          :key="ticket.id"
          :title="ticket.subject"
          :subtitle="`${ticket.customer.fullName} — ${ticket.status}`"
          :to="{ name: 'ticket-detail', params: { id: ticket.id } }"
        />
      </v-list>
      <p v-else class="text-medium-emphasis">{{ $t('dashboard.noTickets') }}</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchTickets, type ApiTicketSummary } from '../../api/tickets';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const tickets = ref<ApiTicketSummary[]>([]);

onMounted(async () => {
  const all = await fetchTickets({ assigneeId: auth.currentUser!.id });
  tickets.value = all.filter((t) => t.status !== 'CLOSED');
});
</script>
```

`frontend/src/views/DashboardView.vue`:

```vue
<template>
  <v-container fluid>
    <h1 class="mb-4">{{ $t('dashboard.title') }}</h1>
    <v-row>
      <v-col cols="12" md="6">
        <MyTicketsWidget />
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import MyTicketsWidget from '../components/dashboard/MyTicketsWidget.vue';
</script>
```

- [ ] **Step 5: Add locale keys**

`frontend/src/locales/en.json` — add a `dashboard` key alongside the existing top-level keys:

```json
"dashboard": {
  "title": "Dashboard",
  "myTickets": "My Tickets",
  "noTickets": "No tickets assigned to you."
}
```

`frontend/src/locales/ar.json`:

```json
"dashboard": {
  "title": "لوحة التحكم",
  "myTickets": "تذاكري",
  "noTickets": "لا توجد تذاكر مسندة إليك."
}
```

- [ ] **Step 6: Wire up the route**

`frontend/src/router/index.ts` (full file):

```ts
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import LoginView from '../views/LoginView.vue';
import DashboardView from '../views/DashboardView.vue';
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
        { path: '', name: 'home', component: DashboardView },
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

Delete `frontend/src/views/HomeView.vue` (no longer referenced anywhere).

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all tests)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/views/DashboardView.vue frontend/src/components/dashboard/MyTicketsWidget.vue frontend/src/api/tickets.ts frontend/src/router/index.ts frontend/src/locales/en.json frontend/src/locales/ar.json frontend/tests/views/DashboardView.test.ts
git rm frontend/src/views/HomeView.vue
git commit -m "feat(frontend): replace placeholder home with role-adaptive dashboard (My Tickets widget)"
```

---

### Task 5: My Tasks widget

**Files:**
- Create: `frontend/src/api/tasks.ts`
- Create: `frontend/src/components/dashboard/MyTasksWidget.vue`
- Modify: `frontend/src/views/DashboardView.vue` (add the widget)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (add `tasks` namespace, extend `dashboard`)
- Modify: `frontend/tests/views/DashboardView.test.ts` (append a test)

**Interfaces:**
- Consumes: `apiClient` (Foundation).
- Produces: `fetchTasks`, `createTask`, `updateTask`, `deleteTask`, `ApiTask` (`frontend/src/api/tasks.ts`) — reused nowhere else in this plan, but is the module a future full task-management page would import.

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/views/DashboardView.test.ts` — add the mock block near the top (after the existing `vi.mock` for `api/tickets`), a new import, and a new `it`:

```ts
vi.mock('../../src/api/tasks', () => ({
  fetchTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));
```

```ts
import { fetchTasks, createTask, updateTask } from '../../src/api/tasks';
```

Add `vi.mocked(fetchTasks).mockResolvedValue([]);` to the existing `beforeEach`, then append:

```ts
it('renders my tasks and lets the user add and complete one', async () => {
  loginAs('AGENT');
  vi.mocked(fetchTasks).mockResolvedValue([
    { id: 'task1', title: 'Call back Jane', dueAt: null, isDone: false, ownerId: 'me', ticketId: null },
  ]);
  vi.mocked(createTask).mockResolvedValue({
    id: 'task2',
    title: 'Follow up',
    dueAt: null,
    isDone: false,
    ownerId: 'me',
    ticketId: null,
  });
  vi.mocked(updateTask).mockResolvedValue({
    id: 'task1',
    title: 'Call back Jane',
    dueAt: null,
    isDone: true,
    ownerId: 'me',
    ticketId: null,
  });

  const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).toContain('Call back Jane');

  await wrapper.find('[data-testid="new-task-title"] input').setValue('Follow up');
  await wrapper.find('[data-testid="add-task-form"]').trigger('submit.prevent');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(createTask).toHaveBeenCalledWith({ title: 'Follow up' });

  await wrapper.find('[data-testid="task-done-task1"]').trigger('click');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(updateTask).toHaveBeenCalledWith('task1', { isDone: true });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/views/DashboardView.test.ts`
Expected: FAIL — `Cannot find module '../../src/api/tasks'`.

- [ ] **Step 3: Implement the API module and the widget**

`frontend/src/api/tasks.ts`:

```ts
import { apiClient } from './client';

export interface ApiTask {
  id: string;
  title: string;
  dueAt: string | null;
  isDone: boolean;
  ownerId: string;
  ticketId: string | null;
}

export async function fetchTasks(filters: { done?: boolean; ticketId?: string } = {}): Promise<ApiTask[]> {
  const res = await apiClient.get('/tasks', { params: filters });
  return res.data;
}

export async function createTask(data: {
  title: string;
  dueAt?: string | null;
  ticketId?: string | null;
}): Promise<ApiTask> {
  const res = await apiClient.post('/tasks', data);
  return res.data;
}

export async function updateTask(
  id: string,
  data: Partial<{ title: string; dueAt: string | null; ticketId: string | null; isDone: boolean }>
): Promise<ApiTask> {
  const res = await apiClient.patch(`/tasks/${id}`, data);
  return res.data;
}

export async function deleteTask(id: string): Promise<void> {
  await apiClient.delete(`/tasks/${id}`);
}
```

`frontend/src/components/dashboard/MyTasksWidget.vue`:

```vue
<template>
  <v-card data-testid="my-tasks-widget">
    <v-card-title>{{ $t('dashboard.myTasks') }}</v-card-title>
    <v-card-text>
      <form data-testid="add-task-form" class="d-flex mb-4" @submit.prevent="addTask">
        <v-text-field
          v-model="newTitle"
          data-testid="new-task-title"
          :label="$t('tasks.newTask')"
          density="compact"
          hide-details
          class="mr-2"
        />
        <v-btn type="submit" color="primary">{{ $t('tasks.add') }}</v-btn>
      </form>
      <v-list v-if="tasks.length" density="compact">
        <v-list-item v-for="task in tasks" :key="task.id" :title="task.title">
          <template #append>
            <v-btn size="small" :data-testid="`task-done-${task.id}`" @click="toggleDone(task)">
              {{ $t('tasks.markDone') }}
            </v-btn>
          </template>
        </v-list-item>
      </v-list>
      <p v-else class="text-medium-emphasis">{{ $t('dashboard.noTasks') }}</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchTasks, createTask, updateTask, type ApiTask } from '../../api/tasks';

const tasks = ref<ApiTask[]>([]);
const newTitle = ref('');

async function load() {
  tasks.value = await fetchTasks({ done: false });
}

async function addTask() {
  if (!newTitle.value.trim()) return;
  await createTask({ title: newTitle.value });
  newTitle.value = '';
  await load();
}

async function toggleDone(task: ApiTask) {
  await updateTask(task.id, { isDone: !task.isDone });
  await load();
}

onMounted(load);
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
  </v-container>
</template>

<script setup lang="ts">
import MyTicketsWidget from '../components/dashboard/MyTicketsWidget.vue';
import MyTasksWidget from '../components/dashboard/MyTasksWidget.vue';
</script>
```

- [ ] **Step 4: Add locale keys**

`frontend/src/locales/en.json` — extend the `dashboard` key and add a new `tasks` key:

```json
"dashboard": {
  "title": "Dashboard",
  "myTickets": "My Tickets",
  "noTickets": "No tickets assigned to you.",
  "myTasks": "My Tasks",
  "noTasks": "No open tasks."
},
"tasks": {
  "newTask": "New task",
  "add": "Add",
  "markDone": "Done"
}
```

`frontend/src/locales/ar.json`:

```json
"dashboard": {
  "title": "لوحة التحكم",
  "myTickets": "تذاكري",
  "noTickets": "لا توجد تذاكر مسندة إليك.",
  "myTasks": "مهامي",
  "noTasks": "لا توجد مهام مفتوحة."
},
"tasks": {
  "newTask": "مهمة جديدة",
  "add": "إضافة",
  "markDone": "إنجاز"
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/tasks.ts frontend/src/components/dashboard/MyTasksWidget.vue frontend/src/views/DashboardView.vue frontend/src/locales/en.json frontend/src/locales/ar.json frontend/tests/views/DashboardView.test.ts
git commit -m "feat(frontend): add My Tasks widget to the dashboard"
```

---

### Task 6: Team Activity widget

**Files:**
- Modify: `frontend/src/api/tickets.ts` (add `fetchRecentTicketEvents` and `ApiRecentTicketEvent`)
- Create: `frontend/src/components/dashboard/TeamActivityWidget.vue`
- Modify: `frontend/src/views/DashboardView.vue` (add the widget)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (extend `dashboard`)
- Modify: `frontend/tests/views/DashboardView.test.ts` (append a test)

**Interfaces:**
- Consumes: `apiClient` (Foundation).
- Produces: `fetchRecentTicketEvents(limit?): Promise<ApiRecentTicketEvent[]>` (`frontend/src/api/tickets.ts`) — not reused elsewhere in this plan.

- [ ] **Step 1: Write the failing test**

In `frontend/tests/views/DashboardView.test.ts`, extend the existing `vi.mock('../../src/api/tickets', ...)` factory to also export `fetchRecentTicketEvents`:

```ts
vi.mock('../../src/api/tickets', () => ({
  fetchTickets: vi.fn(),
  fetchRecentTicketEvents: vi.fn(),
}));
```

Add the import and default mock, then append a new `it`:

```ts
import { fetchTickets, fetchRecentTicketEvents } from '../../src/api/tickets';
```

Add `vi.mocked(fetchRecentTicketEvents).mockResolvedValue([]);` to the existing `beforeEach`, then append:

```ts
it('renders recent team activity', async () => {
  loginAs('AGENT');
  vi.mocked(fetchRecentTicketEvents).mockResolvedValue([
    {
      id: 'ev1',
      type: 'ESCALATED',
      oldValue: null,
      newValue: null,
      note: null,
      createdAt: new Date().toISOString(),
      author: { id: 'sup1', fullName: 'Sam Supervisor' },
      ticket: { id: 't9', subject: 'Payment failed' },
    },
  ]);

  const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();

  expect(wrapper.text()).toContain('Payment failed');
  expect(wrapper.text()).toContain('Sam Supervisor');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/views/DashboardView.test.ts`
Expected: FAIL — `fetchRecentTicketEvents` is not exported from `api/tickets`.

- [ ] **Step 3: Implement the API addition and the widget**

`frontend/src/api/tickets.ts` — append at the end of the file (everything above unchanged):

```ts
export interface ApiRecentTicketEvent {
  id: string;
  type: TicketEventType;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
  createdAt: string;
  author: { id: string; fullName: string };
  ticket: { id: string; subject: string };
}

export async function fetchRecentTicketEvents(limit = 20): Promise<ApiRecentTicketEvent[]> {
  const res = await apiClient.get('/ticket-events/recent', { params: { limit } });
  return res.data;
}
```

`frontend/src/components/dashboard/TeamActivityWidget.vue`:

```vue
<template>
  <v-card data-testid="team-activity-widget">
    <v-card-title>{{ $t('dashboard.teamActivity') }}</v-card-title>
    <v-card-text>
      <v-list v-if="events.length" density="compact">
        <v-list-item v-for="event in events" :key="event.id" :title="describeEvent(event)" :subtitle="event.author.fullName" />
      </v-list>
      <p v-else class="text-medium-emphasis">{{ $t('dashboard.noActivity') }}</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchRecentTicketEvents, type ApiRecentTicketEvent } from '../../api/tickets';

const events = ref<ApiRecentTicketEvent[]>([]);

const eventDescriptions: Record<string, (event: ApiRecentTicketEvent) => string> = {
  STATUS_CHANGED: (e) => `${e.ticket.subject}: status changed from ${e.oldValue} to ${e.newValue}`,
  PRIORITY_CHANGED: (e) => `${e.ticket.subject}: priority changed from ${e.oldValue} to ${e.newValue}`,
  CATEGORY_CHANGED: (e) => `${e.ticket.subject}: category changed`,
  DEPARTMENT_CHANGED: (e) => `${e.ticket.subject}: department changed`,
  ASSIGNEE_CHANGED: (e) => `${e.ticket.subject}: assignee changed`,
  ESCALATED: (e) => `${e.ticket.subject}: escalated`,
  UNESCALATED: (e) => `${e.ticket.subject}: unescalated`,
  NOTE_ADDED: (e) => `${e.ticket.subject}: note added`,
};

function describeEvent(event: ApiRecentTicketEvent): string {
  return eventDescriptions[event.type]?.(event) ?? event.type;
}

onMounted(async () => {
  events.value = await fetchRecentTicketEvents();
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
  </v-container>
</template>

<script setup lang="ts">
import MyTicketsWidget from '../components/dashboard/MyTicketsWidget.vue';
import MyTasksWidget from '../components/dashboard/MyTasksWidget.vue';
import TeamActivityWidget from '../components/dashboard/TeamActivityWidget.vue';
</script>
```

- [ ] **Step 4: Add locale keys**

`frontend/src/locales/en.json` — extend `dashboard`:

```json
"dashboard": {
  "title": "Dashboard",
  "myTickets": "My Tickets",
  "noTickets": "No tickets assigned to you.",
  "myTasks": "My Tasks",
  "noTasks": "No open tasks.",
  "teamActivity": "Team Activity",
  "noActivity": "No recent activity."
}
```

`frontend/src/locales/ar.json`:

```json
"dashboard": {
  "title": "لوحة التحكم",
  "myTickets": "تذاكري",
  "noTickets": "لا توجد تذاكر مسندة إليك.",
  "myTasks": "مهامي",
  "noTasks": "لا توجد مهام مفتوحة.",
  "teamActivity": "نشاط الفريق",
  "noActivity": "لا يوجد نشاط حديث."
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/tickets.ts frontend/src/components/dashboard/TeamActivityWidget.vue frontend/src/views/DashboardView.vue frontend/src/locales/en.json frontend/src/locales/ar.json frontend/tests/views/DashboardView.test.ts
git commit -m "feat(frontend): add team activity widget to the dashboard"
```

---

### Task 7: Supervisor/Admin widgets — Unassigned Queue, Escalated Tickets, Team Workload

**Files:**
- Create: `frontend/src/components/dashboard/UnassignedQueueWidget.vue`
- Create: `frontend/src/components/dashboard/EscalatedTicketsWidget.vue`
- Create: `frontend/src/components/dashboard/TeamWorkloadWidget.vue`
- Modify: `frontend/src/views/DashboardView.vue` (role-gate the three new widgets)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (extend `dashboard`)
- Modify: `frontend/tests/views/DashboardView.test.ts` (append tests)

**Interfaces:**
- Consumes: `fetchTickets` (extended in Task 4), `useAuthStore` (Foundation).
- Produces: nothing consumed by later tasks — this is the last widget group.

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/views/DashboardView.test.ts`:

```ts
it('renders team-wide widgets for a supervisor', async () => {
  loginAs('SUPERVISOR');
  vi.mocked(fetchTickets).mockImplementation(async (filters = {}) => {
    if (filters.unassigned) {
      return [
        {
          id: 'u1',
          subject: 'Unassigned ticket',
          status: 'OPEN',
          priority: 'MEDIUM',
          isEscalated: false,
          customer: { id: 'c2', fullName: 'Bob Customer' },
          category: null,
          department: null,
          assignee: null,
          createdAt: new Date().toISOString(),
        },
      ];
    }
    if (filters.escalated) {
      return [
        {
          id: 'e1',
          subject: 'Escalated ticket',
          status: 'OPEN',
          priority: 'URGENT',
          isEscalated: true,
          customer: { id: 'c3', fullName: 'Sam Customer' },
          category: null,
          department: null,
          assignee: { id: 'agent1', fullName: 'Agent One', role: 'AGENT' },
          createdAt: new Date().toISOString(),
        },
      ];
    }
    if (filters.status === 'OPEN' || filters.status === 'IN_PROGRESS') {
      return [
        {
          id: `w-${filters.status}`,
          subject: 'Workload ticket',
          status: filters.status,
          priority: 'MEDIUM',
          isEscalated: false,
          customer: { id: 'c4', fullName: 'Workload Customer' },
          category: null,
          department: null,
          assignee: { id: 'agent1', fullName: 'Agent One', role: 'AGENT' },
          createdAt: new Date().toISOString(),
        },
      ];
    }
    return [];
  });

  const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();

  expect(wrapper.text()).toContain('Unassigned ticket');
  expect(wrapper.text()).toContain('Escalated ticket');
  expect(wrapper.find('[data-testid="team-workload-widget"]').text()).toContain('Agent One');
  expect(wrapper.find('[data-testid="team-workload-widget"]').text()).toContain('2');
});

it('does not render team-wide widgets for an agent', async () => {
  loginAs('AGENT');
  const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();

  expect(wrapper.find('[data-testid="unassigned-queue-widget"]').exists()).toBe(false);
  expect(wrapper.find('[data-testid="escalated-tickets-widget"]').exists()).toBe(false);
  expect(wrapper.find('[data-testid="team-workload-widget"]').exists()).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/views/DashboardView.test.ts`
Expected: FAIL — the widgets don't exist yet, so neither test's assertions can pass.

- [ ] **Step 3: Implement the three widgets**

`frontend/src/components/dashboard/UnassignedQueueWidget.vue`:

```vue
<template>
  <v-card data-testid="unassigned-queue-widget">
    <v-card-title>{{ $t('dashboard.unassignedQueue') }}</v-card-title>
    <v-card-text>
      <v-list v-if="tickets.length" density="compact">
        <v-list-item
          v-for="ticket in tickets"
          :key="ticket.id"
          :title="ticket.subject"
          :subtitle="ticket.customer.fullName"
          :to="{ name: 'ticket-detail', params: { id: ticket.id } }"
        />
      </v-list>
      <p v-else class="text-medium-emphasis">{{ $t('dashboard.noUnassigned') }}</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchTickets, type ApiTicketSummary } from '../../api/tickets';

const tickets = ref<ApiTicketSummary[]>([]);

onMounted(async () => {
  tickets.value = await fetchTickets({ unassigned: true });
});
</script>
```

`frontend/src/components/dashboard/EscalatedTicketsWidget.vue`:

```vue
<template>
  <v-card data-testid="escalated-tickets-widget">
    <v-card-title>{{ $t('dashboard.escalatedTickets') }}</v-card-title>
    <v-card-text>
      <v-list v-if="tickets.length" density="compact">
        <v-list-item
          v-for="ticket in tickets"
          :key="ticket.id"
          :title="ticket.subject"
          :subtitle="ticket.assignee?.fullName ?? '-'"
          :to="{ name: 'ticket-detail', params: { id: ticket.id } }"
        />
      </v-list>
      <p v-else class="text-medium-emphasis">{{ $t('dashboard.noEscalated') }}</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchTickets, type ApiTicketSummary } from '../../api/tickets';

const tickets = ref<ApiTicketSummary[]>([]);

onMounted(async () => {
  tickets.value = await fetchTickets({ escalated: true });
});
</script>
```

`frontend/src/components/dashboard/TeamWorkloadWidget.vue`:

```vue
<template>
  <v-card data-testid="team-workload-widget">
    <v-card-title>{{ $t('dashboard.teamWorkload') }}</v-card-title>
    <v-card-text>
      <v-list v-if="workload.length" density="compact">
        <v-list-item v-for="row in workload" :key="row.name" :title="row.name" :subtitle="String(row.count)" />
      </v-list>
      <p v-else class="text-medium-emphasis">{{ $t('dashboard.noWorkload') }}</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchTickets } from '../../api/tickets';

const workload = ref<{ name: string; count: number }[]>([]);

onMounted(async () => {
  const [open, inProgress] = await Promise.all([
    fetchTickets({ status: 'OPEN' }),
    fetchTickets({ status: 'IN_PROGRESS' }),
  ]);
  const counts = new Map<string, number>();
  for (const ticket of [...open, ...inProgress]) {
    const name = ticket.assignee?.fullName ?? 'Unassigned';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  workload.value = [...counts.entries()].map(([name, count]) => ({ name, count }));
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
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const isSupervisorOrAdmin = computed(
  () => auth.currentUser?.role === 'ADMIN' || auth.currentUser?.role === 'SUPERVISOR'
);
</script>
```

- [ ] **Step 4: Add locale keys**

`frontend/src/locales/en.json` — extend `dashboard`:

```json
"dashboard": {
  "title": "Dashboard",
  "myTickets": "My Tickets",
  "noTickets": "No tickets assigned to you.",
  "myTasks": "My Tasks",
  "noTasks": "No open tasks.",
  "teamActivity": "Team Activity",
  "noActivity": "No recent activity.",
  "unassignedQueue": "Unassigned Queue",
  "noUnassigned": "No unassigned tickets.",
  "escalatedTickets": "Escalated Tickets",
  "noEscalated": "No escalated tickets.",
  "teamWorkload": "Team Workload",
  "noWorkload": "No open tickets."
}
```

`frontend/src/locales/ar.json`:

```json
"dashboard": {
  "title": "لوحة التحكم",
  "myTickets": "تذاكري",
  "noTickets": "لا توجد تذاكر مسندة إليك.",
  "myTasks": "مهامي",
  "noTasks": "لا توجد مهام مفتوحة.",
  "teamActivity": "نشاط الفريق",
  "noActivity": "لا يوجد نشاط حديث.",
  "unassignedQueue": "قائمة الانتظار غير المسندة",
  "noUnassigned": "لا توجد تذاكر غير مسندة.",
  "escalatedTickets": "التذاكر المصعدة",
  "noEscalated": "لا توجد تذاكر مصعدة.",
  "teamWorkload": "أعباء عمل الفريق",
  "noWorkload": "لا توجد تذاكر مفتوحة."
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/dashboard/UnassignedQueueWidget.vue frontend/src/components/dashboard/EscalatedTicketsWidget.vue frontend/src/components/dashboard/TeamWorkloadWidget.vue frontend/src/views/DashboardView.vue frontend/src/locales/en.json frontend/src/locales/ar.json frontend/tests/views/DashboardView.test.ts
git commit -m "feat(frontend): add supervisor/admin dashboard widgets (unassigned, escalated, workload)"
```

---

### Task 8: Quick Replies admin page

**Files:**
- Create: `frontend/src/api/quickReplies.ts`
- Create: `frontend/src/views/quickReplies/QuickReplyListView.vue`
- Modify: `frontend/src/router/index.ts` (add `quick-replies` route, `ADMIN`-only)
- Modify: `frontend/src/layouts/AppShell.vue` (add nav item)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (add `quickReplies`, extend `nav`)
- Modify: `frontend/tests/layouts/AppShell.test.ts` (register the new route in the test router tables)
- Test: `frontend/tests/views/quickReplies/QuickReplyListView.test.ts`

**Interfaces:**
- Consumes: `apiClient` (Foundation).
- Produces: `fetchQuickReplies`, `createQuickReply`, `updateQuickReply`, `ApiQuickReply` (`frontend/src/api/quickReplies.ts`) — reused by Task 9's note picker.

- [ ] **Step 1: Write the failing test**

`frontend/tests/views/quickReplies/QuickReplyListView.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/quickReplies', () => ({
  fetchQuickReplies: vi.fn(),
  createQuickReply: vi.fn(),
  updateQuickReply: vi.fn(),
}));

import { fetchQuickReplies } from '../../../src/api/quickReplies';
import QuickReplyListView from '../../../src/views/quickReplies/QuickReplyListView.vue';

describe('QuickReplyListView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchQuickReplies).mockResolvedValue([
      { id: '1', titleEn: 'Greeting', titleAr: 'ترحيب', bodyEn: 'Hello!', bodyAr: 'مرحبًا!' },
    ]);
  });

  it('renders fetched quick replies', async () => {
    const wrapper = mountWithPlugins(QuickReplyListView);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Greeting');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/views/quickReplies/QuickReplyListView.test.ts`
Expected: FAIL — `Cannot find module '../../../src/api/quickReplies'`.

- [ ] **Step 3: Implement the API module and the view**

`frontend/src/api/quickReplies.ts`:

```ts
import { apiClient } from './client';

export interface ApiQuickReply {
  id: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}

export async function fetchQuickReplies(): Promise<ApiQuickReply[]> {
  const res = await apiClient.get('/quick-replies');
  return res.data;
}

export async function createQuickReply(data: {
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}): Promise<ApiQuickReply> {
  const res = await apiClient.post('/quick-replies', data);
  return res.data;
}

export async function updateQuickReply(
  id: string,
  data: Partial<{ titleEn: string; titleAr: string; bodyEn: string; bodyAr: string }>
): Promise<ApiQuickReply> {
  const res = await apiClient.patch(`/quick-replies/${id}`, data);
  return res.data;
}
```

`frontend/src/views/quickReplies/QuickReplyListView.vue`:

```vue
<template>
  <v-container fluid>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1>{{ $t('quickReplies.title') }}</h1>
      <v-btn color="primary" @click="openCreate">{{ $t('quickReplies.create') }}</v-btn>
    </div>

    <v-data-table :items="replies" :headers="headers">
      <template #item.actions="{ item }">
        <v-btn size="small" variant="text" @click="openEdit(item)">Edit</v-btn>
      </template>
    </v-data-table>

    <v-dialog v-model="dialogOpen" max-width="480">
      <v-card :title="editingId ? 'Edit quick reply' : $t('quickReplies.create')">
        <v-card-text>
          <form @submit.prevent="submit">
            <v-text-field v-model="form.titleEn" :label="$t('quickReplies.titleEn')" />
            <v-text-field v-model="form.titleAr" :label="$t('quickReplies.titleAr')" />
            <v-textarea v-model="form.bodyEn" :label="$t('quickReplies.bodyEn')" />
            <v-textarea v-model="form.bodyAr" :label="$t('quickReplies.bodyAr')" />
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
  fetchQuickReplies,
  createQuickReply,
  updateQuickReply,
  type ApiQuickReply,
} from '../../api/quickReplies';

const replies = ref<ApiQuickReply[]>([]);
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);

const headers = [
  { title: 'Title (EN)', key: 'titleEn' },
  { title: 'Title (AR)', key: 'titleAr' },
  { title: '', key: 'actions', sortable: false },
];

const form = reactive({ titleEn: '', titleAr: '', bodyEn: '', bodyAr: '' });

async function load() {
  replies.value = await fetchQuickReplies();
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, { titleEn: '', titleAr: '', bodyEn: '', bodyAr: '' });
  dialogOpen.value = true;
}

function openEdit(item: ApiQuickReply) {
  editingId.value = item.id;
  Object.assign(form, { titleEn: item.titleEn, titleAr: item.titleAr, bodyEn: item.bodyEn, bodyAr: item.bodyAr });
  dialogOpen.value = true;
}

async function submit() {
  if (editingId.value) {
    await updateQuickReply(editingId.value, { ...form });
  } else {
    await createQuickReply({ ...form });
  }
  dialogOpen.value = false;
  await load();
}

onMounted(load);
</script>
```

- [ ] **Step 4: Add locale keys**

`frontend/src/locales/en.json` — add a `quickReplies` key and extend `nav`:

```json
"nav": { "home": "Home", "tickets": "Tickets", "users": "Users", "departments": "Departments", "ticketCategories": "Ticket Categories", "quickReplies": "Quick Replies", "logout": "Logout" },
```

```json
"quickReplies": {
  "title": "Quick Replies",
  "create": "New quick reply",
  "titleEn": "Title (English)",
  "titleAr": "Title (Arabic)",
  "bodyEn": "Body (English)",
  "bodyAr": "Body (Arabic)"
}
```

`frontend/src/locales/ar.json`:

```json
"nav": { "home": "الرئيسية", "tickets": "التذاكر", "users": "المستخدمون", "departments": "الأقسام", "ticketCategories": "فئات التذاكر", "quickReplies": "الردود السريعة", "logout": "تسجيل الخروج" },
```

```json
"quickReplies": {
  "title": "الردود السريعة",
  "create": "رد سريع جديد",
  "titleEn": "العنوان (إنجليزي)",
  "titleAr": "العنوان (عربي)",
  "bodyEn": "النص (إنجليزي)",
  "bodyAr": "النص (عربي)"
}
```

- [ ] **Step 5: Wire up the route and nav item**

`frontend/src/router/index.ts` — add the import and the new child route (rest of the file unchanged from Task 4's version):

```ts
import QuickReplyListView from '../views/quickReplies/QuickReplyListView.vue';
```

```ts
{
  path: 'quick-replies',
  name: 'quick-replies',
  component: QuickReplyListView,
  meta: { roles: ['ADMIN'] },
},
```

(add this object to the `children` array, after the `ticket-categories` entry).

`frontend/src/layouts/AppShell.vue` — add one nav item after the existing `ticketCategories` one:

```vue
<v-list-item v-if="isAdmin" :title="$t('nav.quickReplies')" :to="{ name: 'quick-replies' }" />
```

`frontend/tests/layouts/AppShell.test.ts` — add `{ path: '/quick-replies', name: 'quick-replies', component: { template: '<div />' } }` to **both** route arrays passed to `mountWithPlugins` in this file (the constraint in Global Constraints: a rendered `:to` nav item needs its route registered in the test).

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/quickReplies.ts frontend/src/views/quickReplies/QuickReplyListView.vue frontend/src/router/index.ts frontend/src/layouts/AppShell.vue frontend/src/locales/en.json frontend/src/locales/ar.json frontend/tests/layouts/AppShell.test.ts frontend/tests/views/quickReplies/QuickReplyListView.test.ts
git commit -m "feat(frontend): add admin quick replies management page"
```

---

### Task 9: Quick reply insertion on the ticket note field

**Files:**
- Modify: `frontend/src/views/tickets/TicketDetailView.vue` (fetch quick replies, add an insert picker next to the note field)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (add `tickets.insertQuickReply`)
- Modify: `frontend/tests/views/tickets/TicketDetailView.test.ts` (append a test)

**Interfaces:**
- Consumes: `fetchQuickReplies` (Task 8).
- Produces: nothing consumed by later tasks — this is the final task in the plan.

- [ ] **Step 1: Write the failing test**

`frontend/tests/views/tickets/TicketDetailView.test.ts` — add a new `vi.mock` block and import near the top (after the existing `vi.mock('../../../src/api/users', ...)`):

```ts
vi.mock('../../../src/api/quickReplies', () => ({
  fetchQuickReplies: vi.fn(),
}));
```

```ts
import { fetchQuickReplies } from '../../../src/api/quickReplies';
```

Add `vi.mocked(fetchQuickReplies).mockResolvedValue([]);` to the existing `beforeEach`, then append a new `it` at the end of the `describe` block:

```ts
it('inserts a quick reply into the note field', async () => {
  vi.mocked(fetchQuickReplies).mockResolvedValue([
    { id: 'qr1', titleEn: 'Greeting', titleAr: 'ترحيب', bodyEn: 'Hello, thanks for reaching out!', bodyAr: 'مرحبًا!' },
  ]);

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

  await wrapper.find('[data-testid="quick-reply-select"]').trigger('click');
  const option = wrapper.find('[data-testid="quick-reply-option-qr1"]');
  expect(option.exists()).toBe(true);
  await option.trigger('click');
  await wrapper.vm.$nextTick();

  const noteInput = wrapper.find('[data-testid="note-input"] input').element as HTMLInputElement;
  expect(noteInput.value).toBe('Hello, thanks for reaching out!');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/views/tickets/TicketDetailView.test.ts`
Expected: FAIL — `Cannot find module '../../../src/api/quickReplies'` and no `[data-testid="quick-reply-select"]` exists.

- [ ] **Step 3: Implement**

`frontend/src/views/tickets/TicketDetailView.vue` — add the picker to the template, right above the existing note `v-text-field`:

```vue
<v-select
  data-testid="quick-reply-select"
  :items="quickReplyOptions"
  item-title="title"
  item-value="id"
  :label="$t('tickets.insertQuickReply')"
  clearable
  @update:model-value="insertQuickReply"
/>
```

Note: Vuetify renders each `v-select` option as a `v-list-item` inside the menu; give each option a `data-testid` via `item-props`. Replace the block above with this final version instead, which sets a `data-testid` per option:

```vue
<v-select
  data-testid="quick-reply-select"
  :items="quickReplyOptions"
  item-title="title"
  item-value="id"
  :item-props="(item: { id: string }) => ({ 'data-testid': `quick-reply-option-${item.id}` })"
  :label="$t('tickets.insertQuickReply')"
  clearable
  @update:model-value="insertQuickReply"
/>
```

Add to the `<script setup>` block (alongside the existing imports/state):

```ts
import { fetchQuickReplies, type ApiQuickReply } from '../../api/quickReplies';
```

```ts
const quickReplies = ref<ApiQuickReply[]>([]);
const quickReplyOptions = computed(() =>
  quickReplies.value.map((r) => ({ id: r.id, title: r.titleEn }))
);

function insertQuickReply(id: string | null) {
  if (!id) return;
  const reply = quickReplies.value.find((r) => r.id === id);
  if (!reply) return;
  const body = auth.currentUser?.locale === 'ar' ? reply.bodyAr : reply.bodyEn;
  noteText.value = noteText.value ? `${noteText.value} ${body}` : body;
}
```

Extend the existing `onMounted` block by adding one more non-fatal fetch, following the same pattern already used for categories/departments/agents:

```ts
try {
  quickReplies.value = await fetchQuickReplies();
} catch {
  // Non-fatal: quick reply list may be empty if unavailable.
}
```

- [ ] **Step 4: Add locale keys**

`frontend/src/locales/en.json` — inside the existing `tickets` object, add `"insertQuickReply"` right after the `"customerPhone"` entry (the last key in that object):

```json
"customerPhone": "Phone",
"insertQuickReply": "Insert quick reply"
```

`frontend/src/locales/ar.json` — same position, inside the existing `tickets` object, after `"customerPhone"`:

```json
"customerPhone": "الهاتف",
"insertQuickReply": "إدراج رد سريع"
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (all tests). This completes the Agent Dashboard sub-project.

- [ ] **Step 6: Manual end-to-end check**

With the backend (`cd backend && npm run dev`) and frontend (`cd frontend && npm run dev`) both running against real Postgres dev/test databases:

1. Log in as the seeded admin. Confirm the new Dashboard shows My Tickets/My Tasks/Team Activity plus Unassigned Queue/Escalated Tickets/Team Workload.
2. Add a task from the My Tasks widget, mark it done, confirm it drops off the (open-only) list.
3. As Admin, create a quick reply under the new "Quick Replies" nav item.
4. Open a ticket, use the "Insert quick reply" picker, confirm its body appends into the note field, then submit the note and confirm it appears in the timeline.
5. Log in as an Agent (non-admin/supervisor), confirm the dashboard shows only My Tickets/My Tasks/Team Activity — no unassigned/escalated/workload widgets, and no "Quick Replies" nav item.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/tickets/TicketDetailView.vue frontend/src/locales/en.json frontend/src/locales/ar.json frontend/tests/views/tickets/TicketDetailView.test.ts
git commit -m "feat(frontend): let staff insert a quick reply into a ticket note"
```

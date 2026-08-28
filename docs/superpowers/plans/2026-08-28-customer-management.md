# Customer Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff a searchable Customers directory, a profile page per customer showing their full ticket history, the ability to create a customer directly, edit one, and stop ticket creation from silently duplicating a customer who already exists.

**Architecture:** Extends the existing (currently search-only) `customers.routes.ts`/`.controller.ts`/`.service.ts` trio with three new endpoints and a shared dedup helper; extends `tickets.service.ts` to call that helper and to filter by `customerId`; adds two new frontend views (`CustomerListView`, `CustomerDetailView`) plus a nav item visible to all staff; links the customer name already shown on the ticket list/detail pages into the new profile view.

**Tech Stack:** Express + TypeScript + Prisma + PostgreSQL (backend); Vue 3 + Vuetify + Pinia + vue-router + vue-i18n (frontend); Vitest + Supertest / Vitest + `@vue/test-utils`.

**Spec:** docs/superpowers/specs/2026-08-28-customer-management-design.md

## Global Constraints

- No new `Customer` fields — build entirely on `fullName`/`email`/`phone` (`backend/prisma/schema.prisma`, unchanged).
- No delete route for customers, no merge tooling for historical duplicates.
- Dedup match rule: `email` (trimmed, case-insensitive exact) **or** `phone` (trimmed, exact) equals an existing customer's value. If neither is supplied, there is nothing to match — no dedup happens (unchanged behavior for a bare-name ticket).
- Ticket creation's dedup (`createTicket`'s `newCustomer` path) is **silent** — reuse and move on, never an error, never a new response field.
- Direct create (`POST /api/customers`) and edit (`PATCH /api/customers/:id`) dedup checks are **explicit** — `409 CUSTOMER_EXISTS`, with `existingCustomerId` alongside the standard `error` object in the response body.
- `PATCH /api/customers/:id`'s dedup check only runs against fields actually present in the request body (not the customer's unchanged stored values) and always excludes the customer being edited from the match set.
- Every authenticated staff member (Agent/Supervisor/Admin) can view, create, and edit customers — no role restriction, unlike every other management page in this app (Users/Departments/Categories/QuickReplies/SlaTargets are all `ADMIN`-only).
- Standard `{ error: { code, message } }` error shape throughout, via the existing `HttpError`/`errorHandler` — `existingCustomerId` on a `409` is the one deliberate top-level addition alongside `error`, implemented by giving `HttpError` an optional `details` field that `errorHandler` spreads into the response (see Task 1) — this is documented here so it isn't mistaken for scope creep.

---

### Task 1: Backend — customer detail, create, update, and the dedup helper

**Files:**
- Modify: `backend/src/lib/httpError.ts`
- Modify: `backend/src/middleware/errorHandler.ts`
- Modify: `backend/src/services/customers.service.ts`
- Modify: `backend/src/controllers/customers.controller.ts`
- Modify: `backend/src/routes/customers.routes.ts`
- Test: `backend/tests/routes/customers.test.ts`

**Interfaces:**
- Consumes: nothing from another task in this plan.
- Produces: `findExistingCustomerByContact(contact: { email?: string; phone?: string }, excludeId?: string): Promise<Customer | null>` (exported from `customers.service.ts`) — Task 2 imports this into `tickets.service.ts`. `HttpError`'s new optional 4th constructor parameter, `details?: Record<string, unknown>` — no other task needs to know about this beyond it existing.

- [ ] **Step 1: Write the failing tests**

Add these `describe` blocks to the end of `backend/tests/routes/customers.test.ts` (the file already has an `import { createAgent }`-equivalent helper named `createAgent` at the top — reuse it, do not redefine it):

```ts
describe('GET /api/customers/:id', () => {
  it('returns the customer with their tickets newest-first', async () => {
    const { user, token } = await createAgent();
    const customer = await prisma.customer.create({ data: { fullName: 'Jane Customer', email: 'jane@example.com' } });
    await prisma.ticket.create({
      data: { subject: 'First ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });
    await prisma.ticket.create({
      data: { subject: 'Second ticket', description: 'Desc', customerId: customer.id, createdById: user.id },
    });

    const res = await request(app).get(`/api/customers/${customer.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('Jane Customer');
    expect(res.body.tickets).toHaveLength(2);
    expect(res.body.tickets[0].subject).toBe('Second ticket');
    expect(res.body.tickets[1].subject).toBe('First ticket');
  });

  it('returns 404 for a non-existent customer', async () => {
    const { token } = await createAgent();
    const res = await request(app)
      .get('/api/customers/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/customers', () => {
  it('creates a customer', async () => {
    const { token } = await createAgent();
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'New Customer', email: 'new@example.com', phone: '555-0100' });

    expect(res.status).toBe(201);
    expect(res.body.fullName).toBe('New Customer');
  });

  it('returns 409 with the existing customer id when the email already exists', async () => {
    const { token } = await createAgent();
    const existing = await prisma.customer.create({ data: { fullName: 'Existing', email: 'dup@example.com' } });

    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Another Name', email: 'dup@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CUSTOMER_EXISTS');
    expect(res.body.existingCustomerId).toBe(existing.id);
  });

  it('returns 409 when the phone already exists', async () => {
    const { token } = await createAgent();
    const existing = await prisma.customer.create({ data: { fullName: 'Existing', phone: '555-0199' } });

    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Another Name', phone: '555-0199' });

    expect(res.status).toBe(409);
    expect(res.body.existingCustomerId).toBe(existing.id);
  });
});

describe('PATCH /api/customers/:id', () => {
  it('updates a customer', async () => {
    const { token } = await createAgent();
    const customer = await prisma.customer.create({ data: { fullName: 'Old Name', email: 'old@example.com' } });

    const res = await request(app)
      .patch(`/api/customers/${customer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('New Name');
  });

  it('returns 409 when the submitted email collides with a different customer', async () => {
    const { token } = await createAgent();
    const other = await prisma.customer.create({ data: { fullName: 'Other', email: 'other@example.com' } });
    const customer = await prisma.customer.create({ data: { fullName: 'Mine', email: 'mine@example.com' } });

    const res = await request(app)
      .patch(`/api/customers/${customer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'other@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.existingCustomerId).toBe(other.id);
  });

  it("does not 409 when the submitted email matches the customer's own current value", async () => {
    const { token } = await createAgent();
    const customer = await prisma.customer.create({ data: { fullName: 'Mine', email: 'mine@example.com' } });

    const res = await request(app)
      .patch(`/api/customers/${customer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Mine Updated', email: 'mine@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('Mine Updated');
  });

  it('does not re-check an untouched field against historical duplicates', async () => {
    const { token } = await createAgent();
    // Two customers that already share an email from before dedup existed —
    // this plan does not clean up historical duplicates (Non-Goal). Editing
    // one's phone must not suddenly start failing because of the other.
    await prisma.customer.create({ data: { fullName: 'Historical Dup A', email: 'shared@example.com' } });
    const customer = await prisma.customer.create({ data: { fullName: 'Historical Dup B', email: 'shared@example.com' } });

    const res = await request(app)
      .patch(`/api/customers/${customer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '555-0177' });

    expect(res.status).toBe(200);
    expect(res.body.phone).toBe('555-0177');
  });

  it('returns 404 for a non-existent customer', async () => {
    const { token } = await createAgent();
    const res = await request(app)
      .patch('/api/customers/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'X' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd backend && npm test -- customers.test.ts`
Expected: FAIL — `GET /:id`, `POST /`, and `PATCH /:id` don't exist yet (404/`Cannot GET` style failures), since only `GET /` (search) is currently routed.

- [ ] **Step 3: Give `HttpError` an optional `details` field**

Replace the full contents of `backend/src/lib/httpError.ts` (currently):

```ts
export class HttpError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
```

with:

```ts
export class HttpError extends Error {
  statusCode: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
```

Every existing `new HttpError(status, code, message)` call site across the codebase omits the 4th argument, so `details` is `undefined` for all of them — no behavior change for any existing error.

- [ ] **Step 4: Make `errorHandler` spread `details` into the response**

In `backend/src/middleware/errorHandler.ts`, replace:

```ts
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }
```

with:

```ts
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message }, ...err.details });
    return;
  }
```

When `err.details` is `undefined`, `...undefined` spreads nothing — the response body is byte-for-byte identical to today for every existing error. When `err.details` is `{ existingCustomerId: '...' }`, the response becomes `{ error: {...}, existingCustomerId: '...' }`.

- [ ] **Step 5: Add the new service functions**

Replace the full contents of `backend/src/services/customers.service.ts` (currently):

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

with:

```ts
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
```

Note the `PATCH` dedup check only runs `if (data.email !== undefined || data.phone !== undefined)` and only passes the *submitted* fields into the match — it deliberately does not fall back to `current.email`/`current.phone` for a field that wasn't part of this request. This is what makes the "does not re-check an untouched field" test above pass, and is a deliberate reading of the spec's dedup rule (not a deviation): re-validating fields the caller never touched, against data this plan explicitly declines to clean up (historical duplicates), would block legitimate unrelated edits.

- [ ] **Step 6: Add the three new controller handlers**

Replace the full contents of `backend/src/controllers/customers.controller.ts` (currently):

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

with:

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

export async function getCustomerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await customersService.getCustomerById(req.params.id as string));
  } catch (err) {
    next(err);
  }
}

export async function createCustomerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await customersService.createCustomer(req.body));
  } catch (err) {
    next(err);
  }
}

export async function updateCustomerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await customersService.updateCustomer(req.params.id as string, req.body));
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 7: Wire the three new routes**

Replace the full contents of `backend/src/routes/customers.routes.ts` (currently):

```ts
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { searchCustomersHandler } from '../controllers/customers.controller';

export const customersRouter = Router();

customersRouter.use(authenticate);
customersRouter.get('/', searchCustomersHandler);
```

with:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  searchCustomersHandler,
  getCustomerHandler,
  createCustomerHandler,
  updateCustomerHandler,
} from '../controllers/customers.controller';

const createCustomerSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
});

const updateCustomerSchema = z.object({
  fullName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
});

export const customersRouter = Router();

customersRouter.use(authenticate);
customersRouter.get('/', searchCustomersHandler);
customersRouter.get('/:id', getCustomerHandler);
customersRouter.post('/', validate(createCustomerSchema), createCustomerHandler);
customersRouter.patch('/:id', validate(updateCustomerSchema), updateCustomerHandler);
```

- [ ] **Step 8: Run the tests and verify they pass**

Run: `cd backend && npm test -- customers.test.ts`
Expected: PASS — all new tests green, both previously-passing tests in this file still green.

- [ ] **Step 9: Run the full backend suite and typecheck**

Run: `cd backend && npm test && npm run build`
Expected: PASS, no TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add backend/src/lib/httpError.ts backend/src/middleware/errorHandler.ts backend/src/services/customers.service.ts backend/src/controllers/customers.controller.ts backend/src/routes/customers.routes.ts backend/tests/routes/customers.test.ts
git commit -m "feat(backend): add customer detail, create, update, and dedup lookup"
```

---

### Task 2: Backend — wire dedup into ticket creation, add customerId filter

**Files:**
- Modify: `backend/src/services/tickets.service.ts`
- Modify: `backend/src/controllers/tickets.controller.ts`
- Test: `backend/tests/routes/tickets.test.ts`
- Test: `backend/tests/routes/publicTickets.test.ts`

**Interfaces:**
- Consumes: `findExistingCustomerByContact(contact, excludeId?)` from `backend/src/services/customers.service.ts` (Task 1).
- Produces: `listTickets`'s filters gain `customerId?: string`. No other task in this plan depends on this.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `backend/tests/routes/tickets.test.ts` (after the existing `describe('automatic assignment on ticket creation', ...)` block — reuse the file's existing `createStaff`/`createCustomerFixture` helpers, do not redefine them):

```ts
describe('customer deduplication on ticket creation', () => {
  it('reuses an existing customer when the newCustomer email matches', async () => {
    const { token } = await createStaff('AGENT', 'dedup-creator@example.com');
    const existing = await prisma.customer.create({ data: { fullName: 'Jane Original', email: 'jane@example.com' } });

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Ticket', description: 'Desc', newCustomer: { fullName: 'Jane Typo', email: 'jane@example.com' } });

    expect(res.status).toBe(201);
    expect(res.body.customer.id).toBe(existing.id);
    expect(await prisma.customer.count()).toBe(1);
  });

  it('reuses an existing customer when the newCustomer phone matches', async () => {
    const { token } = await createStaff('AGENT', 'dedup-creator2@example.com');
    const existing = await prisma.customer.create({ data: { fullName: 'Bob Original', phone: '555-0100' } });

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Ticket', description: 'Desc', newCustomer: { fullName: 'Bob Typo', phone: '555-0100' } });

    expect(res.status).toBe(201);
    expect(res.body.customer.id).toBe(existing.id);
  });

  it('creates a new customer when neither email nor phone matches an existing one', async () => {
    const { token } = await createStaff('AGENT', 'dedup-creator3@example.com');
    await prisma.customer.create({ data: { fullName: 'Unrelated', email: 'unrelated@example.com' } });

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Ticket', description: 'Desc', newCustomer: { fullName: 'Brand New', email: 'brand-new@example.com' } });

    expect(res.status).toBe(201);
    expect(await prisma.customer.count()).toBe(2);
  });

  it('always creates a new customer when neither email nor phone is provided', async () => {
    const { token } = await createStaff('AGENT', 'dedup-creator4@example.com');
    await prisma.customer.create({ data: { fullName: 'Existing Walk-in' } });

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Ticket', description: 'Desc', newCustomer: { fullName: 'Another Walk-in' } });

    expect(res.status).toBe(201);
    expect(await prisma.customer.count()).toBe(2);
  });
});

describe('GET /api/tickets?customerId=', () => {
  it('filters tickets by customer', async () => {
    const { user, token } = await createStaff('AGENT', 'customer-filter@example.com');
    const customerA = await createCustomerFixture();
    const customerB = await prisma.customer.create({ data: { fullName: 'Other Customer', email: 'other@example.com' } });
    await prisma.ticket.create({
      data: { subject: 'For A', description: 'Desc', customerId: customerA.id, createdById: user.id },
    });
    await prisma.ticket.create({
      data: { subject: 'For B', description: 'Desc', customerId: customerB.id, createdById: user.id },
    });

    const res = await request(app).get(`/api/tickets?customerId=${customerA.id}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].subject).toBe('For A');
  });
});
```

Add this test inside the existing `describe('POST /api/public/tickets', ...)` block in `backend/tests/routes/publicTickets.test.ts` (after the last existing `it`):

```ts
  it('reuses an existing customer when the email matches', async () => {
    const existing = await prisma.customer.create({ data: { fullName: 'Existing Customer', email: 'jane@example.com' } });

    const res = await request(app).post('/api/public/tickets').send({
      fullName: 'Jane Typo',
      email: 'jane@example.com',
      subject: 'Cannot log in',
      description: 'Getting an error on login',
    });

    expect(res.status).toBe(201);
    const ticket = await prisma.ticket.findFirst({ where: { subject: 'Cannot log in' } });
    expect(ticket?.customerId).toBe(existing.id);
    expect(await prisma.customer.count()).toBe(1);
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd backend && npm test -- tickets.test.ts publicTickets.test.ts`
Expected: FAIL — dedup tests fail because `createTicket` always creates a fresh customer today; the `customerId` filter test fails because `GET /api/tickets` doesn't accept that query param yet (returns both tickets, not one).

- [ ] **Step 3: Wire dedup into `createTicket` and add the `customerId` filter**

In `backend/src/services/tickets.service.ts`, add this import alongside the existing ones at the top of the file:

```ts
import { findExistingCustomerByContact } from './customers.service';
```

Replace the `listTickets` function (currently):

```ts
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
```

with:

```ts
export async function listTickets(filters: {
  status?: TicketStatus;
  assigneeId?: string;
  departmentId?: string;
  categoryId?: string;
  customerId?: string;
  unassigned?: boolean;
  escalated?: boolean;
}): Promise<TicketWithRelations[]> {
  return prisma.ticket.findMany({
    where: {
      status: filters.status,
      assigneeId: filters.unassigned ? null : filters.assigneeId,
      departmentId: filters.departmentId,
      categoryId: filters.categoryId,
      customerId: filters.customerId,
      isEscalated: filters.escalated ? true : undefined,
    },
    include: ticketInclude,
    orderBy: { createdAt: 'desc' },
  });
}
```

In `createTicket`, replace:

```ts
  let customerId = data.customerId;
  if (!customerId && data.newCustomer) {
    const customer = await prisma.customer.create({ data: data.newCustomer });
    customerId = customer.id;
  }
```

with:

```ts
  let customerId = data.customerId;
  if (!customerId && data.newCustomer) {
    const existingCustomer = await findExistingCustomerByContact(data.newCustomer);
    customerId = existingCustomer ? existingCustomer.id : (await prisma.customer.create({ data: data.newCustomer })).id;
  }
```

- [ ] **Step 4: Read `customerId` from the query string in the controller**

In `backend/src/controllers/tickets.controller.ts`, replace `listTicketsHandler`'s body (currently):

```ts
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
```

with:

```ts
export async function listTicketsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, assigneeId, departmentId, categoryId, customerId, unassigned, escalated } = req.query;
    const tickets = await ticketsService.listTickets({
      status: status as TicketStatus | undefined,
      assigneeId: assigneeId as string | undefined,
      departmentId: departmentId as string | undefined,
      categoryId: categoryId as string | undefined,
      customerId: customerId as string | undefined,
      unassigned: unassigned === 'true',
      escalated: escalated === 'true',
    });
    res.json(await attachSlaStatus(tickets));
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `cd backend && npm test -- tickets.test.ts publicTickets.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full backend suite and typecheck**

Run: `cd backend && npm test && npm run build`
Expected: PASS, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/tickets.service.ts backend/src/controllers/tickets.controller.ts backend/tests/routes/tickets.test.ts backend/tests/routes/publicTickets.test.ts
git commit -m "feat(backend): reuse an existing customer on ticket creation, filter tickets by customer"
```

---

### Task 3: Frontend — Customers directory (search, create) and nav entry

**Files:**
- Modify: `frontend/src/api/customers.ts`
- Create: `frontend/src/views/customers/CustomerListView.vue`
- Modify: `frontend/src/layouts/AppShell.vue`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/ar.json`
- Modify: `frontend/tests/AppShell.test.ts` (route-array ripple — see Step 6)
- Test: `frontend/tests/views/customers/CustomerListView.test.ts`

**Interfaces:**
- Consumes: `GET /api/customers` (unchanged), `POST /api/customers` (Task 1).
- Produces: `ApiCustomer`, `ApiCustomerTicket`, `ApiCustomerDetail`, `fetchCustomer`, `createCustomer`, `updateCustomer` — all exported from `frontend/src/api/customers.ts`. Task 4 imports `fetchCustomer`/`updateCustomer`/`ApiCustomerDetail`/`ApiCustomerTicket`; Task 4 and Task 5 both rely on the router route named `'customers'` this task registers and the nav item pointing at it.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/views/customers/CustomerListView.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/customers', () => ({
  searchCustomers: vi.fn(),
  createCustomer: vi.fn(),
}));

import axios from 'axios';
import { searchCustomers, createCustomer } from '../../../src/api/customers';
import CustomerListView from '../../../src/views/customers/CustomerListView.vue';

const routes = [
  { path: '/', component: { template: '<div />' } },
  { path: '/customers', name: 'customers', component: CustomerListView },
  { path: '/customers/:id', name: 'customer-detail', component: { template: '<div />' } },
];

describe('CustomerListView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(searchCustomers).mockResolvedValue([
      { id: 'c1', fullName: 'Jane Customer', email: 'jane@example.com', phone: null },
    ]);
  });

  it('renders searched customers', async () => {
    const wrapper = mountWithPlugins(CustomerListView, {}, routes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Jane Customer');
    expect(wrapper.text()).toContain('jane@example.com');
  });

  it('creates a customer and refreshes the list', async () => {
    vi.mocked(createCustomer).mockResolvedValue({ id: 'c2', fullName: 'New Customer', email: null, phone: null });

    const wrapper = mountWithPlugins(CustomerListView, {}, routes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="customer-create-button"]').trigger('click');
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="customer-fullname"] input').setValue('New Customer');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(createCustomer).toHaveBeenCalledWith({ fullName: 'New Customer', email: undefined, phone: undefined });
  });

  it('shows the conflict message with a link to the existing customer on a 409', async () => {
    const axiosError = Object.assign(new Error('Request failed with status code 409'), {
      isAxiosError: true,
      response: {
        data: {
          error: { code: 'CUSTOMER_EXISTS', message: 'A customer with this email or phone already exists' },
          existingCustomerId: 'c1',
        },
      },
    });
    vi.mocked(createCustomer).mockRejectedValue(axiosError);
    vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const wrapper = mountWithPlugins(CustomerListView, {}, routes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="customer-create-button"]').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-testid="customer-fullname"] input').setValue('Dup Customer');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="customer-error"]').exists()).toBe(true);
    const link = wrapper.find('[data-testid="customer-conflict-link"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toContain('/customers/c1');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd frontend && npm test -- CustomerListView.test.ts`
Expected: FAIL — `CustomerListView.vue` doesn't exist yet (module resolution error).

- [ ] **Step 3: Extend the customers API client**

Replace the full contents of `frontend/src/api/customers.ts` (currently):

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

with:

```ts
import { apiClient } from './client';

export interface ApiCustomer {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}

export interface ApiCustomerTicket {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
}

export interface ApiCustomerDetail extends ApiCustomer {
  tickets: ApiCustomerTicket[];
}

export async function searchCustomers(query: string): Promise<ApiCustomer[]> {
  const res = await apiClient.get('/customers', { params: { query } });
  return res.data;
}

export async function fetchCustomer(id: string): Promise<ApiCustomerDetail> {
  const res = await apiClient.get(`/customers/${id}`);
  return res.data;
}

export async function createCustomer(data: { fullName: string; email?: string; phone?: string }): Promise<ApiCustomer> {
  const res = await apiClient.post('/customers', data);
  return res.data;
}

export async function updateCustomer(
  id: string,
  data: Partial<{ fullName: string; email: string; phone: string }>
): Promise<ApiCustomer> {
  const res = await apiClient.patch(`/customers/${id}`, data);
  return res.data;
}
```

- [ ] **Step 4: Create `CustomerListView.vue`**

Create `frontend/src/views/customers/CustomerListView.vue`:

```vue
<template>
  <v-container fluid>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1>{{ $t('customers.title') }}</h1>
      <v-btn color="primary" data-testid="customer-create-button" @click="openCreate">{{ $t('customers.create') }}</v-btn>
    </div>

    <v-text-field
      v-model="query"
      data-testid="customer-search"
      :label="$t('customers.search')"
      clearable
      class="mb-4"
      style="max-width: 320px"
      @update:model-value="onSearch"
    />

    <v-data-table :items="customers" :headers="headers" @click:row="goToCustomer">
      <template #item.email="{ item }">{{ item.email ?? '-' }}</template>
      <template #item.phone="{ item }">{{ item.phone ?? '-' }}</template>
    </v-data-table>

    <v-dialog v-model="dialogOpen" max-width="480">
      <v-card :title="$t('customers.create')">
        <v-card-text>
          <form @submit.prevent="submit">
            <v-text-field v-model="form.fullName" data-testid="customer-fullname" :label="$t('customers.fullName')" />
            <v-text-field v-model="form.email" data-testid="customer-email" :label="$t('customers.email')" />
            <v-text-field v-model="form.phone" data-testid="customer-phone" :label="$t('customers.phone')" />
            <p v-if="error" data-testid="customer-error" class="text-error mb-2">
              {{ error }}
              <router-link
                v-if="conflictId"
                :to="{ name: 'customer-detail', params: { id: conflictId } }"
                data-testid="customer-conflict-link"
              >
                {{ $t('customers.viewExisting') }}
              </router-link>
            </p>
            <v-btn type="submit" color="primary" data-testid="customer-save-button" :disabled="!form.fullName">
              {{ $t('customers.save') }}
            </v-btn>
          </form>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { searchCustomers, createCustomer, type ApiCustomer } from '../../api/customers';

const router = useRouter();
const { t } = useI18n();

const customers = ref<ApiCustomer[]>([]);
const query = ref('');
const dialogOpen = ref(false);
const error = ref('');
const conflictId = ref<string | null>(null);

const headers = [
  { title: 'Name', key: 'fullName' },
  { title: 'Email', key: 'email' },
  { title: 'Phone', key: 'phone' },
];

const form = reactive({ fullName: '', email: '', phone: '' });

function extractBackendErrorMessage(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.error?.message;
  }
  return undefined;
}

function extractExistingCustomerId(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.existingCustomerId;
  }
  return undefined;
}

async function load() {
  customers.value = await searchCustomers(query.value);
}

function onSearch() {
  load();
}

function openCreate() {
  Object.assign(form, { fullName: '', email: '', phone: '' });
  error.value = '';
  conflictId.value = null;
  dialogOpen.value = true;
}

async function submit() {
  error.value = '';
  conflictId.value = null;
  try {
    await createCustomer({
      fullName: form.fullName,
      email: form.email || undefined,
      phone: form.phone || undefined,
    });
    dialogOpen.value = false;
    await load();
  } catch (err) {
    conflictId.value = extractExistingCustomerId(err) ?? null;
    error.value = extractBackendErrorMessage(err) ?? t('customers.saveError');
  }
}

function goToCustomer(_event: Event, row: { item: ApiCustomer }) {
  router.push({ name: 'customer-detail', params: { id: row.item.id } });
}

onMounted(load);
</script>
```

- [ ] **Step 5: Add nav item and router route**

In `frontend/src/layouts/AppShell.vue`, replace:

```html
        <v-list-item :title="$t('nav.home')" :to="{ name: 'home' }" />
        <v-list-item :title="$t('nav.tickets')" :to="{ name: 'tickets' }" />
        <v-list-item v-if="isAdmin" :title="$t('nav.users')" :to="{ name: 'users' }" />
```

with:

```html
        <v-list-item :title="$t('nav.home')" :to="{ name: 'home' }" />
        <v-list-item :title="$t('nav.tickets')" :to="{ name: 'tickets' }" />
        <v-list-item :title="$t('nav.customers')" :to="{ name: 'customers' }" />
        <v-list-item v-if="isAdmin" :title="$t('nav.users')" :to="{ name: 'users' }" />
```

In `frontend/src/router/index.ts`, add this import alongside the existing view imports:

```ts
import CustomerListView from '../views/customers/CustomerListView.vue';
```

and replace:

```ts
        { path: 'tickets/:id', name: 'ticket-detail', component: TicketDetailView },
        { path: 'users', name: 'users', component: UserListView, meta: { roles: ['ADMIN'] } },
```

with:

```ts
        { path: 'tickets/:id', name: 'ticket-detail', component: TicketDetailView },
        { path: 'customers', name: 'customers', component: CustomerListView },
        { path: 'users', name: 'users', component: UserListView, meta: { roles: ['ADMIN'] } },
```

Note: no `meta: { roles: [...] }` on the `customers` route — matching `tickets`, it's reachable by any authenticated staff member.

- [ ] **Step 6: Fix the AppShell test ripple**

`AppShell.test.ts` mounts `AppShell` with its own router instances built from explicit route arrays — since Step 5 adds a `:to="{ name: 'customers' }"` link that vue-router needs to resolve, both of this test file's route arrays need a matching entry. In `frontend/tests/AppShell.test.ts`, find this exact block (it appears twice, once in each `it`):

```ts
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/tickets', name: 'tickets', component: { template: '<div />' } },
      { path: '/users', name: 'users', component: { template: '<div />' } },
```

Replace **both occurrences** with:

```ts
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/tickets', name: 'tickets', component: { template: '<div />' } },
      { path: '/customers', name: 'customers', component: { template: '<div />' } },
      { path: '/users', name: 'users', component: { template: '<div />' } },
```

- [ ] **Step 7: Add locale keys**

In `frontend/src/locales/en.json`, replace the `nav` line (currently):

```json
  "nav": { "home": "Home", "tickets": "Tickets", "users": "Users", "departments": "Departments", "ticketCategories": "Ticket Categories", "quickReplies": "Quick Replies", "slaTargets": "SLA Targets", "logout": "Logout" },
```

with:

```json
  "nav": { "home": "Home", "tickets": "Tickets", "customers": "Customers", "users": "Users", "departments": "Departments", "ticketCategories": "Ticket Categories", "quickReplies": "Quick Replies", "slaTargets": "SLA Targets", "logout": "Logout" },
```

and, right after the `"slaTargets": { ... },` block (before `"widget": { ... }`), insert:

```json
  "customers": {
    "title": "Customers",
    "create": "New Customer",
    "search": "Search customers",
    "fullName": "Full name",
    "email": "Email",
    "phone": "Phone",
    "save": "Save",
    "saveError": "Something went wrong saving this customer. Please try again.",
    "viewExisting": "View existing customer",
    "edit": "Edit",
    "ticketHistory": "Ticket History",
    "noTickets": "No tickets yet."
  },
```

In `frontend/src/locales/ar.json`, replace the `nav` line (currently):

```json
  "nav": { "home": "الرئيسية", "tickets": "التذاكر", "users": "المستخدمون", "departments": "الأقسام", "ticketCategories": "فئات التذاكر", "quickReplies": "الردود السريعة", "slaTargets": "أهداف اتفاقية مستوى الخدمة", "logout": "تسجيل الخروج" },
```

with:

```json
  "nav": { "home": "الرئيسية", "tickets": "التذاكر", "customers": "العملاء", "users": "المستخدمون", "departments": "الأقسام", "ticketCategories": "فئات التذاكر", "quickReplies": "الردود السريعة", "slaTargets": "أهداف اتفاقية مستوى الخدمة", "logout": "تسجيل الخروج" },
```

and, in the same place (right after `"slaTargets": { ... },`, before `"widget": { ... }`), insert:

```json
  "customers": {
    "title": "العملاء",
    "create": "عميل جديد",
    "search": "بحث عن عملاء",
    "fullName": "الاسم الكامل",
    "email": "البريد الإلكتروني",
    "phone": "الهاتف",
    "save": "حفظ",
    "saveError": "حدث خطأ أثناء حفظ بيانات العميل. يرجى المحاولة مرة أخرى.",
    "viewExisting": "عرض العميل الحالي",
    "edit": "تعديل",
    "ticketHistory": "سجل التذاكر",
    "noTickets": "لا توجد تذاكر بعد."
  },
```

- [ ] **Step 8: Run the test and verify it passes**

Run: `cd frontend && npm test -- CustomerListView.test.ts AppShell.test.ts`
Expected: PASS.

- [ ] **Step 9: Run the full frontend suite and typecheck**

Run: `cd frontend && npm test && npx vue-tsc -b`
Expected: PASS, no TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/api/customers.ts frontend/src/views/customers/CustomerListView.vue frontend/src/layouts/AppShell.vue frontend/src/router/index.ts frontend/src/locales/en.json frontend/src/locales/ar.json frontend/tests/AppShell.test.ts frontend/tests/views/customers/CustomerListView.test.ts
git commit -m "feat(frontend): add customer directory with search and create"
```

---

### Task 4: Frontend — Customer profile page (info, ticket history, edit)

**Files:**
- Create: `frontend/src/views/customers/CustomerDetailView.vue`
- Modify: `frontend/src/router/index.ts`
- Test: `frontend/tests/views/customers/CustomerDetailView.test.ts`

**Interfaces:**
- Consumes: `fetchCustomer`, `updateCustomer`, `ApiCustomerDetail`, `ApiCustomerTicket` from `frontend/src/api/customers.ts` (Task 3). The route name `'customers'` and its nav item (Task 3) — this task only adds `'customer-detail'`.
- Produces: router route named `'customer-detail'` (path `customers/:id`) — Task 5 links into this route from the ticket list/detail views.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/views/customers/CustomerDetailView.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/customers', () => ({
  fetchCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));

import axios from 'axios';
import { fetchCustomer, updateCustomer } from '../../../src/api/customers';
import CustomerDetailView from '../../../src/views/customers/CustomerDetailView.vue';

// Matches the existing convention in TicketDetailView.test.ts: the route's
// :id param is supplied via global.mocks.$route (not by actually navigating
// the real router — the mocked fetchCustomer ignores its argument anyway).
// The route table still needs a real 'customer-detail' entry, though,
// because the conflict-link's router-link resolves it for real.
const routes = [
  { path: '/', component: { template: '<div />' } },
  { path: '/customers/:id', name: 'customer-detail', component: { template: '<div />' } },
  { path: '/tickets/:id', name: 'ticket-detail', component: { template: '<div />' } },
];

function mountCustomerDetail() {
  return mountWithPlugins(CustomerDetailView, { global: { mocks: { $route: { params: { id: 'c1' } } } } }, routes);
}

describe('CustomerDetailView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('renders the customer and their ticket history', async () => {
    vi.mocked(fetchCustomer).mockResolvedValue({
      id: 'c1',
      fullName: 'Jane Customer',
      email: 'jane@example.com',
      phone: null,
      tickets: [{ id: 't1', subject: 'Cannot log in', status: 'OPEN', priority: 'HIGH', createdAt: '2026-08-27T00:00:00.000Z' }],
    });

    const wrapper = mountCustomerDetail();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Jane Customer');
    expect(wrapper.text()).toContain('jane@example.com');
    expect(wrapper.text()).toContain('Cannot log in');
  });

  it('shows the empty state when the customer has no tickets', async () => {
    vi.mocked(fetchCustomer).mockResolvedValue({
      id: 'c1',
      fullName: 'Jane Customer',
      email: null,
      phone: null,
      tickets: [],
    });

    const wrapper = mountCustomerDetail();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('No tickets yet');
  });

  it('edits the customer and shows the updated info', async () => {
    vi.mocked(fetchCustomer).mockResolvedValue({
      id: 'c1',
      fullName: 'Jane Customer',
      email: 'jane@example.com',
      phone: null,
      tickets: [],
    });
    vi.mocked(updateCustomer).mockResolvedValue({ id: 'c1', fullName: 'Jane Updated', email: 'jane@example.com', phone: null });

    const wrapper = mountCustomerDetail();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="customer-edit-button"]').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-testid="customer-fullname"] input').setValue('Jane Updated');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(updateCustomer).toHaveBeenCalledWith('c1', { fullName: 'Jane Updated', email: 'jane@example.com', phone: undefined });
    expect(wrapper.text()).toContain('Jane Updated');
  });

  it('shows the conflict message with a link to the existing customer on a 409', async () => {
    vi.mocked(fetchCustomer).mockResolvedValue({
      id: 'c1',
      fullName: 'Jane Customer',
      email: 'jane@example.com',
      phone: null,
      tickets: [],
    });
    const axiosError = Object.assign(new Error('Request failed with status code 409'), {
      isAxiosError: true,
      response: {
        data: {
          error: { code: 'CUSTOMER_EXISTS', message: 'A customer with this email or phone already exists' },
          existingCustomerId: 'c2',
        },
      },
    });
    vi.mocked(updateCustomer).mockRejectedValue(axiosError);
    vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const wrapper = mountCustomerDetail();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="customer-edit-button"]').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-testid="customer-email"] input').setValue('taken@example.com');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="customer-error"]').exists()).toBe(true);
    const link = wrapper.find('[data-testid="customer-conflict-link"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toContain('/customers/c2');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd frontend && npm test -- CustomerDetailView.test.ts`
Expected: FAIL — `CustomerDetailView.vue` doesn't exist yet.

- [ ] **Step 3: Create `CustomerDetailView.vue`**

Create `frontend/src/views/customers/CustomerDetailView.vue`:

```vue
<template>
  <v-container fluid v-if="customer">
    <h1 class="mb-4">{{ customer.fullName }}</h1>

    <v-row>
      <v-col cols="12" md="4">
        <v-list density="compact">
          <v-list-item :title="$t('customers.email')" :subtitle="customer.email ?? '-'" />
          <v-list-item :title="$t('customers.phone')" :subtitle="customer.phone ?? '-'" />
        </v-list>
        <v-btn data-testid="customer-edit-button" class="mt-2" @click="openEdit">{{ $t('customers.edit') }}</v-btn>
      </v-col>

      <v-col cols="12" md="8">
        <h2 class="text-h6 mb-2">{{ $t('customers.ticketHistory') }}</h2>
        <v-data-table
          v-if="customer.tickets.length"
          :items="customer.tickets"
          :headers="ticketHeaders"
          @click:row="goToTicket"
        />
        <p v-else class="text-medium-emphasis">{{ $t('customers.noTickets') }}</p>
      </v-col>
    </v-row>

    <v-dialog v-model="dialogOpen" max-width="480">
      <v-card :title="$t('customers.edit')">
        <v-card-text>
          <form @submit.prevent="submit">
            <v-text-field v-model="form.fullName" data-testid="customer-fullname" :label="$t('customers.fullName')" />
            <v-text-field v-model="form.email" data-testid="customer-email" :label="$t('customers.email')" />
            <v-text-field v-model="form.phone" data-testid="customer-phone" :label="$t('customers.phone')" />
            <p v-if="error" data-testid="customer-error" class="text-error mb-2">
              {{ error }}
              <router-link
                v-if="conflictId"
                :to="{ name: 'customer-detail', params: { id: conflictId } }"
                data-testid="customer-conflict-link"
              >
                {{ $t('customers.viewExisting') }}
              </router-link>
            </p>
            <v-btn type="submit" color="primary" data-testid="customer-save-button" :disabled="!form.fullName">
              {{ $t('customers.save') }}
            </v-btn>
          </form>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { fetchCustomer, updateCustomer, type ApiCustomerDetail, type ApiCustomerTicket } from '../../api/customers';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const customer = ref<ApiCustomerDetail | null>(null);
const dialogOpen = ref(false);
const error = ref('');
const conflictId = ref<string | null>(null);

const ticketHeaders = [
  { title: 'Subject', key: 'subject' },
  { title: 'Status', key: 'status' },
  { title: 'Priority', key: 'priority' },
];

const form = reactive({ fullName: '', email: '', phone: '' });

function extractBackendErrorMessage(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.error?.message;
  }
  return undefined;
}

function extractExistingCustomerId(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.existingCustomerId;
  }
  return undefined;
}

async function load() {
  customer.value = await fetchCustomer(route.params.id as string);
}

function openEdit() {
  if (!customer.value) return;
  Object.assign(form, {
    fullName: customer.value.fullName,
    email: customer.value.email ?? '',
    phone: customer.value.phone ?? '',
  });
  error.value = '';
  conflictId.value = null;
  dialogOpen.value = true;
}

async function submit() {
  if (!customer.value) return;
  error.value = '';
  conflictId.value = null;
  try {
    const updated = await updateCustomer(customer.value.id, {
      fullName: form.fullName,
      email: form.email || undefined,
      phone: form.phone || undefined,
    });
    customer.value = { ...updated, tickets: customer.value.tickets };
    dialogOpen.value = false;
  } catch (err) {
    conflictId.value = extractExistingCustomerId(err) ?? null;
    error.value = extractBackendErrorMessage(err) ?? t('customers.saveError');
  }
}

function goToTicket(_event: Event, row: { item: ApiCustomerTicket }) {
  router.push({ name: 'ticket-detail', params: { id: row.item.id } });
}

onMounted(load);
</script>
```

- [ ] **Step 4: Register the route**

In `frontend/src/router/index.ts`, add this import alongside the existing view imports:

```ts
import CustomerDetailView from '../views/customers/CustomerDetailView.vue';
```

and replace:

```ts
        { path: 'customers', name: 'customers', component: CustomerListView },
```

with:

```ts
        { path: 'customers', name: 'customers', component: CustomerListView },
        { path: 'customers/:id', name: 'customer-detail', component: CustomerDetailView },
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `cd frontend && npm test -- CustomerDetailView.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full frontend suite and typecheck**

Run: `cd frontend && npm test && npx vue-tsc -b`
Expected: PASS, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/customers/CustomerDetailView.vue frontend/src/router/index.ts frontend/tests/views/customers/CustomerDetailView.test.ts
git commit -m "feat(frontend): add customer profile page with ticket history and edit"
```

---

### Task 5: Frontend — link the customer name from ticket views to the new profile page

**Files:**
- Modify: `frontend/src/views/tickets/TicketListView.vue`
- Modify: `frontend/src/views/tickets/TicketDetailView.vue`
- Modify: `frontend/tests/views/tickets/TicketListView.test.ts` (route-array ripple — see Step 1)
- Modify: `frontend/tests/views/tickets/TicketDetailView.test.ts` (route-array ripple — see Step 1)

**Interfaces:**
- Consumes: the `'customer-detail'` route (Task 4). `ApiTicketSummary.customer` already carries `{ id, fullName }` (unchanged, no type edits needed).
- Produces: nothing further tasks depend on — this is the last task in the plan.

- [ ] **Step 1: Write the failing tests (and fix the router-array ripple in the same pass)**

Both `TicketListView.vue` and `TicketDetailView.vue` will gain a `router-link` to `{ name: 'customer-detail', ... }`. Every existing test that mounts either component needs that route registered in its router array, or resolution fails. Do this fix as part of writing the new assertions, in the same commit.

In `frontend/tests/views/tickets/TicketListView.test.ts`, this exact 3-line array (it appears 4 times, once per `it` block) needs a 4th line — find and replace **all 4 occurrences**:

Find:
```ts
      { path: '/', component: { template: '<div />' } },
      { path: '/tickets/:id', name: 'ticket-detail', component: { template: '<div />' } },
      { path: '/tickets/new', name: 'ticket-new', component: { template: '<div />' } },
```

Replace with:
```ts
      { path: '/', component: { template: '<div />' } },
      { path: '/tickets/:id', name: 'ticket-detail', component: { template: '<div />' } },
      { path: '/tickets/new', name: 'ticket-new', component: { template: '<div />' } },
      { path: '/customers/:id', name: 'customer-detail', component: { template: '<div />' } },
```

Then add this new test at the end of the `describe('TicketListView', ...)` block, right before its closing `});`:

```ts
  it('links the customer name to their profile page', async () => {
    const wrapper = mountWithPlugins(TicketListView, {}, [
      { path: '/', component: { template: '<div />' } },
      { path: '/tickets/:id', name: 'ticket-detail', component: { template: '<div />' } },
      { path: '/tickets/new', name: 'ticket-new', component: { template: '<div />' } },
      { path: '/customers/:id', name: 'customer-detail', component: { template: '<div />' } },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    const link = wrapper.find('a[href="/customers/c1"]');
    expect(link.exists()).toBe(true);
    expect(link.text()).toBe('Jane Customer');
  });
```

In `frontend/tests/views/tickets/TicketDetailView.test.ts`, this exact single-line array appears 6 times — find and replace **all 6 occurrences**:

Find:
```ts
[{ path: '/', component: { template: '<div />' } }]
```

Replace with:
```ts
[{ path: '/', component: { template: '<div />' } }, { path: '/customers/:id', name: 'customer-detail', component: { template: '<div />' } }]
```

Then locate the test in this file that asserts on `ticket.customer.fullName` being rendered (it mounts a ticket fixture whose `customer` field includes an `id`; if the existing fixture's `customer` field is only `{ fullName: '...' }` without an `id`, add `id: 'c1'` to it) and add, in the same `it` block right after its existing assertions, this new assertion:

```ts
    const link = wrapper.find('a[href="/customers/c1"]');
    expect(link.exists()).toBe(true);
```

(If the customer id used in that file's fixture is not `c1`, use whatever id is actually there instead — match the fixture, don't change it.)

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd frontend && npm test -- TicketListView.test.ts TicketDetailView.test.ts`
Expected: FAIL — the new link-assertions fail because the customer name is still plain text, not a link.

- [ ] **Step 3: Make the customer name a link in `TicketListView.vue`**

In `frontend/src/views/tickets/TicketListView.vue`, replace:

```html
      <template #item.customer="{ item }">{{ item.customer.fullName }}</template>
```

with:

```html
      <template #item.customer="{ item }">
        <router-link :to="{ name: 'customer-detail', params: { id: item.customer.id } }" @click.stop>
          {{ item.customer.fullName }}
        </router-link>
      </template>
```

`@click.stop` is required here: this cell sits inside a `v-data-table` row that already has `@click:row="goToTicket"` navigating to the ticket. Without stopping propagation, clicking the customer name would navigate to the customer page and then immediately bubble up and navigate to the ticket page too.

- [ ] **Step 4: Make the customer name a link in `TicketDetailView.vue`**

In `frontend/src/views/tickets/TicketDetailView.vue`, replace:

```html
          <v-list-item :title="$t('tickets.customer')" :subtitle="ticket.customer.fullName" />
```

with:

```html
          <v-list-item :title="$t('tickets.customer')">
            <template #subtitle>
              <router-link :to="{ name: 'customer-detail', params: { id: ticket.customer.id } }">
                {{ ticket.customer.fullName }}
              </router-link>
            </template>
          </v-list-item>
```

No `@click.stop` needed here — this is a standalone detail page, not a table row with its own click handler.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `cd frontend && npm test -- TicketListView.test.ts TicketDetailView.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full frontend suite and typecheck**

Run: `cd frontend && npm test && npx vue-tsc -b`
Expected: PASS, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/tickets/TicketListView.vue frontend/src/views/tickets/TicketDetailView.vue frontend/tests/views/tickets/TicketListView.test.ts frontend/tests/views/tickets/TicketDetailView.test.ts
git commit -m "feat(frontend): link the customer name on ticket views to their profile page"
```

---

## Self-Review

**Spec coverage:**
- Directory + search: Task 3. Profile + ticket history: Task 4. Direct create: Task 3. Edit: Task 4. Dedup (silent on ticket creation, explicit 409 on create/edit): Task 1 (helper + 409 paths) and Task 2 (silent wiring into `createTicket`). Customer-name links from ticket views: Task 5. All-staff access (no role gate): reflected by every new route having no `meta.roles`, matching `tickets`. `customerId` filter on `GET /api/tickets`: Task 2.
- Non-Goals correctly absent: no new `Customer` fields, no delete route, no merge tooling, no fuzzy matching, no role restriction — nothing in any task builds these.

**Placeholder scan:** No TBD/TODO; every step has literal, complete code.

**Type consistency:** `ApiCustomer`/`ApiCustomerDetail`/`ApiCustomerTicket` (Task 3) are the exact types Task 4 imports and uses. `findExistingCustomerByContact`'s signature (Task 1) exactly matches Task 2's call site (`findExistingCustomerByContact(data.newCustomer)` — `data.newCustomer` is `{ fullName: string; email?: string; phone?: string }`, a superset of the `{ email?: string; phone?: string }` parameter, which is fine since `fullName` is simply an extra property TypeScript's structural typing ignores here). Route name `'customer-detail'` is spelled identically everywhere it's referenced (Tasks 3, 4, 5). `HttpError`'s new `details` parameter (Task 1) is consumed only by `errorHandler.ts` in the same task; no other task touches either file.

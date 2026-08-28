# Auto-Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically assign a newly created ticket to the least-busy eligible agent, instead of every ticket starting unassigned.

**Architecture:** A single new function, `pickAutoAssignee(departmentId)`, added to `backend/src/services/tickets.service.ts`. It is called once, from inside `createTicket`, before the ticket row is inserted, and its result is passed straight into that same insert's `assigneeId` field. No new files, no new routes, no new frontend code, no schema change.

**Tech Stack:** Express + TypeScript + Prisma + PostgreSQL (backend only — this is a backend-only change). Vitest + Supertest against a real test database for tests.

**Spec:** docs/superpowers/specs/2026-08-28-auto-assignment-design.md

## Global Constraints

- Strategy is **least-busy**: fewest `OPEN`+`IN_PROGRESS` tickets among eligible candidates wins. Ties break by comparing user `id` strings (`a.id.localeCompare(b.id)`) — arbitrary but deterministic.
- Eligible pool = active (`isActive: true`) `AGENT`-role users. `SUPERVISOR` and `ADMIN` are never eligible, regardless of department.
- Pool selection is **department-scoped with an org-wide fallback**: if the ticket has a `departmentId`, only agents in that department are considered first; if the ticket has no department, or that department has zero eligible agents, fall back to all active `AGENT`-role users org-wide.
- If there are zero eligible agents anywhere, the ticket is created with `assigneeId: null` — this is not an error.
- Runs **once, at ticket creation only** — both `POST /api/tickets` (manual) and `POST /api/public/tickets` (web form) go through the same `createTicket` function and get the same behavior. A ticket that later becomes unassigned again (release, or manual unassign via `POST /api/tickets/:id/assign` with `assigneeId: null`) is NOT re-auto-assigned.
- No `TicketEvent` is written for the initial auto-assignment — it's part of the ticket's created state, matching how `priority`/`categoryId`/`departmentId` are also not event-logged at creation. Only `updateTicketFields`/`assignTicket`/etc. (changes to an *existing* ticket) write events.
- No admin on/off toggle. Auto-assignment always runs.

---

## Investigation note (context for the implementer, not a step to redo)

The plan author checked whether this change breaks any existing backend
test. Every test that creates a ticket does one of two things:
(a) calls `prisma.ticket.create(...)` directly, bypassing
`tickets.service.ts`'s `createTicket` entirely (most tests, including
every test in `tests/models/ticketSchema.test.ts` and most of
`tests/routes/tickets.test.ts`), or (b) calls `POST /api/tickets` /
`POST /api/public/tickets` — the real code path this plan changes — but
none of those specific tests assert anything about `assignee`/`assigneeId`.
**No existing test needs to change.** Only `backend/tests/routes/tickets.test.ts`
and `backend/tests/routes/publicTickets.test.ts` need new tests added.

---

### Task 1: Auto-assign new tickets to the least-busy eligible agent

**Files:**
- Modify: `backend/src/services/tickets.service.ts` (add `pickAutoAssignee`, wire into `createTicket`)
- Test: `backend/tests/routes/tickets.test.ts` (extend the `createStaff` helper; add a new `describe('automatic assignment on ticket creation', ...)` block)
- Test: `backend/tests/routes/publicTickets.test.ts` (add one test)

**Interfaces:**
- Consumes: nothing from another task in this plan (this is the only task).
- Produces: `pickAutoAssignee(departmentId: string | null): Promise<string | null>` — a module-private (not exported) async function in `tickets.service.ts`. `createTicket`'s existing exported signature is unchanged; only its internal behavior and its callers' observable result (`assignee`/`assigneeId` on the response) change.

- [ ] **Step 1: Extend the `createStaff` test helper to accept an optional department**

In `backend/tests/routes/tickets.test.ts`, replace the current helper (lines 11-22):

```ts
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
```

with:

```ts
async function createStaff(role: Role, email: string, departmentId?: string) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('password123'),
      fullName: `${role} User`,
      role,
      departmentId,
    },
  });
  const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
  return { user, token };
}
```

This is backward compatible — every existing call site omits the third argument, so `departmentId` is `undefined` and behavior is unchanged for them.

- [ ] **Step 2: Write the failing tests in `tickets.test.ts`**

Add this new `describe` block at the end of `backend/tests/routes/tickets.test.ts` (after the existing `describe('GET /api/tickets filters', ...)` block):

```ts
describe('automatic assignment on ticket creation', () => {
  it('assigns a new ticket to the only active agent in its department', async () => {
    const department = await prisma.department.create({ data: { nameEn: 'Support', nameAr: 'الدعم' } });
    const { user: agent } = await createStaff('AGENT', 'auto-agent@example.com', department.id);
    const { token: creatorToken } = await createStaff('SUPERVISOR', 'auto-creator@example.com');
    const customer = await createCustomerFixture();

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ subject: 'Ticket', description: 'Desc', customerId: customer.id, departmentId: department.id });

    expect(res.status).toBe(201);
    expect(res.body.assignee.id).toBe(agent.id);
  });

  it('assigns to the least-busy agent when the department has multiple active agents', async () => {
    const department = await prisma.department.create({ data: { nameEn: 'Support', nameAr: 'الدعم' } });
    const { user: busyAgent } = await createStaff('AGENT', 'busy-agent@example.com', department.id);
    const { user: freeAgent } = await createStaff('AGENT', 'free-agent@example.com', department.id);
    const { token: creatorToken } = await createStaff('SUPERVISOR', 'auto-creator2@example.com');
    const customer = await createCustomerFixture();

    await prisma.ticket.create({
      data: { subject: 'Existing 1', description: 'Desc', customerId: customer.id, assigneeId: busyAgent.id, status: 'OPEN' },
    });
    await prisma.ticket.create({
      data: { subject: 'Existing 2', description: 'Desc', customerId: customer.id, assigneeId: busyAgent.id, status: 'IN_PROGRESS' },
    });

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ subject: 'New ticket', description: 'Desc', customerId: customer.id, departmentId: department.id });

    expect(res.status).toBe(201);
    expect(res.body.assignee.id).toBe(freeAgent.id);
  });

  it('falls back to an org-wide active agent when the ticket department has none', async () => {
    const emptyDept = await prisma.department.create({ data: { nameEn: 'Empty', nameAr: 'فارغ' } });
    const { user: orgAgent } = await createStaff('AGENT', 'org-agent@example.com');
    const { token: creatorToken } = await createStaff('SUPERVISOR', 'auto-creator3@example.com');
    const customer = await createCustomerFixture();

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ subject: 'Ticket', description: 'Desc', customerId: customer.id, departmentId: emptyDept.id });

    expect(res.status).toBe(201);
    expect(res.body.assignee.id).toBe(orgAgent.id);
  });

  it('uses the org-wide pool when the ticket has no department', async () => {
    const { user: orgAgent } = await createStaff('AGENT', 'org-agent2@example.com');
    const { token: creatorToken } = await createStaff('SUPERVISOR', 'auto-creator4@example.com');
    const customer = await createCustomerFixture();

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ subject: 'Ticket', description: 'Desc', customerId: customer.id });

    expect(res.status).toBe(201);
    expect(res.body.assignee.id).toBe(orgAgent.id);
  });

  it('creates the ticket unassigned when there are no eligible agents anywhere', async () => {
    const { token: creatorToken } = await createStaff('SUPERVISOR', 'auto-creator5@example.com');
    const customer = await createCustomerFixture();

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ subject: 'Ticket', description: 'Desc', customerId: customer.id });

    expect(res.status).toBe(201);
    expect(res.body.assignee).toBeNull();
  });

  it('excludes inactive agents and non-AGENT roles from the candidate pool', async () => {
    const department = await prisma.department.create({ data: { nameEn: 'Support', nameAr: 'الدعم' } });
    const inactiveAgent = await prisma.user.create({
      data: {
        email: 'inactive-agent@example.com',
        passwordHash: await hashPassword('password123'),
        fullName: 'Inactive Agent',
        role: 'AGENT',
        departmentId: department.id,
        isActive: false,
      },
    });
    const { user: supervisorInDept } = await createStaff('SUPERVISOR', 'dept-supervisor@example.com', department.id);
    const { user: orgAgent } = await createStaff('AGENT', 'org-agent3@example.com');
    const { token: creatorToken } = await createStaff('ADMIN', 'auto-creator6@example.com');
    const customer = await createCustomerFixture();

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ subject: 'Ticket', description: 'Desc', customerId: customer.id, departmentId: department.id });

    expect(res.status).toBe(201);
    expect(res.body.assignee.id).toBe(orgAgent.id);
    expect(res.body.assignee.id).not.toBe(inactiveAgent.id);
    expect(res.body.assignee.id).not.toBe(supervisorInDept.id);
  });

  it('does not re-run auto-assignment when a ticket is released back to unassigned', async () => {
    const { user: agent, token: agentToken } = await createStaff('AGENT', 'release-agent@example.com');
    await createStaff('AGENT', 'other-agent@example.com');
    const customer = await createCustomerFixture();
    const ticket = await prisma.ticket.create({
      data: { subject: 'Ticket', description: 'Desc', customerId: customer.id, assigneeId: agent.id },
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ assigneeId: null });

    expect(res.status).toBe(200);
    expect(res.body.assignee).toBeNull();
  });
});
```

- [ ] **Step 3: Write the failing test in `publicTickets.test.ts`**

Add this test inside the existing `describe('POST /api/public/tickets', ...)` block in `backend/tests/routes/publicTickets.test.ts` (after the last existing `it`):

```ts
  it('auto-assigns a ticket created via the public web form', async () => {
    const orgAgent = await prisma.user.create({
      data: {
        email: 'web-org-agent@example.com',
        passwordHash: await hashPassword('password123'),
        fullName: 'Org Agent',
        role: 'AGENT',
      },
    });

    const res = await request(app).post('/api/public/tickets').send({
      fullName: 'Web Customer',
      email: 'web-customer@example.com',
      subject: 'Cannot log in',
      description: 'Getting an error',
    });

    expect(res.status).toBe(201);
    const ticket = await prisma.ticket.findFirst({ where: { subject: 'Cannot log in' } });
    expect(ticket?.assigneeId).toBe(orgAgent.id);
  });
```

This test creates the agent directly via `prisma.user.create` (not through a `createStaff`-style helper, since `publicTickets.test.ts` has none) — add the needed import at the top of the file: `import { hashPassword } from '../../src/lib/password';` alongside the existing imports.

- [ ] **Step 4: Run the tests and verify they fail**

Run: `cd backend && npm test -- tickets.test.ts publicTickets.test.ts`
Expected: the new tests in the `automatic assignment on ticket creation` block FAIL (assigned agent assertions fail because every ticket is still created with `assigneeId: null` — nothing calls an auto-assignment function yet). The `auto-assigns a ticket created via the public web form` test also FAILS for the same reason. Every other existing test in both files still PASSES (confirming the investigation note above).

- [ ] **Step 5: Implement `pickAutoAssignee` and wire it into `createTicket`**

In `backend/src/services/tickets.service.ts`, add this function directly above `export async function createTicket(`:

```ts
async function pickAutoAssignee(departmentId: string | null): Promise<string | null> {
  let candidates = await prisma.user.findMany({
    where: { role: 'AGENT', isActive: true, ...(departmentId ? { departmentId } : {}) },
    select: { id: true },
  });
  if (departmentId && candidates.length === 0) {
    candidates = await prisma.user.findMany({
      where: { role: 'AGENT', isActive: true },
      select: { id: true },
    });
  }
  if (candidates.length === 0) {
    return null;
  }

  const counts = await prisma.ticket.groupBy({
    by: ['assigneeId'],
    where: {
      assigneeId: { in: candidates.map((c) => c.id) },
      status: { in: ['OPEN', 'IN_PROGRESS'] },
    },
    _count: true,
  });
  const countByAgent = new Map(counts.map((c) => [c.assigneeId as string, c._count]));

  const sorted = [...candidates].sort((a, b) => {
    const diff = (countByAgent.get(a.id) ?? 0) - (countByAgent.get(b.id) ?? 0);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
  return sorted[0].id;
}
```

Then replace the body of `createTicket` (currently):

```ts
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
  createdById: string | null,
  source: TicketSource = 'MANUAL'
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
      createdById: createdById ?? null,
      source,
    },
  });

  return getTicketById(ticket.id);
}
```

with:

```ts
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
  createdById: string | null,
  source: TicketSource = 'MANUAL'
): Promise<TicketDetail> {
  let customerId = data.customerId;
  if (!customerId && data.newCustomer) {
    const customer = await prisma.customer.create({ data: data.newCustomer });
    customerId = customer.id;
  }
  if (!customerId) {
    throw new HttpError(400, 'CUSTOMER_REQUIRED', 'Provide customerId or newCustomer');
  }

  const departmentId = data.departmentId ?? null;
  const assigneeId = await pickAutoAssignee(departmentId);

  const ticket = await prisma.ticket.create({
    data: {
      subject: data.subject,
      description: data.description,
      customerId,
      categoryId: data.categoryId ?? null,
      departmentId,
      priority: data.priority ?? 'MEDIUM',
      createdById: createdById ?? null,
      source,
      assigneeId,
    },
  });

  return getTicketById(ticket.id);
}
```

- [ ] **Step 6: Run the tests and verify they pass**

Run: `cd backend && npm test -- tickets.test.ts publicTickets.test.ts`
Expected: PASS — all new tests green, all previously-passing tests still green.

- [ ] **Step 7: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS — every test file green (confirms the investigation note's claim that no other test file is affected).

- [ ] **Step 8: Run the backend typecheck**

Run: `cd backend && npm run build`
Expected: no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/tickets.service.ts backend/tests/routes/tickets.test.ts backend/tests/routes/publicTickets.test.ts
git commit -m "feat(backend): auto-assign new tickets to the least-busy eligible agent"
```

---

## Self-Review

**Spec coverage:**
- Least-busy strategy, department-scoped pool with org-wide fallback, zero-eligible-agents → null, AGENT-only/isActive-only eligibility, creation-only trigger, uniform across manual + web-form paths, no `TicketEvent`/system-actor — all covered by Task 1's implementation and its 8 new tests.
- No admin toggle, no new frontend surface, no per-priority weighting — correctly absent; nothing to build for these Non-Goals.

**Placeholder scan:** No TBD/TODO; every step has literal, complete code.

**Type consistency:** `pickAutoAssignee(departmentId: string | null): Promise<string | null>` matches its only call site in `createTicket`, which already normalizes `data.departmentId ?? null` to a `string | null` before passing it in. `TicketDetail`'s `assignee` field (from `ticketInclude`'s `assignee: { select: { id, fullName, role } }`) is nullable, matching `res.body.assignee.id` (when set) / `res.body.assignee` (`null` when not) used across the tests.

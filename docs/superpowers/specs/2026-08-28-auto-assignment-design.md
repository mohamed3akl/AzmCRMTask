# AzmCRM — SLA & Automation: Auto-Assignment: Design Spec

**Date:** 2026-08-28
**Status:** Approved for planning
**Sub-project:** 7 of 12 (see [Roadmap](#roadmap) below) — depends on Ticket Management (assignment model) and SLA Targets + Visibility (both merged to `master`)

## Context

The original product spec (`azm_squad_customer_support_crm.pdf`, section 5)
lists "SLA & Automation" as one feature area: response/resolution targets,
automatic assignment, escalation rules, and alerts/notifications. The prior
sub-project built the first of these (targets + visibility) and explicitly
deferred the rest:

> "Automatic assignment. Deferred to a later SLA & Automation sub-project.
> Manual assignment (Ticket Management, Agent Dashboard) is unchanged."

This sub-project is that deferred slice: automatically assigning a newly
created ticket to an agent, instead of every ticket starting unassigned and
waiting for a human to claim or assign it. Escalation rules and alerts
remain separate future sub-projects.

Today, every ticket — created manually by staff (`POST /api/tickets`) or
via the public web form (`POST /api/public/tickets`) — is created with
`assigneeId: null`. An agent claims it, or a Supervisor/Admin assigns it,
via the existing `POST /api/tickets/:id/assign` endpoint
(`tickets.service.ts`'s `assignTicket`). That manual path is unchanged by
this sub-project — auto-assignment only decides what happens at the moment
of creation; claiming, releasing, and reassigning remain exactly as they
are.

## Roadmap

1. Foundation — done, merged to master
2. Ticket Management — done, merged to master
3. Agent Dashboard — done, merged to master
4. Communication Channels: Web Forms — done, merged to master
5. Communication Channels: remaining (Email, Live Chat, SMS, WhatsApp) —
   each needs its own spec; WhatsApp specifically is blocked on an external
   WhatsApp Business API account this project doesn't have yet
6. SLA & Automation: Targets + Visibility — done, merged to master
7. **SLA & Automation: Auto-Assignment (this spec)** — automatically assign
   newly created tickets to the least-busy eligible agent
8. SLA & Automation: remaining (escalation rules on breach,
   alerts/notifications) — separate future sub-projects
9. Knowledge Base — FAQs/articles/search
10. Customer Portal — self-service ticket submission/tracking (including
    looking up a ticket by the reference code Web Forms introduced)
11. AI Features — summaries, suggested replies, categorization, chatbot
12. Reports & Management dashboards; Integrations (ERP, external APIs)

## Goals

- When a ticket is created (any path — manual staff creation or web form),
  automatically assign it to an agent instead of leaving it unassigned.
- Strategy: **least-busy**. Assign to whichever eligible agent currently
  has the fewest tickets in `OPEN`/`IN_PROGRESS` status. This reuses the
  same "workload" concept `TeamWorkloadWidget` already computes
  client-side, just applied server-side at creation time.
- Eligible pool is **department-scoped with an org-wide fallback**: if the
  ticket has a `departmentId`, only active (`isActive: true`) `AGENT`-role
  users in that department are considered; if the ticket has no department,
  or that department has no eligible agents, fall back to all active
  `AGENT`-role users org-wide.
- If there are still no eligible agents at all (e.g. a brand-new
  deployment with no agents yet, or every agent deactivated), the ticket
  is created unassigned — today's behavior, unchanged. This is not an
  error condition.
- Applies uniformly to every creation path — manual and web-form tickets
  are auto-assigned the same way, through the same code path
  (`tickets.service.ts`'s `createTicket`).
- Runs exactly once, at creation. A ticket that later becomes unassigned
  again (an agent releases it, or a Supervisor/Admin unassigns it via the
  existing assign endpoint with `assigneeId: null`) stays unassigned —
  auto-assignment does not re-trigger. Release/unassign keep their current
  meaning: returning a ticket to the shared, human-triaged pool.

## Non-Goals / Explicitly Out of Scope

- **An admin on/off toggle.** Auto-assignment always runs; there is no
  setting to disable it. Simpler than `SlaTarget`-style admin
  configuration, and nothing in the requirements calls for turning it off.
- **Re-running on release/unassign.** Explicitly decided against — see
  Goals above. Only ticket creation triggers it.
- **Round-robin, or any strategy other than least-busy.** Considered and
  declined during brainstorming in favor of dynamic load balancing, which
  degrades more gracefully when agents have very different ticket
  turnaround times.
- **Per-department or per-priority strategy configuration.** One strategy,
  applied the same way everywhere a ticket is created.
- **Weighting by ticket priority or SLA urgency.** The strategy only looks
  at current OPEN+IN_PROGRESS count, not the priority of the ticket being
  assigned or of the tickets already on an agent's plate. A future SLA &
  Automation sub-project (escalation) may revisit this; this one doesn't.
- **A "TICKET_CREATED" or auto-assignment `TicketEvent`.** See Architecture
  below — the initial assignee is part of the ticket's created state, not
  a change to an existing ticket, so it is not event-logged, matching how
  the initial priority/category/department are also not event-logged at
  creation.
- **Assigning to `SUPERVISOR` or `ADMIN` users.** Only `AGENT`-role users
  are eligible — consistent with the existing self-claim restriction in
  `assignTicket`, which already assumes agents (not supervisors/admins) do
  frontline ticket work.
- **Perfect concurrency safety.** Two tickets created at nearly the same
  instant could both read the same "then-least-busy" agent's count and
  both land on them. This is a minor, self-correcting imbalance (the next
  ticket created will see the updated count) — not worth transactional
  locking for at this app's scale.
- **Any new frontend surface.** This is a backend-only change. The ticket
  list and detail views already display whatever the current assignee is,
  however it was set; no new UI is needed to see the result of
  auto-assignment.

## Architecture

No new data model, no new API routes, no new frontend surface. This is a
single new function plus one call site.

```
backend/src/
  services/  ~ tickets.service.ts (add pickAutoAssignee, call it from createTicket)
```

`pickAutoAssignee` lives in `tickets.service.ts` itself rather than a new
file — unlike SLA computation (a cross-cutting concern read by multiple
endpoints), this is a single, small piece of ticket-creation logic used by
exactly one function in the same file.

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

`createTicket` calls this once, after resolving `customerId` but before
`prisma.ticket.create`, and passes the result as the create call's
`assigneeId`:

```ts
const assigneeId = await pickAutoAssignee(data.departmentId ?? null);

const ticket = await prisma.ticket.create({
  data: {
    // ...existing fields...
    assigneeId,
  },
});
```

Tie-break is by user `id` (string comparison) — arbitrary but
deterministic, which matters for reproducible tests. It doesn't bias
long-run distribution: whichever tied agent is picked immediately stops
being tied (their count goes up by one), so the next creation's tie (if
any) resolves among different agents.

### Why no `TicketEvent`, no system-actor concept

`TicketEvent.authorId` is a required (non-nullable) foreign key to `User`.
Auto-assignment has no human actor to attribute the event to. Rather than
adding a nullable `authorId` or seeding a synthetic "System" user, this
spec follows the precedent already in `createTicket`: the ticket's
*initial* field values (`priority`, `categoryId`, `departmentId`) are never
event-logged — only *changes* to an existing ticket are, via
`updateTicketFields`/`assignTicket`/etc. Setting `assigneeId` inside the
same `prisma.ticket.create()` call is consistent with that: it's part of
the row's initial state, not a diffed change, so no event, no author, no
schema change.

## Testing

Same conventions as every prior sub-project (vitest + supertest against a
real test Postgres DB for backend; no frontend changes to test).

- `tickets.test.ts` additions:
  - A ticket created with a department that has one active agent is
    assigned to that agent.
  - A ticket created with a department that has multiple active agents is
    assigned to the one with the fewest OPEN+IN_PROGRESS tickets (seed an
    uneven distribution and assert the least-busy one wins).
  - A ticket created with a department that has zero active agents falls
    back to an org-wide active agent.
  - A ticket created with no department (`departmentId: null` or omitted)
    goes straight to the org-wide pool.
  - A ticket created when zero eligible agents exist anywhere (empty
    active-agent fixture) is created with `assigneeId: null` — no error.
  - An inactive agent (`isActive: false`) and a `SUPERVISOR`/`ADMIN` user
    are both excluded from the candidate pool even if otherwise a
    department/org match.
  - `POST /api/public/tickets` (web form) also triggers auto-assignment —
    at least one test exercising this path, not just the authenticated
    `POST /api/tickets` path.
  - Releasing/unassigning a ticket (`POST /api/tickets/:id/assign` with
    `assigneeId: null`) does NOT trigger a re-assignment — ticket stays
    unassigned afterward.
- **Existing-test ripple:** several current tests assert a freshly created
  ticket has `assignee: null`. Once this ships, that assertion only holds
  if the test's fixtures have no eligible active agent. The implementation
  plan must audit `tickets.test.ts`, `publicTickets.test.ts`, and any other
  test that creates a ticket and inspects `assigneeId`/`assignee`, and
  either adjust the fixture (no active `AGENT` user in scope) or update
  the assertion to match the new, intentional behavior. This is expected
  fallout, not a regression to avoid.

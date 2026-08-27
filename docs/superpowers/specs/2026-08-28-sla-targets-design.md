# AzmCRM — SLA & Automation: Targets + Visibility: Design Spec

**Date:** 2026-08-28
**Status:** Approved for planning
**Sub-project:** 6 of 12 (see [Roadmap](#roadmap) below) — depends on Ticket Management and Agent Dashboard (both merged to `master`)

## Context

The original product spec (`azm_squad_customer_support_crm.pdf`, section 5)
lists "SLA & Automation" as one feature area: response/resolution targets,
automatic assignment, escalation rules, and alerts/notifications. These are
four largely independent mechanisms, and the latter three all depend on the
first one existing — you cannot auto-escalate or alert on an SLA breach
without first defining what "breached" means. Bundling them into one spec
would produce something no single implementation plan could execute
cleanly, so this sub-project scopes only the foundational piece: defining
response/resolution time targets and making SLA status (on track vs.
breached) visible to staff. It builds nothing that automatically *acts* on
that status — no auto-assignment, no auto-escalation, no notifications.
Those are separate future sub-projects that read from what this one builds.

Ticket Management's spec explicitly deferred this: "Automated assignment or
escalation (round-robin, SLA timers, alert rules) — deferred to the SLA &
Automation sub-project. This phase only builds the manual actions those
automations will eventually trigger." This sub-project is the first slice
of that deferred work.

## Roadmap

1. Foundation — done, merged to master
2. Ticket Management — done, merged to master
3. Agent Dashboard — done, merged to master
4. Communication Channels: Web Forms — done, merged to master
5. Communication Channels: remaining (Email, Live Chat, SMS, WhatsApp) —
   each needs its own spec; WhatsApp specifically is blocked on an external
   WhatsApp Business API account this project doesn't have yet
6. **SLA & Automation: Targets + Visibility (this spec)** — response/
   resolution time targets, computed on-track/breached status, visibility
   on the ticket list, ticket detail, and dashboard
7. SLA & Automation: remaining (automatic assignment, escalation rules on
   breach, alerts/notifications) — separate future sub-projects that act on
   the SLA status this sub-project computes
8. Knowledge Base — FAQs/articles/search
9. Customer Portal — self-service ticket submission/tracking (including
   looking up a ticket by the reference code Web Forms introduced)
10. AI Features — summaries, suggested replies, categorization, chatbot
11. Reports & Management dashboards (needs this sub-project's SLA data and
    a future CSAT mechanism to be meaningful)
12. Integrations — ERP, external APIs

## Goals

- Let an Admin configure a response-time target and a resolution-time
  target (in minutes) for each of the four fixed ticket priorities
  (`LOW`/`MEDIUM`/`HIGH`/`URGENT`).
- Define "first response" as the timestamp of the first `NOTE_ADDED` event
  on a ticket — the closest existing analog to "someone actually responded"
  given no external reply channel (email/chat/WhatsApp) exists yet.
- Define "resolved" as the timestamp of the ticket's status transitioning
  to `RESOLVED` (via the existing `STATUS_CHANGED` event log) —
  `CLOSED` is a separate, later step not tracked by this SLA clock.
- Compute, for every ticket, a response status and a resolution status,
  each one of `PENDING` (on track, not yet due), `MET` (hit before its
  target), or `BREACHED` (missed — whether already resolved late, or still
  open and past due) — two states of outcome plus one state of "still
  ticking," not a three-tier urgency scale.
- The clock runs continuously from ticket creation (24/7 wall-clock) — no
  business-hours or holiday calendar, which doesn't exist anywhere in this
  app yet and is real, deferrable complexity.
- Surface this status in three places: a compact chip per row in the
  ticket list, a full response/resolution breakdown on the ticket detail
  page, and a new Supervisor/Admin dashboard widget listing currently
  breached tickets.

## Non-Goals / Explicitly Out of Scope

- **Automatic assignment.** Deferred to a later SLA & Automation
  sub-project. Manual assignment (Ticket Management, Agent Dashboard)
  is unchanged.
- **Automatic escalation on breach.** A breached ticket's `isEscalated`
  flag is NOT touched by this sub-project — escalation stays a manual
  staff action, exactly as Ticket Management built it. A future
  sub-project will read the SLA status this one computes and decide
  whether/how to auto-escalate.
- **Alerts, notifications, or any proactive push.** Nothing in this
  sub-project notifies anyone of anything — SLA status is visible only
  when someone is looking at the list, a ticket, or the dashboard.
- **An "at risk" third tier.** Considered and explicitly declined during
  brainstorming — two clear outcomes (`MET`/`BREACHED`) plus `PENDING`
  for "still ticking" was chosen over a tunable early-warning threshold.
- **Business-hours-aware SLA clocks.** The clock is continuous wall-clock
  time from `ticket.createdAt`. No per-department hours, holidays, or
  weekend-pause logic.
- **Per-department or per-category targets.** Targets are keyed only by
  `TicketPriority` (four fixed values) — not customizable per department
  or category in this phase.
- **Creating or deleting `SlaTarget` rows via the UI.** The four rows (one
  per `TicketPriority` enum value) are seeded and permanent; the admin
  page only edits the two minute fields on each, mirroring the fact that
  the underlying priority set is a fixed enum, not admin-managed data like
  `Department`/`TicketCategory`.

## Architecture

Extends the existing Foundation/Ticket Management/Agent Dashboard/Web
Forms layout. SLA computation is deliberately a separate service layered
on top of the existing ticket read paths, not folded into
`tickets.service.ts` — it's a cross-cutting concern (every ticket read
needs it) rather than a ticket-CRUD concern, and keeping it separate keeps
`tickets.service.ts` from absorbing an unrelated responsibility.

```
backend/src/
  routes/         + slaTargets.routes.ts
  controllers/    + slaTargets.controller.ts, ~ tickets.controller.ts (attach SLA status to list/get responses)
  services/       + sla.service.ts

frontend/src/
  api/            + slaTargets.ts, ~ tickets.ts (extend response types with `sla`)
  views/          + slaTargets/SlaTargetListView.vue, ~ tickets/TicketListView.vue, ~ tickets/TicketDetailView.vue
  components/dashboard/ + BreachedTicketsWidget.vue, ~ DashboardView.vue (add to Supervisor/Admin row)
```

## Data Model

Addition to `backend/prisma/schema.prisma`:

```prisma
model SlaTarget {
  priority          TicketPriority @id
  responseMinutes   Int
  resolutionMinutes Int
  updatedAt         DateTime       @updatedAt
}
```

`priority` is the primary key directly (not a separate `id` + unique
constraint) — there are exactly four possible values, one row each,
enforced by the type system rather than convention. No relation to
`Ticket`; SLA status is computed on read, not stored per-ticket.

`backend/prisma/seed.ts` gains an unconditional step — NOT inside the
existing `if (existing) { return; }` early-return for the admin user —
that upserts default rows for all four priorities if missing:

```ts
const defaultSlaTargets: Record<string, { responseMinutes: number; resolutionMinutes: number }> = {
  URGENT: { responseMinutes: 15, resolutionMinutes: 120 },
  HIGH: { responseMinutes: 60, resolutionMinutes: 480 },
  MEDIUM: { responseMinutes: 240, resolutionMinutes: 1440 },
  LOW: { responseMinutes: 480, resolutionMinutes: 4320 },
};
```

These defaults are starting points, not a business requirement — an Admin
can change them immediately after seeding via the new admin page.

## Backend API

### `GET /api/sla-targets` — any authenticated staff

Returns all four rows (`{ priority, responseMinutes, resolutionMinutes,
updatedAt }[]`) — needed by any staff member's ticket list/detail view to
compute/display SLA status, not just Admins.

### `PATCH /api/sla-targets/:priority` — `ADMIN`-only

- `:priority` is validated against the `TicketPriority` enum (400 if not
  one of the four values, matching this codebase's existing
  `z.enum([...])` pattern).
- Body: `{ responseMinutes?: number; resolutionMinutes?: number }`, both
  positive integers when present.
- No create/delete routes — the four rows always exist (seeded), so only
  `PATCH` is meaningful.

### SLA status computation (`backend/src/services/sla.service.ts`)

```ts
export interface SlaStatus {
  response: { dueAt: string; respondedAt: string | null; status: 'PENDING' | 'MET' | 'BREACHED' };
  resolution: { dueAt: string; resolvedAt: string | null; status: 'PENDING' | 'MET' | 'BREACHED' };
}

export async function attachSlaStatus<T extends { id: string; createdAt: Date; priority: TicketPriority; status: TicketStatus }>(
  tickets: T[]
): Promise<(T & { sla: SlaStatus })[]>
```

Implementation batches exactly two queries regardless of how many tickets
are passed in (avoiding N+1 on the ticket list endpoint):

```ts
const firstResponses = await prisma.ticketEvent.groupBy({
  by: ['ticketId'],
  where: { ticketId: { in: ticketIds }, type: 'NOTE_ADDED' },
  _min: { createdAt: true },
});
const resolutions = await prisma.ticketEvent.groupBy({
  by: ['ticketId'],
  where: { ticketId: { in: ticketIds }, type: 'STATUS_CHANGED', newValue: 'RESOLVED' },
  _min: { createdAt: true },
});
```

Both are merged into `Map<ticketId, Date>` for O(1) lookup while building
each ticket's `sla` object. `dueAt` = `ticket.createdAt` +
`target.{response,resolution}Minutes`. Status logic per clock (`respondedAt`/`resolvedAt` from the maps above, `now = new Date()`):

- `respondedAt`/`resolvedAt` exists and is `<= dueAt` → `MET`
- `respondedAt`/`resolvedAt` exists and is `> dueAt` → `BREACHED` (met, but late)
- no timestamp yet and `now > dueAt` → `BREACHED` (still open, overdue)
- no timestamp yet and `now <= dueAt` → `PENDING`

`tickets.controller.ts`'s `listTicketsHandler` and `getTicketHandler` call
`attachSlaStatus` on their result before responding — `tickets.service.ts`
itself is unmodified. If `SlaTarget` rows are somehow missing for a given
priority (shouldn't happen post-seed, but defensively), that ticket's `sla`
is omitted rather than the request failing — a formatting issue in
optional display data shouldn't 500 the ticket list.

## Frontend

### `SlaTargetListView.vue` — new `ADMIN`-only route/nav item

A table of the four priorities with an edit dialog per row (matching the
`TicketCategoryListView.vue`/`QuickReplyListView.vue` dialog pattern
exactly — this codebase has no inline-editable-table precedent, so the
dialog is the established choice, not a new one) for
`responseMinutes`/`resolutionMinutes` — no create button, no delete
action, since the row set is fixed.

### `TicketListView.vue` — SLA chip per row

One compact chip summarizing the worse of the two clocks: `BREACHED` (red)
if either is breached, else the sooner-due `PENDING` clock's remaining time
(e.g. "12m left"), else `MET` (or no chip) if both are met. Computed
client-side from the `sla` object the list endpoint now returns — no new
API calls.

### `TicketDetailView.vue` — full breakdown

Two separate rows: response target/due/status, resolution target/due/
status — not collapsed into one chip, since a staff member looking at one
ticket wants the detail the list's compact view intentionally omits.

### `BreachedTicketsWidget.vue` — new Supervisor/Admin dashboard widget

Added to `DashboardView.vue`'s existing Supervisor/Admin-only row
(alongside `UnassignedQueueWidget`/`EscalatedTicketsWidget`/
`TeamWorkloadWidget`), listing tickets where either `sla.response.status`
or `sla.resolution.status` is `BREACHED`. Fetches via the existing
`GET /api/tickets` (already returns `sla` per the backend change above) and
filters client-side — no new backend endpoint needed for this widget,
matching the precedent `TeamWorkloadWidget` already set for client-side
aggregation at this app's current scale.

## Error Handling

No new error shapes — `{ error: { code, message } }` throughout, via the
existing `HttpError`/`errorHandler`. `PATCH /api/sla-targets/:priority`
with an invalid priority segment or non-positive minute value returns `400
VALIDATION_ERROR` via the existing `validate` middleware pattern.

## Testing

Same conventions as every prior sub-project.

- **Backend** (vitest + supertest, real test Postgres DB):
  - `slaTargets.test.ts` — `GET` returns all four seeded rows; `PATCH`
    updates one row (`ADMIN`-only, `403` for non-admin); `400` for an
    invalid priority or a non-positive minute value.
  - `sla.service.test.ts` (or folded into `tickets.test.ts` — the
    implementer's call based on how it reads best) — `attachSlaStatus`
    correctness across the four state combinations (`PENDING`/`MET`/
    `BREACHED` for response and resolution independently), and that it
    batches (not N+1s) across multiple tickets.
  - `tickets.test.ts` additions — `GET /api/tickets` and
    `GET /api/tickets/:id` responses include a correctly-shaped `sla`
    object.
- **Frontend** (vitest + `@vue/test-utils` via `mountWithPlugins`):
  - `SlaTargetListView.test.ts` — renders the four seeded rows, edit flow
    updates one via the mocked API.
  - `TicketListView`/`TicketDetailView` — SLA chip/breakdown rendering
    across `PENDING`/`MET`/`BREACHED` fixtures.
  - `DashboardView.test.ts` addition — `BreachedTicketsWidget` renders
    only breached tickets, only for Supervisor/Admin roles (matching the
    existing role-gating test pattern for the other Supervisor/Admin
    widgets in that file).

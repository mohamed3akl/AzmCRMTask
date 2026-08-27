# AzmCRM — Agent Dashboard: Design Spec

**Date:** 2026-08-27
**Status:** Approved for planning
**Sub-project:** 3 of 10 (see [Roadmap](#roadmap) below) — depends on Ticket Management (merged to `master`)

## Context

Since Foundation and Ticket Management landed, the app's landing page
(`/home`) is a placeholder welcome message, and there is no personalized
"my work" view anywhere — every user has to go to the full ticket list and
filter manually to find what's relevant to them. The original product spec
(`azm_squad_customer_support_crm.pdf`, section 4) calls for an Agent
Dashboard with: assigned tickets, customer information, tasks and
reminders, quick replies, and team collaboration.

This sub-project builds that dashboard as the new role-adaptive landing
page, plus two small pieces of net-new domain: personal tasks (with an
optional link to a ticket) and admin-managed quick-reply snippets usable
when adding a note to a ticket.

## Roadmap

1. Foundation — done, merged to master
2. Ticket Management — done, merged to master
3. **Agent Dashboard (this spec)** — role-adaptive landing page, personal
   tasks, quick replies, team activity feed
4. Communication Channels — email/WhatsApp/SMS/live chat/web forms intake
5. SLA & Automation — targets, *automated* assignment/escalation, alerts
6. Knowledge Base — FAQs/articles/search
7. Customer Portal — self-service ticket submission/tracking
8. AI Features — summaries, suggested replies, categorization, chatbot
9. Reports & Management dashboards
10. Integrations — ERP, external APIs

## Goals

- Replace the placeholder `/home` with a role-adaptive dashboard: every
  authenticated user sees a personalized view built from data that already
  exists (tickets) plus two new pieces of domain (tasks, team activity).
- Give every user a personal task list — a lightweight to-do, optionally
  linked to a ticket, that only its owner can see or modify.
- Give Supervisors/Admins team-wide operational widgets on the same page:
  the unassigned queue, escalated tickets, and per-agent open-ticket
  workload — so they can rebalance work without leaving the dashboard.
- Give everyone a read-only feed of recent team-wide ticket activity
  (assignments, status/priority changes, escalations), reusing the
  existing `TicketEvent` data.
- Let staff insert admin-managed canned text ("quick replies") into a
  ticket's note field instead of retyping common responses.

## Non-Goals / Explicitly Out of Scope

- **A standalone full task-management page.** Tasks are surfaced only as a
  dashboard widget (list + quick-add + mark done) in this phase. A
  full task list/filter/search page is a future iteration if needed.
- **Notifications, reminders that actually alert (push/email/etc.), or
  @mentions.** A task's `dueAt` is informational only in this phase — it
  is not linked to Section 5's Alerts and Notifications, which is a
  separate later sub-project.
- **Customer-facing quick replies or any external channel.** Quick replies
  in this phase are inserted into the internal note field on a ticket the
  same way an agent types one manually; there is no email/chat channel
  for them to be sent through yet (that's Communication Channels).
- **Department/role-scoped ticket visibility.** Unchanged from Ticket
  Management — every authenticated staff member can still see every
  ticket; the dashboard's "My Tickets" widget is a *filtered view* of that
  same data, not a new visibility restriction.
- **Real-time/live updates.** Widgets load on mount and on manual refresh
  (e.g. after completing an action); no polling or websockets.

## Architecture

Extends the existing Foundation/Ticket Management layout — no new
top-level structure.

```
backend/src/
  routes/         + tasks.routes.ts, quickReplies.routes.ts
  controllers/    + tasks.controller.ts, quickReplies.controller.ts
  services/       + tasks.service.ts, quickReplies.service.ts
                  ~ tickets.service.ts (extend listTickets filters; add listRecentTicketEvents)
                  ~ tickets.controller.ts, tickets.routes.ts (extend filters; new recent-events route)

frontend/src/
  api/            + tasks.ts, quickReplies.ts
                  ~ tickets.ts (extend filter params; add fetchRecentTicketEvents)
  views/          ~ HomeView.vue -> DashboardView.vue (replaces placeholder; same route)
  views/quickReplies/ + QuickReplyListView.vue
  components/dashboard/ + MyTicketsWidget.vue, MyTasksWidget.vue,
                           TeamActivityWidget.vue, UnassignedQueueWidget.vue,
                           EscalatedTicketsWidget.vue, TeamWorkloadWidget.vue
```

## Data Model

Additions to `backend/prisma/schema.prisma`:

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

`User` gets a reverse relation `tasks Task[]`; `Ticket` gets a reverse
relation `tasks Task[]`. Neither relation is required (`ticketId` is
nullable) — a task does not need a ticket, and deleting a ticket is out of
scope in this phase so no cascade behavior needs to be decided.

`QuickReply` has no relations — it is a flat, admin-managed lookup table
whose text is copied into a ticket's note at insertion time (like copy-
pasting), not referenced by id from `TicketEvent`. This keeps a
`QuickReply` edit/delete from ever rewriting or breaking historical notes.

## Backend API

### Tasks — any authenticated user, scoped to their own tasks only

- `GET /api/tasks?done=&ticketId=` — lists the caller's own tasks
  (`ownerId = req.user.id`, not a query param — a user cannot list anyone
  else's tasks). Optional `done` (`true`/`false`) and `ticketId` filters.
- `POST /api/tasks` — body `{ title, dueAt?, ticketId? }`; `ownerId` is
  always set from `req.user.id`, never accepted from the client.
- `PATCH /api/tasks/:id` — body `{ title?, dueAt?, ticketId?, isDone? }`.
  If the task's `ownerId` does not match `req.user.id`, respond `404
  NOT_FOUND` (not `403`) — consistent with the rest of the API not
  revealing whether a resource exists to a caller who has no access to
  it, and because a user can never see another user's task id in the
  first place (list is always self-scoped).
- `DELETE /api/tasks/:id` — same ownership rule as `PATCH`, `204` on
  success.

### Quick Replies — read for any staff, write for `ADMIN` only

- `GET /api/quick-replies` — any authenticated user.
- `POST /api/quick-replies`, `PATCH /api/quick-replies/:id` —
  `authorize('ADMIN')`, identical shape/validation pattern to
  `/api/ticket-categories` (`nameEn`/`nameAr` → `titleEn`/`titleAr` +
  `bodyEn`/`bodyAr`).

### Ticket list filter extensions (modify, not new endpoint)

`GET /api/tickets` gains two boolean query params, added to the existing
`listTickets` filter object in `tickets.service.ts`:

- `unassigned=true` → `assigneeId: null`
- `escalated=true` → `isEscalated: true`

Both compose with the existing `status`/`assigneeId`/`departmentId`/
`categoryId` filters (e.g. the dashboard's "My Tickets" widget calls
`GET /api/tickets?assigneeId=<selfId>`, reusing the filter that already
exists — no backend change needed for that widget).

### Team activity feed (new read endpoint)

- `GET /api/ticket-events/recent?limit=20` — any authenticated staff.
  Returns the `limit` most recent `TicketEvent` rows across *all* tickets,
  each including `type`, `oldValue`/`newValue`, `note`, `createdAt`,
  `author { id, fullName }`, and `ticket { id, subject }`. Implemented as
  `listRecentTicketEvents(limit)` in `tickets.service.ts` (it operates on
  `prisma.ticketEvent`, but lives alongside the other ticket-domain
  functions rather than as a new service file, since it has no
  create/update surface of its own). `limit` defaults to 20, capped at 50.

### Team workload (no new endpoint)

Computed client-side: the frontend calls the existing
`GET /api/tickets?status=OPEN` (and `IN_PROGRESS`) and groups the results
by `assignee.fullName` in the browser. At AzmCRM's current scale (a single
department's worth of staff) this avoids a bespoke aggregation endpoint;
if ticket volume grows enough to make this expensive, a
`GET /api/tickets/workload` endpoint can be added later without touching
any other part of this design.

## Frontend

### `DashboardView.vue` (replaces `HomeView.vue` at the existing `/home` route)

Role-adaptive composition of widgets, each an independent component that
fetches its own data on mount:

- **All roles:**
  - `MyTicketsWidget` — calls `fetchTickets({ assigneeId: currentUser.id })`,
    filters out `CLOSED` client-side, shows subject/customer/status/
    priority, links into `TicketDetailView`.
  - `MyTasksWidget` — calls `fetchTasks({ done: false })`; inline quick-add
    (title + optional due date + optional ticket picker reusing the
    customer/ticket lookup pattern already used in `TicketCreateView`);
    checkbox toggles `isDone` via `PATCH`.
  - `TeamActivityWidget` — calls `fetchRecentTicketEvents()`, renders each
    event as one line (`"{author} {verb} {ticket subject}"`), reusing the
    existing `eventLabel`-style formatting already written for
    `TicketDetailView`'s timeline.
- **`SUPERVISOR`/`ADMIN` only, additionally:**
  - `UnassignedQueueWidget` — `fetchTickets({ unassigned: true })`.
  - `EscalatedTicketsWidget` — `fetchTickets({ escalated: true })`.
  - `TeamWorkloadWidget` — fetches open+in-progress tickets, groups by
    assignee client-side as described above; unassigned tickets shown
    under an explicit "Unassigned" bucket.

Layout: a responsive Vuetify grid (`v-row`/`v-col`), each widget in its
own `v-card`, matching the existing look established in
`TicketListView`/`AppShell`. No new design-system decisions.

### Quick replies

- `TicketDetailView.vue` gains a "insert quick reply" `v-select` next to
  the existing note `v-textarea` (from Ticket Management's Task 7/12
  work): selecting one appends its locale-appropriate body
  (`bodyEn`/`bodyAr` based on the current `i18n.locale`) to the note
  textarea's current value; it does not submit the note automatically.
- `QuickReplyListView.vue` — new `ADMIN`-only admin page, structurally
  identical to `TicketCategoryListView.vue` (list + create/edit dialog),
  added to `AppShell`'s nav and `router/index.ts` guarded the same way
  Users/Departments already are.

### Locale keys

New keys added to both `frontend/src/locales/en.json` and `ar.json` under
new `dashboard`, `tasks`, and `quickReplies` namespaces, following the
existing nested-JSON structure.

## Error Handling

No new error shapes — everything continues to use the existing
`{ error: { code, message } }` convention via `HttpError` and the shared
`errorHandler`. Task ownership violations surface as `404 NOT_FOUND`
(see above); quick-reply admin-only writes reuse `authorize('ADMIN')`
exactly like `ticketCategories`/`departments`.

## Testing

Same conventions as Foundation/Ticket Management — no new tooling.

- **Backend** (vitest + supertest, real test Postgres DB):
  - `tasks.test.ts` — CRUD, `done`/`ticketId` filters, and ownership
    (a second user's task is invisible to and unmodifiable/undeletable by
    the caller).
  - `quickReplies.test.ts` — CRUD, `ADMIN`-only write gating, non-admin
    read access.
  - `tickets.test.ts` additions — `unassigned=true` and `escalated=true`
    filters, composed with an existing filter (e.g. `status`).
  - `ticketEvents.test.ts` (or appended to `tickets.test.ts`) — recent
    events endpoint returns events across multiple tickets in
    descending `createdAt` order, respects `limit`.
- **Frontend** (vitest + `@vue/test-utils` via `mountWithPlugins`):
  - `DashboardView.test.ts` — renders agent-only widgets for an `AGENT`
    session and the additional supervisor/admin widgets for a
    `SUPERVISOR`/`ADMIN` session.
  - A task widget test — quick-add, mark-done round trip against a mocked
    `api/tasks` module.
  - A quick-reply insertion test on `TicketDetailView` — selecting a quick
    reply appends its body to the note field.
  - `QuickReplyListView.test.ts` — create/edit flow, mirroring
    `TicketCategoryListView.test.ts`.

# AzmCRM — Ticket Management: Design Spec

**Date:** 2026-08-27
**Status:** Approved for planning
**Sub-project:** 2 of 10 (see [Roadmap](#roadmap) below) — depends on Foundation (merged to `master`)

## Context

Ticket Management is the core ticketing engine for AzmCRM: staff can log a
support ticket for a customer, track it through a status workflow, assign
it to an agent, and see a full chronological history of what happened to
it. This sub-project also introduces a minimal `Customer` entity, since a
ticket cannot exist without something to attach to and Foundation only
modeled internal staff (`User`) and `Department`.

**Roadmap correction:** the Foundation spec's roadmap never gave "Customer
Management" its own slot, but the original product spec
(`azm_squad_customer_support_crm.pdf`) lists it as a distinct feature area
(profiles, contact details, interaction history, notes/attachments). This
sub-project deliberately builds only the minimal slice of that — a bare
customer record (name/email/phone) — just enough for tickets to reference.
The richer customer-management features (interaction history, notes,
attachments, a dedicated management UI, deduplication) remain unbuilt and
should get their own sub-project later if/when the product needs them.

## Roadmap

1. Foundation — **done, merged to master**
2. **Ticket Management (this spec)** — core ticketing engine, minimal
   Customer entity
3. Agent Dashboard — the agent's daily workspace (assigned tickets,
   personalized/filtered views built on top of this sub-project's APIs)
4. Communication Channels — email/WhatsApp/SMS/live chat/web forms intake
5. SLA & Automation — targets, *automated* assignment/escalation, alerts
   (this sub-project only builds *manual* escalation and assignment)
6. Knowledge Base — FAQs/articles/search
7. Customer Portal — self-service ticket submission/tracking
8. AI Features — summaries, suggested replies, categorization, chatbot
9. Reports & Management dashboards
10. Integrations — ERP, external APIs

## Goals

- Introduce a minimal `Customer` entity so tickets have something to
  belong to.
- Let any authenticated staff member (Agent/Supervisor/Admin) create a
  ticket on behalf of a customer (picking an existing one or creating one
  inline), and list/view all tickets.
- Model a ticket workflow: status (Open/In Progress/Resolved/Closed),
  priority (fixed enum), category (Admin-managed, like Department),
  optional department, optional assignee.
- Support manual assignment: Supervisor/Admin can assign any ticket to any
  agent; an Agent can only claim/release their own assignment.
- Support a manual escalation flag (no automated SLA timers — that's a
  later sub-project).
- Give every ticket a single chronological history/timeline combining
  automatic field-change events and manually-added agent notes.

## Non-Goals / Explicitly Out of Scope

- **Full Customer Management** — interaction history, notes/attachments on
  the *customer* (as opposed to the ticket), a dedicated customer list/
  management UI, deduplication. Only a bare `Customer` record exists.
- **Automated assignment or escalation** (round-robin, SLA timers, alert
  rules) — deferred to the SLA & Automation sub-project. This phase only
  builds the manual actions those automations will eventually trigger.
- **Personalized/filtered ticket views** ("my tickets", department-scoped
  visibility) — deferred to the Agent Dashboard sub-project. Every
  authenticated staff member sees every ticket in this phase.
- **Any external channel intake** (email, WhatsApp, chat, web forms,
  customer portal) — deferred to Communication Channels / Customer Portal.
  The only ticket-creation path in this phase is a staff member manually
  logging one.
- **Editing a ticket's subject/description after creation** — not
  requested; if corrections are needed later, that's a small follow-up.

## Architecture

Extends the existing Foundation layout — no new top-level structure.

```
backend/src/
  routes/         + tickets.routes.ts, ticketCategories.routes.ts, customers.routes.ts
  controllers/    + tickets.controller.ts, ticketCategories.controller.ts, customers.controller.ts
  services/       + tickets.service.ts, ticketCategories.service.ts, customers.service.ts

frontend/src/
  api/            + tickets.ts, ticketCategories.ts, customers.ts
  views/tickets/  + TicketListView.vue, TicketCreateView.vue, TicketDetailView.vue
  views/ticketCategories/ + TicketCategoryListView.vue
```

## Data Model

Additions to `backend/prisma/schema.prisma`:

```prisma
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
  ASSIGNEE_CHANGED
  ESCALATED
  UNESCALATED
  NOTE_ADDED
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
  id           String          @id @default(uuid())
  subject      String
  description  String
  status       TicketStatus    @default(OPEN)
  priority     TicketPriority  @default(MEDIUM)
  isEscalated  Boolean         @default(false)

  customer     Customer        @relation(fields: [customerId], references: [id])
  customerId   String

  category     TicketCategory? @relation(fields: [categoryId], references: [id])
  categoryId   String?

  department   Department?     @relation(fields: [departmentId], references: [id])
  departmentId String?

  assignee     User?           @relation("TicketAssignee", fields: [assigneeId], references: [id])
  assigneeId   String?

  createdBy    User            @relation("TicketCreatedBy", fields: [createdById], references: [id])
  createdById  String

  events       TicketEvent[]

  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt
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

Two named relations are required on `User` (`Ticket.assignee` and
`Ticket.createdBy` both point at `User`, which Prisma can't disambiguate
without explicit relation names) — add the reverse relation fields to the
existing `User` model:

```prisma
model User {
  // ...existing fields...
  assignedTickets Ticket[]      @relation("TicketAssignee")
  createdTickets  Ticket[]      @relation("TicketCreatedBy")
  ticketEvents    TicketEvent[]
}
```

And add the reverse relation field to `Department`:

```prisma
model Department {
  // ...existing fields...
  tickets Ticket[]
}
```

## Permissions

- **Tickets** — `authenticate` only (any role) for list/view/create/update
  status-priority-category-department/escalate/unescalate/add-note.
- **Assignment** (`POST /api/tickets/:id/assign`) — `authenticate` only,
  but the *service* enforces a role rule: `ADMIN`/`SUPERVISOR` may set
  `assigneeId` to any user id or `null`; `AGENT` may only set it to their
  own id (claim) or to `null` when it's currently their own id (release) —
  attempting anything else returns `403 FORBIDDEN`.
- **Customers** — `authenticate` only (any role) for search/create. No
  update/delete endpoints exist in this phase.
- **Ticket Categories** — `authenticate` + `authorize('ADMIN')`, identical
  to Department's existing pattern.

## Backend Endpoints

- `GET /api/customers?query=<string>` — search by name/email/phone
  (case-insensitive partial match on any field), returns up to 20 results.
- `POST /api/customers` — create `{ fullName, email?, phone? }`.
- `GET /api/ticket-categories`, `POST /api/ticket-categories`,
  `PATCH /api/ticket-categories/:id` — identical shape to Department's
  existing endpoints.
- `GET /api/tickets?status=&assigneeId=&departmentId=&categoryId=` — list,
  all filters optional, applied as an `AND` in the Prisma `where` clause.
- `POST /api/tickets` — create `{ subject, description, customerId?,
  newCustomer?: { fullName, email?, phone? }, categoryId?, departmentId?,
  priority? }`. Exactly one of `customerId`/`newCustomer` must be present
  (validated by a zod `.refine`); if `newCustomer` is given, the service
  creates the `Customer` row first in the same operation. `createdById` is
  set from the authenticated user. Writes no `TicketEvent` on creation
  (the ticket's own `createdAt`/`createdBy` already record that).
- `GET /api/tickets/:id` — ticket detail, including `events` ordered by
  `createdAt` ascending, each with its `author`'s `fullName` included.
- `PATCH /api/tickets/:id` — body `{ status?, priority?, categoryId?,
  departmentId? }`. The service loads the current row, and for each field
  present in the body that differs from the current value: applies the
  update and writes one `TicketEvent` (`STATUS_CHANGED` /
  `PRIORITY_CHANGED` / `CATEGORY_CHANGED`, `oldValue`/`newValue` as the
  enum string or category id) in the same Prisma transaction. A field
  present in the body but equal to the current value is a no-op (no event
  written).
- `POST /api/tickets/:id/assign` — body `{ assigneeId: string | null }`.
  Applies the role rule above, updates `assigneeId`, writes one
  `ASSIGNEE_CHANGED` event (`oldValue`/`newValue` are the old/new
  assignee's id, or `null`).
- `POST /api/tickets/:id/escalate` — body `{ note?: string }`. Sets
  `isEscalated = true`, writes an `ESCALATED` event with the note.
  `400` if already escalated.
- `POST /api/tickets/:id/unescalate` — sets `isEscalated = false`, writes
  an `UNESCALATED` event. `400` if not currently escalated.
- `POST /api/tickets/:id/notes` — body `{ note: string }` (required,
  non-empty). Writes a `NOTE_ADDED` event with no field change.

All mutating endpoints return the updated `Ticket` (with `events`
re-fetched) so the frontend can refresh from a single response.

## Frontend Structure

- New `AppShell.vue` nav items: **Tickets** (visible to all authenticated
  roles) and **Ticket Categories** (Admin-only, alongside the existing
  Users/Departments links).
- `frontend/src/views/tickets/TicketListView.vue` — `v-data-table` of all
  tickets (subject, customer name, status, priority, assignee, escalated
  flag), a status filter dropdown, a "New Ticket" button, row click
  navigates to the detail view.
- `frontend/src/views/tickets/TicketCreateView.vue` — a dedicated page
  (not a dialog, given the field count): a customer search box
  (autocomplete against `GET /api/customers?query=`) with a "create new
  customer" toggle revealing inline `fullName`/`email`/`phone` fields;
  subject, description, category select, department select, priority
  select. Submits to `POST /api/tickets`, navigates to the new ticket's
  detail view on success.
- `frontend/src/views/tickets/TicketDetailView.vue` — displays all ticket
  fields; status/priority/category/department are `v-select`s that call
  `PATCH /api/tickets/:id` on change; an assign control (a user `v-select`
  for Supervisor/Admin, or a "Claim"/"Release" button for an Agent viewing
  an unassigned/self-assigned ticket); an Escalate/Unescalate button
  (Escalate opens a small dialog for an optional note); a chronological
  event timeline (icon + human-readable line per `TicketEvent`, e.g.
  "Priority changed from Medium to High — Jane Doe, 2026-08-27 14:02");
  an "Add note" text field + submit button.
- `frontend/src/views/ticketCategories/TicketCategoryListView.vue` —
  structurally identical to the existing `DepartmentListView.vue`.

## Error Handling

Unchanged from Foundation: `HttpError` → `errorHandler` →
`{ error: { code, message } }`. New codes: `CUSTOMER_REQUIRED` (400, ticket
creation missing both `customerId` and `newCustomer`), `ALREADY_ESCALATED`
/ `NOT_ESCALATED` (400), `INVALID_ASSIGNEE` (403, an Agent attempting to
assign/reassign someone other than themselves).

**Known environment note (carried forward from Foundation):** the
installed `zod` is v4, where `ZodError.errors` doesn't exist — use
`result.error.issues` in `validate.ts`-consuming code, exactly as
Foundation's `validate.ts` already does. No change needed to `validate.ts`
itself; this is a reminder for any new zod schema code in this phase.

## Testing Strategy

Unchanged from Foundation: backend integration tests against the real
`azmcrm_test` Postgres database (no mocks) covering each service/route,
including the assignment role rule (Agent self-assign succeeds, Agent
assigning another agent gets 403) and the event-writing behavior (a status
PATCH produces exactly one `STATUS_CHANGED` event with correct old/new
values). Frontend component tests with only the `api/*` layer mocked,
covering list rendering, ticket creation (including the inline-customer
path), and the detail view's field-change/assign/escalate/note actions.

## Open Questions

None outstanding — all decisions above were confirmed during
brainstorming.

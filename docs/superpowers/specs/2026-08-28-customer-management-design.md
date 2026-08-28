# AzmCRM — Customer Management: Design Spec

**Date:** 2026-08-28
**Status:** Approved for planning
**Sub-project:** new addition to the roadmap (staff-facing; not previously scheduled) — depends on Ticket Management (merged to `master`)

## Context

`Customer` has existed as a data model since Foundation/Ticket Management,
but only as a passenger on the ticket workflow: a `fullName`/`email`/`phone`
row created inline whenever a ticket names a `newCustomer`, and searchable
only via `GET /api/customers?query=` — an endpoint that exists solely to
power the autocomplete in `TicketCreateView.vue`. There is no dedicated
Customers page, no way to view one customer's full ticket history as its
own screen, no way to fix a typo'd email or phone, and no way to create a
customer record before any ticket exists for them. Every `newCustomer`
submission — manual or web-form — also unconditionally creates a fresh
row, even when the email or phone already matches someone in the system,
so duplicates accumulate silently.

This sub-project makes `Customer` a first-class, staff-facing directory
entity: browse, search, view a profile with ticket history, create, and
edit — plus closing the duplicate-creation gap now that customers are
something staff will actually look at directly. It is distinct from the
roadmap's future **Customer Portal** sub-project (self-service ticket
submission/tracking *for customers themselves*, using the reference code
Web Forms introduced) — this sub-project is purely internal tooling for
staff.

## Goals

- A searchable Customers directory, reachable from the main nav by any
  authenticated staff member (Agent/Supervisor/Admin) — not admin-gated,
  unlike every existing management page (Users/Departments/Categories/
  QuickReplies/SlaTargets), because agents need this daily, the same way
  they need the ticket list.
- A customer detail/profile page showing the customer's info and every
  ticket they've filed, newest first.
- Direct customer creation (`POST /api/customers`), independent of ticket
  creation — for proactively logging a customer before their first ticket
  exists (e.g. a phone call).
- Editing a customer's `fullName`/`email`/`phone` (`PATCH /api/customers/:id`).
- Deduplication: when a ticket's `newCustomer` email or phone exactly
  matches an existing customer, reuse that customer instead of creating a
  duplicate — silently, since ticket creation is not a deliberate
  "manage a customer" action. Direct create/edit get the same match check,
  but surfaced as an explicit `409` conflict instead, since those *are*
  deliberate actions and the staff member deserves to know rather than
  being silently redirected to someone else's record.
- Linking the customer name already shown in `TicketListView`/
  `TicketDetailView` to the new profile page — the natural way staff will
  actually reach it from a ticket they're working.

## Non-Goals / Explicitly Out of Scope

- **New `Customer` fields.** No address, company, tags, notes, or any
  other new field — this sub-project builds directory/profile/CRUD around
  the three fields that already exist (`fullName`, `email`, `phone`).
- **Deleting or merging customers.** No delete route (matches the
  no-delete precedent already set by `Department`/`TicketCategory`), and
  no tooling to merge two customer records that turn out to be duplicates
  from before this sub-project's dedup check existed. A future sub-project
  can address historical duplicates if it becomes a real problem; this one
  only stops *new* ones.
- **Fuzzy or near-match deduplication.** The dedup check is an exact match
  (case-insensitive on email) on a single field — no Levenshtein distance,
  no "did you mean," no phone-format normalization beyond trimming
  whitespace. A false negative (two records for the same person with
  slightly different-looking contact info) is an accepted gap; a false
  positive (wrongly merging two different people) would be worse and is
  what the exact-match rule protects against.
- **Customer-initiated anything.** No self-service, no customer login, no
  customer-facing view of this data — see the Customer Portal sub-project
  in the roadmap for that, separately.
- **Role restrictions on customer edit/create.** Per explicit decision:
  any authenticated staff member can view, create, and edit — no
  Supervisor/Admin-only gate, unlike every other management page in this
  app.

## Architecture

Extends the existing `customers.routes.ts` / `.controller.ts` /
`.service.ts` trio (currently just `searchCustomers`) rather than
introducing a new module — this is the same entity, just more operations
on it.

```
backend/src/
  routes/         ~ customers.routes.ts (+ GET /:id, POST /, PATCH /:id)
  controllers/    ~ customers.controller.ts (+ 3 handlers)
  services/       ~ customers.service.ts (+ getCustomerById, createCustomer,
                                            updateCustomer, findExistingCustomerByContact)
                  ~ tickets.service.ts (createTicket's newCustomer path calls
                                          findExistingCustomerByContact first)
                  ~ tickets.service.ts (listTickets gains a customerId filter)

frontend/src/
  api/            + customers.ts, ~ tickets.ts (fetchTickets gains customerId param)
  views/          + customers/CustomerListView.vue, + customers/CustomerDetailView.vue,
                  ~ tickets/TicketListView.vue, ~ tickets/TicketDetailView.vue
                    (customer name becomes a router-link)
  layouts/        ~ AppShell.vue (new nav item, visible to all staff)
  router/         ~ index.ts (customers, customers/:id routes)
```

## Data Model

No schema changes. `Customer` (`backend/prisma/schema.prisma`) already has
everything this sub-project needs:

```prisma
model Customer {
  id        String   @id @default(uuid())
  fullName  String
  email     String?
  phone     String?
  tickets   Ticket[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## Backend API

### `GET /api/customers?query=` — any authenticated staff (unchanged)

Existing endpoint, untouched.

### `GET /api/customers/:id` — any authenticated staff (new)

Returns the customer row plus their tickets (id, subject, status,
priority, createdAt), newest first — same shape `listTickets` already
returns per ticket, reused rather than redefined:

```ts
export async function getCustomerById(id: string): Promise<Customer & { tickets: TicketSummary[] }>
```

`404 NOT_FOUND` if the customer doesn't exist, matching the existing
`getTicketById` pattern in `tickets.service.ts`.

### `POST /api/customers` — any authenticated staff (new)

Body: `{ fullName: string; email?: string; phone?: string }` (same shape
as `newCustomerSchema`, reused). Runs `findExistingCustomerByContact`
first; on a match, responds `409 CUSTOMER_EXISTS` with
`{ error: { code: 'CUSTOMER_EXISTS', message: '...' }, existingCustomerId: string }`
— the frontend uses `existingCustomerId` to offer a direct link. No match
→ creates and returns the new customer, `201`.

### `PATCH /api/customers/:id` — any authenticated staff (new)

Body: `{ fullName?: string; email?: string; phone?: string }`, all
optional (partial update, matching `SlaTarget`'s `PATCH` pattern). Runs
the same dedup check, excluding the customer being edited from the match
set (so re-saving a customer's own unchanged email/phone never
false-positives against itself). Match → `409 CUSTOMER_EXISTS` same shape
as above. No match → updates and returns, `200`. `404 NOT_FOUND` if the
id doesn't exist.

### `findExistingCustomerByContact` (`customers.service.ts`, new, not exported as a route)

```ts
export async function findExistingCustomerByContact(
  contact: { email?: string; phone?: string },
  excludeId?: string
): Promise<Customer | null>
```

Matches if `email` (trimmed, case-insensitive exact) equals an existing
customer's `email`, **or** `phone` (trimmed, exact) equals an existing
customer's `phone`. If neither `email` nor `phone` is provided, returns
`null` immediately — nothing to match on (this is the existing behavior
for a bare-name ticket today, since `newCustomerSchema` allows both to be
omitted; unchanged). `excludeId`, when provided, excludes that customer
from the match (used by `PATCH`).

### `createTicket`'s `newCustomer` path (`tickets.service.ts`, modified)

Before `prisma.customer.create`, calls
`findExistingCustomerByContact(data.newCustomer)` (no `excludeId` — this
is always a new-ticket context). A match reuses that customer's id in
place of creating a new row; the ticket is created and returned exactly
as today either way — this is silent, internal plumbing, not a new
user-visible outcome, and never blocks or errors.

### `listTickets` / `GET /api/tickets` — `customerId` filter (new)

`tickets.service.ts`'s `listTickets` filters object gains
`customerId?: string`, applied the same way the existing `assigneeId`/
`departmentId`/`categoryId` filters are — a direct `where` equality.
`tickets.controller.ts`'s `listTicketsHandler` reads it from
`req.query.customerId` alongside the existing filters.

## Frontend

### `CustomerListView.vue` — new route `/customers`, visible to all staff

Mirrors the `QuickReplyListView.vue`/`TicketCategoryListView.vue` list
pattern: a search field wired to `GET /api/customers?query=` (debounced —
this is now a primary browsing surface, not just an autocomplete), a
table of results (name/email/phone) where each row navigates to
`CustomerDetailView`, and a "New Customer" button opening a create dialog
(fullName/email/phone). A `409` on submit shows the conflict message with
a link to the existing customer (`{ name: 'customer-detail', params: { id: existingCustomerId } }`)
instead of a dead-end error.

### `CustomerDetailView.vue` — new route `/customers/:id`, visible to all staff

An info card (fullName/email/phone) with an "Edit" button opening the
same shape of dialog as create, same `409`-with-link handling. Below it, a
table of the customer's tickets (subject/status/priority/createdAt),
fetched via `fetchTickets({ customerId: id })`, each row linking to
`TicketDetailView`. Empty state ("No tickets yet") for a directly-created
customer with none.

### `TicketListView.vue` / `TicketDetailView.vue` — customer name becomes a link

Both currently render `ticket.customer.fullName` as plain text (list:
`{{ item.customer.fullName }}`; detail: a `v-list-item`'s `subtitle`).
Both become a `router-link`/`:to` to
`{ name: 'customer-detail', params: { id: ticket.customer.id } }` —
`ApiTicketSummary`'s `customer` field already carries `{ id, fullName }`,
so no new data is needed, just a template change in each file.

### Nav (`AppShell.vue`) and router (`router/index.ts`)

One new nav item, added alongside the ungated `Tickets` item (not inside
the `isAdmin`-gated block) — the first new nav item in this app that
isn't admin-only since `Tickets` itself. Two new routes,
`{ path: 'customers', name: 'customers', component: CustomerListView }`
and `{ path: 'customers/:id', name: 'customer-detail', component: CustomerDetailView }`,
both under the existing `AppShell` children (`requiresAuth: true`, no
`roles` meta — same pattern as `tickets`).

## Error Handling

No new error shapes beyond `{ error: { code, message } }` via the
existing `HttpError`/`errorHandler`. New code: `409 CUSTOMER_EXISTS` on
`POST /api/customers` and `PATCH /api/customers/:id`, with an
`existingCustomerId` field alongside the standard `error` object (the one
deliberate departure from the plain `{ error }` shape elsewhere, needed so
the frontend can link to the conflicting record — documented here so the
implementer doesn't treat it as an oversight). `404 NOT_FOUND` for a
missing customer id on `GET /api/customers/:id` and `PATCH /api/customers/:id`,
matching the existing ticket-detail 404 pattern.

## Testing

Same conventions as every prior sub-project (Vitest + Supertest against a
real test Postgres DB for backend; Vitest + `@vue/test-utils` via
`mountWithPlugins` for frontend).

- **Backend:**
  - `customers.test.ts` (new, or extends existing customer route tests if
    a file already exists) — `GET /:id` returns the customer with their
    tickets newest-first, `404` for a missing id; `POST /` creates and
    returns `201`, returns `409` with `existingCustomerId` when email or
    phone matches an existing customer; `PATCH /:id` updates fields,
    returns `409` on a colliding email/phone against a *different*
    customer, does NOT `409` when the submitted email/phone matches the
    customer's own current value (self-exclusion), `404` for a missing id.
  - `tickets.test.ts` additions — creating a ticket with a `newCustomer`
    whose email matches an existing customer reuses that customer (ticket
    ends up with the existing customer's id, no new `Customer` row
    created); same for a phone-only match; a `newCustomer` with neither
    email nor phone always creates a new customer (unchanged behavior);
    `GET /api/tickets?customerId=` filters correctly.
  - `publicTickets.test.ts` addition — a web-form submission whose email
    matches an existing customer reuses that customer too (the dedup path
    is shared, both routes call the same `createTicket`).
- **Frontend:**
  - `CustomerListView.test.ts` — renders search results, create dialog
    happy path, create dialog `409` shows the existing-customer link.
  - `CustomerDetailView.test.ts` — renders customer info and ticket
    history table, empty state with zero tickets, edit dialog happy path
    and `409` handling.
  - `TicketListView.test.ts` / `TicketDetailView.test.ts` additions — the
    customer name renders as a link to the correct `customer-detail`
    route.

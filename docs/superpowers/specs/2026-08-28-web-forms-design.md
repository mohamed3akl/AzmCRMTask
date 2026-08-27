# AzmCRM — Communication Channels: Web Forms: Design Spec

**Date:** 2026-08-28
**Status:** Approved for planning
**Sub-project:** 4 of 11 (see [Roadmap](#roadmap) below) — depends on Ticket Management (merged to `master`)

## Context

The original product spec (`azm_squad_customer_support_crm.pdf`, section 3)
lists five customer-facing intake channels: Email, WhatsApp, Live chat, SMS,
and Web forms. These are five largely independent integrations — different
vendors, different protocols, different failure modes — and bundling them
into one spec would produce something no single implementation plan could
execute. This sub-project scopes only the first and cheapest of the five:
an embeddable web form that lets a customer submit a ticket without an
AzmCRM account, without any third-party vendor account, and without any new
runtime infrastructure (no websockets, no webhook receiver, no queue).

The remaining four channels (Email, Live Chat, SMS, WhatsApp) each need
their own brainstorm-and-spec cycle later — Email and SMS/WhatsApp need a
vendor decision (transactional email provider; Twilio-or-similar) this
project doesn't have access to yet, and Live Chat needs a real-time layer
this sub-project doesn't build.

## Roadmap

1. Foundation — done, merged to master
2. Ticket Management — done, merged to master
3. Agent Dashboard — done, merged to master
4. **Communication Channels: Web Forms (this spec)** — public embeddable
   ticket-submission form, ticket source tracking
5. Communication Channels: remaining channels (Email, Live Chat, SMS,
   WhatsApp) — separate future sub-projects, each needing its own spec and,
   for Email/SMS/WhatsApp, a vendor account this project doesn't have yet
6. SLA & Automation — targets, automated assignment/escalation, alerts
7. Knowledge Base — FAQs/articles/search
8. Customer Portal — self-service ticket submission/tracking (including
   looking up a ticket by the reference this sub-project introduces)
9. AI Features — summaries, suggested replies, categorization, chatbot
10. Reports & Management dashboards
11. Integrations — ERP, external APIs

## Goals

- Let a customer submit a ticket from any external website, with no AzmCRM
  account and no login, via a small embeddable widget (a `<script>` tag
  plus an auto-resizing iframe) — not just a page that only lives inside
  the AzmCRM frontend.
- Collect the minimum needed to create a `Customer` + `Ticket`: full name,
  at least one contact method (email or phone), subject, description.
  No priority/category/department from the public — staff triage those
  after intake, exactly as Ticket Management already assumes for
  internally-created tickets.
- Give the submitter a lightweight receipt (an on-screen reference code)
  with no new infrastructure — no email delivery, no login-based tracking.
- Introduce a `source` field on `Ticket` (`MANUAL` | `WEB_FORM`) so staff
  can see how a ticket arrived, and so every later channel in this family
  has a place to record itself instead of a retrofit migration.
- Make `Ticket.createdById` nullable, since a channel-submitted ticket has
  no staff member behind it — a schema change every remaining channel in
  this family needs, done once here rather than four more times.
- Apply basic anti-abuse protection (per-IP rate limiting) to the new
  public endpoint, since it is unauthenticated by design.

## Non-Goals / Explicitly Out of Scope

- **CAPTCHA or any other bot-detection beyond IP rate limiting.** Deferred
  until real abuse patterns are observed; rate limiting is the only
  protection this phase ships.
- **Editing or canceling a submission after the fact**, and **looking up a
  ticket by its reference code.** The reference is a receipt only in this
  phase; self-service tracking is the explicit job of the future Customer
  Portal sub-project (roadmap item 8), which will need its own auth-free
  lookup design (by reference + contact method, most likely) — not
  duplicated here.
- **Email confirmation of a submission.** No outbound email exists yet in
  this project (that's the Email channel, roadmap item 5); the on-screen
  reference is the only confirmation.
- **A category picker on the public form.** Considered during brainstorming
  and explicitly deferred — the minimal field set (name, contact, subject,
  description) was chosen instead; add it later if triage volume justifies
  it.
- **The other four Communication Channels** (Email, Live Chat, SMS,
  WhatsApp) — see Roadmap above. Nothing in this spec's data model or
  backend prevents them from being added later; the `TicketSource` enum
  and nullable `createdById` are designed to be extended, not reworked.
- **Any change to the authenticated staff-facing ticket-creation flow**
  (`TicketCreateView.vue`, `POST /api/tickets`) — that path is untouched;
  this sub-project adds a parallel, separate, unauthenticated path.

## Architecture

Extends the existing Foundation/Ticket Management/Agent Dashboard layout.
The widget is delivered as approach **A** from brainstorming — a hosted
page inside the existing `frontend` app, embedded via iframe — not a
separate bundled/versioned widget project. This reuses the app's existing
Vuetify/i18n/build entirely; the only new pieces are one unauthenticated
route, one small dedicated API client, and one static vanilla-JS embed
script (no bundler, no new build target).

```
backend/src/
  routes/         + publicTickets.routes.ts
  controllers/    + publicTickets.controller.ts
  services/       ~ tickets.service.ts (extend createTicket: source, nullable createdById)
  middleware/     + rateLimit.ts (thin wrapper around express-rate-limit)

frontend/src/
  api/            + publicTickets.ts (dedicated axios instance, no auth interceptor)
  views/          + WidgetEmbedView.vue
  router/         ~ index.ts (new unauthenticated top-level route)

frontend/public/
                  + widget-embed.js (static, unbundled embed snippet)
```

## Data Model

Additions/modifications to `backend/prisma/schema.prisma`:

```prisma
enum TicketSource {
  MANUAL
  WEB_FORM
}

model Ticket {
  id           String         @id @default(uuid())
  subject      String
  description  String
  status       TicketStatus   @default(OPEN)
  priority     TicketPriority @default(MEDIUM)
  isEscalated  Boolean        @default(false)
  source       TicketSource   @default(MANUAL)

  customer     Customer       @relation(fields: [customerId], references: [id])
  customerId   String

  category     TicketCategory? @relation(fields: [categoryId], references: [id])
  categoryId   String?

  department   Department?    @relation(fields: [departmentId], references: [id])
  departmentId String?

  assignee     User?          @relation("TicketAssignee", fields: [assigneeId], references: [id])
  assigneeId   String?

  createdBy    User?          @relation("TicketCreatedBy", fields: [createdById], references: [id])
  createdById  String?

  events       TicketEvent[]
  tasks        Task[]

  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
}
```

Only `source` (new, defaulted) and `createdBy`/`createdById` (required →
optional) change; every other field is unchanged. Existing tickets keep
their existing `createdById` and default to `source: MANUAL` — no backfill
needed. `User.createdTickets` (the reverse relation) is unaffected in
shape; it simply may now include tickets from users who happen to still
be attributed, and excludes nothing.

## Backend API

### `POST /api/public/tickets` — unauthenticated, rate-limited

- Request body: `{ fullName: string; email?: string; phone?: string; subject: string; description: string }`,
  validated with the same `.refine()` pattern already used elsewhere in
  this codebase to require at least one of `email`/`phone`.
- Always creates a new `Customer` via `newCustomer` (no dedup lookup — this
  matches Ticket Management's existing, explicitly-scoped behavior for
  inline customer creation; not a new decision).
- Calls `tickets.service.ts`'s `createTicket`, extended to accept
  `source: TicketSource` (defaults to `'MANUAL'` for every existing
  caller) and an optional `createdById` (existing internal callers keep
  passing the authenticated staff id; this new public path passes
  `undefined`/`null`). No priority/category/department accepted from the
  public payload.
- Response: `{ reference: string }` only — the ticket's `id` truncated to
  its first 8 characters, uppercased (e.g. `a1b2c3d4-...` → `A1B2C3D4`).
  Nothing else about the created ticket or customer is returned to an
  unauthenticated caller.
- Mounted as its own router at `/api/public/tickets`, NOT nested under the
  existing `/api/tickets` (which requires `authenticate`) — keeps the
  public surface trivially auditable as "everything under `/api/public`
  skips auth" rather than a per-route exception inside an authenticated
  router.

### Rate limiting

- `backend/src/middleware/rateLimit.ts` wraps `express-rate-limit`
  (new dependency), configured for 5 requests per 15-minute window, keyed
  by IP (the library's default `req.ip` keying). Correct IP attribution
  behind a reverse proxy requires Express's `app.set('trust proxy', ...)`,
  which depends on the actual deployment topology (unknown at this
  point in the project) — out of scope here; `req.ip` resolves correctly
  for direct connections (including every test in this phase), and
  enabling `trust proxy` correctly is a one-line deployment-time change
  when a real hosting setup exists.
- Applied only to the new public router (`publicTicketsRouter.use(...)`),
  not app-wide — every existing authenticated endpoint is unaffected.
- A rate-limited request receives `429` with the existing
  `{ error: { code, message } }` shape (`RATE_LIMITED`), consistent with
  every other error path in this codebase.

## Frontend

### `WidgetEmbedView.vue` — new unauthenticated route `/widget/embed`

- Added as a **top-level** route in `frontend/src/router/index.ts`,
  sibling to `AppShell`'s parent route — NOT a child of the
  `requiresAuth`-guarded tree, and not wrapped in `AppShell` (no nav
  drawer, no app bar; just the form).
- Locale comes from a `?locale=en|ar` query param (defaulting to `en`),
  read once on mount and applied via the same `vue-i18n`/Vuetify locale
  mechanism `AppShell.vue` already uses — there is no logged-in user to
  read a stored preference from.
- Form fields: full name, email, phone (email/phone both optional
  individually, but the form won't submit without at least one — validated
  client-side to match the backend's `.refine()`), subject, description.
- On successful submit, the form is replaced in-place by a confirmation
  message showing the returned reference code — no navigation (the whole
  page lives inside an iframe; navigating it would be jarring for the
  embedding site).
- After mount, and again after the confirmation state replaces the form,
  the view posts its `document.documentElement.scrollHeight` to
  `window.parent` via `postMessage({ source: 'azmcrm-widget', height })`
  — the embed script (below) listens for this to resize the iframe.

### `frontend/src/api/publicTickets.ts`

- A **separate, dedicated** `axios.create(...)` instance (not the shared
  `apiClient` from `frontend/src/api/client.ts`) — `apiClient`'s response
  interceptor redirects the entire page to `/login` on any `401`, which
  would break an embedded iframe outright (the iframe would navigate to
  the full AzmCRM login screen). The widget's client has no token to
  attach and no reason to ever see a `401` in normal operation, so it
  skips that interceptor entirely rather than special-casing around it.
- Exports `submitPublicTicket(data): Promise<{ reference: string }>`.

### `frontend/public/widget-embed.js`

- Plain, unbundled static JS served as-is by Vite from `public/` (no
  build step, no TypeScript, no framework) — the whole point of this file
  is that an external site can `<script src="https://yourapp.com/widget-embed.js" data-origin="https://yourapp.com" data-locale="en"></script>`
  with nothing else.
- On load: reads `data-origin`/`data-locale` off `document.currentScript`,
  creates an `<iframe>` pointing at `{origin}/widget/embed?locale={locale}`,
  appends it after the script tag (or into a designated container if the
  embedding page provides `<div id="azmcrm-widget">` — script falls back
  to inserting its own container if none exists), and adds a `message`
  listener that resizes the iframe's `height` style whenever it receives
  `{ source: 'azmcrm-widget', height }` from that iframe's `contentWindow`
  (origin-checked against `data-origin`).

## Error Handling

No new error shapes. `429` from the rate limiter and `400` from validation
both use the existing `{ error: { code, message } }` convention via the
existing `errorHandler`/`HttpError` pattern (the rate-limit middleware
throws an `HttpError(429, 'RATE_LIMITED', ...)` rather than using
`express-rate-limit`'s own default response body, keeping the shape
consistent).

## Testing

Same conventions as every prior sub-project — no new tooling beyond the
one new backend dependency (`express-rate-limit`).

- **Backend** (vitest + supertest, real test Postgres DB):
  - `publicTickets.test.ts` — creates a customer + ticket with
    `source: 'WEB_FORM'` and `createdById: null`; rejects a body with
    neither email nor phone; rejects a body missing subject/description;
    returns only `{ reference }` (asserts no other fields leak); the 6th
    request within the rate-limit window returns `429`.
  - `tickets.test.ts` additions — existing internal ticket creation still
    defaults to `source: 'MANUAL'` with a non-null `createdById`, proving
    the extension is backward compatible.
- **Frontend** (vitest + `@vue/test-utils` via `mountWithPlugins`):
  - `WidgetEmbedView.test.ts` — submits the form (mocking
    `api/publicTickets`), asserts the confirmation state renders the
    returned reference; asserts a `postMessage` call fires with a
    `source: 'azmcrm-widget'` payload after mount and again after
    submission; a validation-failure case (no email or phone provided)
    shows an inline error and does not call the API.
  - `TicketDetailView` — the only existing view that renders
    `createdBy.fullName` (`TicketListView`'s columns never reference it,
    so it needs no change) — a small addition to its existing test file
    confirming a ticket with `createdBy: null` renders without throwing
    (`—` fallback instead of a crash on `ticket.createdBy.fullName`).

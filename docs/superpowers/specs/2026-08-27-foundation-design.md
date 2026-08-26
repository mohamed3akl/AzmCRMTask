# AzmCRM — Foundation: Design Spec

**Date:** 2026-08-27
**Status:** Approved for planning
**Sub-project:** 1 of 10 (see [Roadmap](#roadmap) below)

## Context

AzmCRM is a Customer Support CRM for internal use at a single company
(no multi-tenancy). The full product scope (from
`azm_squad_customer_support_crm.pdf`) spans customer management,
ticketing, multi-channel communications, an agent dashboard, SLA
automation, a knowledge base, AI features, a customer portal,
reporting, security/admin, and ERP/external integrations. That scope
is too large for a single design, so it has been decomposed into
sequential sub-projects. This document specs the first one:
**Foundation** — auth, users, roles, and departments. Every later
sub-project builds on it.

## Roadmap

1. **Foundation** (this spec) — auth, users/roles/permissions, core
   org structure (departments), app shell, i18n scaffolding
2. Ticket Management — core ticketing engine
3. Agent Dashboard — the agent's daily workspace
4. Communication Channels — email/WhatsApp/SMS/live chat/web forms intake
5. SLA & Automation — targets, auto-assignment, escalation, alerts
6. Knowledge Base — FAQs/articles/search
7. Customer Portal — self-service ticket submission/tracking
8. AI Features — summaries, suggested replies, categorization, chatbot
9. Reports & Management dashboards
10. Integrations — ERP, external APIs

Each sub-project gets its own spec → plan → implementation cycle.

## Goals

- Stand up the deployable skeleton of the app: an Express/TypeScript
  API backed by PostgreSQL (via Prisma), and a Vue 3 + Vuetify +
  TypeScript SPA, both scaffolded and running.
- Support login, logout, and per-request authentication.
- Support three fixed roles — Agent, Supervisor, Admin — with
  route-level authorization.
- Model the org structure needed by later phases: departments, with
  users belonging to at most one department.
- Give Admins a way to manage users and departments.
- Set up bilingual (Arabic/English, RTL-aware) UI scaffolding from day
  one so later phases don't have to retrofit it.

## Non-Goals / Explicitly Out of Scope

- **Customers, tickets, or any support-domain entities** — these
  belong to sub-project 2 onward.
- **Branches / multi-branch support** — deferred until there's an
  actual second branch to model.
- **Audit logs and a configurable permissions matrix** — roles are
  hardcoded for now; a granular permissions system is deferred to the
  Security & Administration sub-project if it turns out to be needed.
- **Self-registration** — accounts are Admin-provisioned only.
- **Password reset via email** — needs the email integration built in
  the Communication Channels sub-project. For now, Admins reset a
  user's password directly.
- **Refresh tokens / server-side session revocation list** — a single
  long-lived JWT is sufficient at this stage (see
  [Auth Flow](#auth-flow)). Revisit if a real need emerges (e.g. a
  mobile app wanting long-lived sessions).

## Architecture

Single repository, two top-level apps:

```
/backend    Express + TypeScript API
/frontend   Vue 3 + Vuetify + TypeScript SPA (Vite)
```

Backend is a layered monolith:

```
routes/       Express routers, one per resource (auth, users, departments)
controllers/  Parse request, call service, shape response
services/     Business logic (authService, userService, departmentService)
middleware/   authenticate, authorize(...roles), centralized error handler
prisma/       schema.prisma, migrations
lib/          JWT helpers, password hashing (bcrypt)
```

No shared build tooling between `/backend` and `/frontend` is needed
at this stage — they are independent Node projects in one repo.

## Data Model

Prisma schema (Postgres):

```prisma
enum Role {
  AGENT
  SUPERVISOR
  ADMIN
}

model Department {
  id        String   @id @default(uuid())
  nameEn    String
  nameAr    String
  users     User[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model User {
  id           String      @id @default(uuid())
  email        String      @unique
  passwordHash String
  fullName     String
  role         Role
  department   Department? @relation(fields: [departmentId], references: [id])
  departmentId String?
  isActive     Boolean     @default(true)
  locale       String      @default("en") // "en" | "ar"
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
}
```

Notes:
- `departmentId` is nullable — an Admin may not belong to a specific
  department.
- A Supervisor manages the single department they belong to; there is
  no separate "manages" relation. (Department-scoped visibility of
  tickets/customers is a concern for later sub-projects, not this
  one — Foundation just records the membership.)
- Roles are a fixed enum, not a database-configurable table. Adding a
  4th role later is a migration, which is an acceptable cost for the
  simplicity this buys now.

## Auth Flow

- `POST /api/auth/login` — body `{ email, password }`. Verifies via
  bcrypt compare, signs a JWT (`{ sub: userId, role, departmentId }`)
  valid for ~10 hours, returns `{ token, user }`.
- `POST /api/auth/logout` — stateless; the frontend simply discards
  the token. No server-side blacklist.
- Frontend stores the token in a Pinia `authStore` and persists it to
  `localStorage` so a page refresh doesn't force re-login. An axios
  interceptor attaches `Authorization: Bearer <token>` to every
  request.
- `authenticate` middleware verifies the JWT signature/expiry, then
  re-fetches the user by id from the database on every request (to
  read current `role`, `departmentId`, and `isActive`). This means an
  Admin deactivating a user takes effect immediately, not just at
  token expiry — the extra indexed lookup per request is a non-issue
  at this scale.
- On a 401 response, the frontend's axios interceptor clears the auth
  store and redirects to `/login`.

## Permissions

- `authorize(...roles: Role[])` middleware checks `req.user.role` is
  in the allowed list; used per-route (e.g.
  `authorize('ADMIN')` on user-management endpoints).
- No granular per-permission matrix — this is a deliberate YAGNI call
  documented in Non-Goals.

## Frontend Structure

- Vite-built Vue 3 + Vuetify + TypeScript SPA.
- Pinia `authStore`: holds `token`, `currentUser`; `login()` /
  `logout()` actions.
- `vue-router` navigation guards: redirect unauthenticated users to
  `/login`; role-gated routes via route `meta.roles`, checked in the
  guard (e.g. User/Department management pages require `ADMIN`).
- App shell: nav drawer, top bar with user menu (shows current user,
  logout) and a locale switcher (en/ar).
- Pages in this phase: Login, User management (Admin: list/create/
  edit/deactivate), Department management (Admin: list/create/edit).
- `vue-i18n` configured with `en` and `ar` locale files from the
  start. Vuetify's `rtl` config is toggled based on the active locale
  so RTL layout works for Arabic immediately, not retrofitted later.

## Error Handling

- Backend: centralized Express error-handling middleware returns a
  consistent shape: `{ error: { code, message } }`. Request bodies are
  validated with zod; validation failures return 400. Auth failures
  return 401, authorization failures 403, missing resources 404.
- Frontend: axios response interceptor catches 401 globally (see Auth
  Flow above); other error responses are surfaced to the user via a
  Vuetify snackbar with the server's `error.message`.

## Testing Strategy

- Backend: Vitest unit tests for service-layer logic (password
  hashing, JWT signing/verification, role checks). Integration tests
  for the auth, user, and department endpoints running against a real
  test PostgreSQL database (not mocked).
- Frontend: component tests (Vitest + Vue Test Utils) for the Login
  form and router auth/role guards. Deeper frontend test coverage is
  expected to grow in later sub-projects as more UI exists.

## Open Questions

None outstanding — all decisions above were confirmed during
brainstorming.

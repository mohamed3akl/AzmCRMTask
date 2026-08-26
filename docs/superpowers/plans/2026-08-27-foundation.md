# AzmCRM Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the AzmCRM Foundation — a running Express/TypeScript/Prisma/PostgreSQL API and a Vue 3/Vuetify/TypeScript SPA — with login, three fixed roles (Agent/Supervisor/Admin), department membership, Admin-only user/department management, and bilingual (English/Arabic, RTL-aware) UI scaffolding.

**Architecture:** Two independent Node projects in one repo, `/backend` (layered Express monolith: routes → controllers → services → Prisma) and `/frontend` (Vue 3 SPA with Pinia for state, vue-router for navigation, vue-i18n + Vuetify locale for bilingual/RTL support). Auth is a single long-lived JWT (no refresh tokens), verified and re-checked against the database on every request.

**Tech Stack:** Node.js, Express, TypeScript, Prisma, PostgreSQL, bcrypt, jsonwebtoken, zod, Vitest, supertest — Vue 3, Vuetify, TypeScript, Vite, Pinia, vue-router, vue-i18n, axios, @vue/test-utils.

**Spec:** [docs/superpowers/specs/2026-08-27-foundation-design.md](../specs/2026-08-27-foundation-design.md)

## Global Constraints

- Three fixed roles only: `AGENT`, `SUPERVISOR`, `ADMIN` — no configurable permissions matrix.
- JWT expiry ~10 hours; no refresh tokens, no server-side session/blacklist.
- One department per user (nullable — Admins may have none); no branches.
- No self-registration — accounts are Admin-provisioned only.
- No customer/ticket entities, no audit logs, no email-based password reset in this phase.
- Bilingual English/Arabic with RTL must work from the first frontend screen, not be retrofitted.
- Error responses are always shaped `{ error: { code, message } }`.

---

## Backend Setup

### Task 1: Backend scaffolding, Prisma schema, and DB bootstrap

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/.env.example`
- Create: `backend/.gitignore`
- Create: `backend/prisma/schema.prisma`
- Create: `backend/prisma/seed.ts`
- Create: `backend/src/lib/prisma.ts`
- Create: `backend/src/lib/httpError.ts`
- Create: `backend/src/app.ts`
- Create: `backend/src/index.ts`
- Create: `backend/vitest.config.ts`
- Create: `backend/tests/setup.ts`
- Test: `backend/tests/health.test.ts`

**Interfaces:**
- Produces: `prisma` (Prisma client singleton, `backend/src/lib/prisma.ts`, default export named `prisma`), `HttpError` class (`backend/src/lib/httpError.ts`: `new HttpError(statusCode: number, code: string, message: string)`), `createApp(): Express` (`backend/src/app.ts`), `Role` enum (`AGENT`/`SUPERVISOR`/`ADMIN`) and `User`/`Department` Prisma models used by every later backend task.

- [ ] **Step 1: Create the backend project and install dependencies**

```bash
mkdir -p backend
cd backend
npm init -y
npm install express cors dotenv bcrypt jsonwebtoken zod @prisma/client
npm install -D typescript ts-node-dev ts-node prisma vitest supertest @types/express @types/cors @types/bcrypt @types/jsonwebtoken @types/supertest @types/node
npx prisma init --datasource-provider postgresql
cd ..
```

This creates `backend/prisma/schema.prisma` (to be overwritten in Step 3) and `backend/.env` (to be replaced by `.env.example`, see Step 2).

- [ ] **Step 2: Write config files**

`backend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src", "prisma", "tests"]
}
```

`backend/.env.example`:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/azmcrm?schema=public
JWT_SECRET=replace-with-a-long-random-string
PORT=4000
ADMIN_EMAIL=admin@azmcrm.local
ADMIN_PASSWORD=ChangeMe123!
```

`backend/.gitignore`:

```
node_modules/
dist/
.env
.env.test
```

Delete the `backend/.env` that `prisma init` created (it's covered by `.gitignore` and `.env.example` above):

```bash
rm backend/.env
```

Then create your real `backend/.env` by copying `.env.example` and filling in a local `DATABASE_URL` and a random `JWT_SECRET`.

Edit `backend/package.json` — add a `"prisma"` key and replace `"scripts"`:

```json
{
  "prisma": {
    "seed": "ts-node prisma/seed.ts"
  },
  "scripts": {
    "dev": "ts-node-dev --respawn src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:seed": "ts-node prisma/seed.ts"
  }
}
```

- [ ] **Step 3: Write the Prisma schema**

`backend/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

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
  locale       String      @default("en")
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
}
```

- [ ] **Step 4: Write the Prisma client singleton and HttpError**

`backend/src/lib/prisma.ts`:

```ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
```

`backend/src/lib/httpError.ts`:

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

- [ ] **Step 5: Write the failing test for the health endpoint**

`backend/tests/health.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /health', () => {
  it('returns ok status', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

`backend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
  },
});
```

`backend/tests/setup.ts` (empty for now — later tasks add DB cleanup here):

```ts
export {};
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `Cannot find module '../src/app'` (it doesn't exist yet).

- [ ] **Step 7: Write the Express app and entrypoint**

`backend/src/app.ts`:

```ts
import express, { Express } from 'express';
import cors from 'cors';

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}
```

`backend/src/index.ts`:

```ts
import 'dotenv/config';
import { createApp } from './app';

const PORT = process.env.PORT ?? 4000;
const app = createApp();

app.listen(PORT, () => {
  console.log(`AzmCRM backend listening on port ${PORT}`);
});
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 9: Write the seed script**

`backend/prisma/seed.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL ?? 'admin@azmcrm.local';
  const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin user ${email} already exists, skipping seed.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName: 'System Admin',
      role: 'ADMIN',
      locale: 'en',
    },
  });
  console.log(`Seeded admin user: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 10: Run the migration and seed against your local dev database**

Make sure `backend/.env` has a valid `DATABASE_URL` pointing at a Postgres database you've created locally (e.g. `createdb azmcrm`), then:

```bash
cd backend
npm run prisma:migrate -- --name init
npm run prisma:seed
```

Expected: migration creates the `Department` and `User` tables; seed prints `Seeded admin user: admin@azmcrm.local` (or your configured `ADMIN_EMAIL`). Verify with `npx prisma studio` or `psql` that one `User` row exists with `role = ADMIN`.

- [ ] **Step 11: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/tsconfig.json backend/.env.example backend/.gitignore backend/prisma/schema.prisma backend/prisma/seed.ts backend/src backend/vitest.config.ts backend/tests
git commit -m "feat(backend): scaffold Express/Prisma project with health check and admin seed"
```

---

### Task 2: Password and JWT helper libraries

**Files:**
- Create: `backend/src/lib/password.ts`
- Create: `backend/src/lib/jwt.ts`
- Test: `backend/tests/lib/password.test.ts`
- Test: `backend/tests/lib/jwt.test.ts`

**Interfaces:**
- Consumes: nothing new (uses `bcrypt`, `jsonwebtoken` directly).
- Produces: `hashPassword(plain: string): Promise<string>`, `comparePassword(plain: string, hash: string): Promise<boolean>` (`backend/src/lib/password.ts`); `TokenPayload { sub: string; role: Role; departmentId: string | null }`, `signToken(payload: TokenPayload): string`, `verifyToken(token: string): TokenPayload` (`backend/src/lib/jwt.ts`) — used by the auth middleware and auth service in Tasks 3–4.

- [ ] **Step 1: Write the failing tests**

`backend/tests/lib/password.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, comparePassword } from '../../src/lib/password';

describe('password helpers', () => {
  it('hashes a password so it no longer matches the plain text', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
  });

  it('confirms a correct password matches its hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(comparePassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(comparePassword('wrong password', hash)).resolves.toBe(false);
  });
});
```

`backend/tests/lib/jwt.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { signToken, verifyToken } from '../../src/lib/jwt';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret';
});

describe('jwt helpers', () => {
  it('signs and verifies a token round-trip', () => {
    const token = signToken({ sub: 'user-1', role: 'ADMIN', departmentId: null });
    const payload = verifyToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('ADMIN');
    expect(payload.departmentId).toBeNull();
  });

  it('throws on a tampered token', () => {
    const token = signToken({ sub: 'user-1', role: 'ADMIN', departmentId: null });
    expect(() => verifyToken(token + 'tampered')).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm test`
Expected: FAIL — `Cannot find module '../../src/lib/password'` and `'../../src/lib/jwt'`.

- [ ] **Step 3: Implement the helpers**

`backend/src/lib/password.ts`:

```ts
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

`backend/src/lib/jwt.ts`:

```ts
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';

export interface TokenPayload {
  sub: string;
  role: Role;
  departmentId: string | null;
}

const EXPIRES_IN = '10h';

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return secret;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: EXPIRES_IN });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, getSecret()) as unknown as TokenPayload;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npm test`
Expected: PASS (all tests, including Task 1's health test)

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/password.ts backend/src/lib/jwt.ts backend/tests/lib
git commit -m "feat(backend): add password hashing and JWT helpers"
```

---

### Task 3: Auth/authorize middleware and centralized error handling

**Files:**
- Create: `backend/src/types/express.d.ts`
- Create: `backend/src/middleware/errorHandler.ts`
- Create: `backend/src/middleware/validate.ts`
- Create: `backend/src/middleware/authenticate.ts`
- Create: `backend/src/middleware/authorize.ts`
- Modify: `backend/src/app.ts` (mount `errorHandler`)
- Modify: `backend/tests/setup.ts` (add Prisma DB cleanup between tests)
- Test: `backend/tests/middleware/auth.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1), `verifyToken` (Task 2), `HttpError` (Task 1).
- Produces: `authenticate` (Express middleware, sets `req.user = { id, role, departmentId }`), `authorize(...roles: Role[])` (Express middleware factory), `errorHandler` (Express error middleware), `validate(schema: ZodSchema)` (Express middleware factory) — used by every route file from Task 4 onward.

- [ ] **Step 1: Add the Express `Request.user` type augmentation**

`backend/src/types/express.d.ts`:

```ts
import { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: Role;
        departmentId: string | null;
      };
    }
  }
}

export {};
```

- [ ] **Step 2: Write the error handler and validation middleware**

`backend/src/middleware/errorHandler.ts`:

```ts
import { ErrorRequestHandler } from 'express';
import { HttpError } from '../lib/httpError';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
};
```

`backend/src/middleware/validate.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { HttpError } from '../lib/httpError';

export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.errors.map((e) => e.message).join(', ');
      next(new HttpError(400, 'VALIDATION_ERROR', message));
      return;
    }
    req.body = result.data;
    next();
  };
}
```

- [ ] **Step 3: Write the failing test for authenticate/authorize**

This test mounts a throwaway protected route directly in the test file's own app instance, so it doesn't depend on later tasks' routes.

`backend/tests/setup.ts` (replace the empty file from Task 1):

```ts
import { beforeEach, afterAll } from 'vitest';
import { config } from 'dotenv';

config({ path: '.env.test' });

import { prisma } from '../src/lib/prisma';

beforeEach(async () => {
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

Create `backend/.env.test.example`:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/azmcrm_test?schema=public
JWT_SECRET=test-secret
```

Copy it to a real `backend/.env.test` (create a separate local `azmcrm_test` database, e.g. `createdb azmcrm_test`), then run the migrations against it:

```bash
cd backend
cp .env.test.example .env.test
DATABASE_URL=$(grep DATABASE_URL .env.test | cut -d= -f2-) npx prisma migrate deploy
```

`backend/tests/middleware/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../src/middleware/errorHandler';
import { authenticate } from '../../src/middleware/authenticate';
import { authorize } from '../../src/middleware/authorize';
import { signToken } from '../../src/lib/jwt';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.get('/protected', authenticate, authorize('ADMIN'), (req, res) => {
    res.json({ userId: req.user?.id });
  });
  app.use(errorHandler);
  return app;
}

async function createUser(overrides: Partial<{ role: 'AGENT' | 'SUPERVISOR' | 'ADMIN'; isActive: boolean }> = {}) {
  return prisma.user.create({
    data: {
      email: `${Math.random()}@example.com`,
      passwordHash: await hashPassword('password123'),
      fullName: 'Test User',
      role: overrides.role ?? 'ADMIN',
      isActive: overrides.isActive ?? true,
    },
  });
}

describe('authenticate + authorize middleware', () => {
  it('rejects a request with no token', async () => {
    const res = await request(buildTestApp()).get('/protected');
    expect(res.status).toBe(401);
  });

  it('rejects a request with an invalid token', async () => {
    const res = await request(buildTestApp()).get('/protected').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(401);
  });

  it('rejects a deactivated user even with a valid token', async () => {
    const user = await createUser({ isActive: false });
    const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
    const res = await request(buildTestApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects a valid but under-privileged user', async () => {
    const user = await createUser({ role: 'AGENT' });
    const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
    const res = await request(buildTestApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('allows a valid, active, correctly-roled user', async () => {
    const user = await createUser({ role: 'ADMIN' });
    const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
    const res = await request(buildTestApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(user.id);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `Cannot find module '../../src/middleware/authenticate'` (and `authorize`).

- [ ] **Step 5: Implement authenticate and authorize**

`backend/src/middleware/authenticate.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/httpError';

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(new HttpError(401, 'UNAUTHENTICATED', 'Missing bearer token'));
    return;
  }

  const token = header.slice('Bearer '.length);
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    next(new HttpError(401, 'UNAUTHENTICATED', 'Invalid or expired token'));
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) {
    next(new HttpError(401, 'UNAUTHENTICATED', 'User not found or inactive'));
    return;
  }

  req.user = { id: user.id, role: user.role, departmentId: user.departmentId };
  next();
}
```

`backend/src/middleware/authorize.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { HttpError } from '../lib/httpError';

export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new HttpError(403, 'FORBIDDEN', 'Insufficient permissions'));
      return;
    }
    next();
  };
}
```

Wire the error handler into the main app (later route tasks will add their routers before this line):

`backend/src/app.ts` — add the import and mount at the end of `createApp`, replacing the closing of the function:

```ts
import express, { Express } from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
git add backend/src/types backend/src/middleware backend/src/app.ts backend/tests/setup.ts backend/tests/middleware backend/.env.test.example
git commit -m "feat(backend): add authenticate/authorize middleware and centralized error handling"
```

---

### Task 4: Auth endpoints (login/logout)

**Files:**
- Create: `backend/src/services/auth.service.ts`
- Create: `backend/src/controllers/auth.controller.ts`
- Create: `backend/src/routes/auth.routes.ts`
- Modify: `backend/src/app.ts` (mount `authRouter` at `/api/auth`, before `errorHandler`)
- Test: `backend/tests/routes/auth.test.ts`

**Interfaces:**
- Consumes: `prisma`, `HttpError` (Task 1); `comparePassword`, `signToken` (Task 2); `validate` (Task 3).
- Produces: `POST /api/auth/login` → `{ token: string, user: PublicUser }` on success, 401 on bad credentials; `POST /api/auth/logout` → 204. `login(email, password)` in `auth.service.ts` is reused nowhere else in this phase but establishes the `PublicUser` shape (`User` minus `passwordHash`) that Task 5's user endpoints also return.

- [ ] **Step 1: Write the failing test**

`backend/tests/routes/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';

const app = createApp();

async function createUser(overrides: Partial<{ email: string; password: string; isActive: boolean }> = {}) {
  const password = overrides.password ?? 'password123';
  return {
    user: await prisma.user.create({
      data: {
        email: overrides.email ?? 'agent@example.com',
        passwordHash: await hashPassword(password),
        fullName: 'Test Agent',
        role: 'AGENT',
        isActive: overrides.isActive ?? true,
      },
    }),
    password,
  };
}

describe('POST /api/auth/login', () => {
  it('returns a token and the public user on valid credentials', async () => {
    const { user, password } = await createUser({ email: 'agent@example.com' });
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user.email).toBe(user.email);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('rejects an unknown email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever' });
    expect(res.status).toBe(401);
  });

  it('rejects an incorrect password', async () => {
    const { user } = await createUser({ email: 'agent2@example.com' });
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('rejects a deactivated user', async () => {
    const { user, password } = await createUser({ email: 'agent3@example.com', isActive: false });
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed body', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 204', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — 404s, because `/api/auth/*` isn't mounted yet.

- [ ] **Step 3: Implement the service, controller, and routes**

`backend/src/services/auth.service.ts`:

```ts
import { prisma } from '../lib/prisma';
import { comparePassword } from '../lib/password';
import { signToken } from '../lib/jwt';
import { HttpError } from '../lib/httpError';

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return { token, user: publicUser };
}
```

`backend/src/controllers/auth.controller.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';

export async function loginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export function logoutHandler(_req: Request, res: Response) {
  res.status(204).send();
}
```

`backend/src/routes/auth.routes.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { loginHandler, logoutHandler } from '../controllers/auth.controller';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authRouter = Router();

authRouter.post('/login', validate(loginSchema), loginHandler);
authRouter.post('/logout', logoutHandler);
```

`backend/src/app.ts` — mount the router before `errorHandler`:

```ts
import express, { Express } from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth.routes';

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/auth.service.ts backend/src/controllers/auth.controller.ts backend/src/routes/auth.routes.ts backend/src/app.ts backend/tests/routes/auth.test.ts
git commit -m "feat(backend): add login/logout endpoints"
```

---

### Task 5: User management endpoints (Admin-only)

**Files:**
- Create: `backend/src/services/users.service.ts`
- Create: `backend/src/controllers/users.controller.ts`
- Create: `backend/src/routes/users.routes.ts`
- Modify: `backend/src/app.ts` (mount `usersRouter` at `/api/users`)
- Test: `backend/tests/routes/users.test.ts`

**Interfaces:**
- Consumes: `prisma`, `HttpError` (Task 1); `hashPassword` (Task 2); `authenticate`, `authorize`, `validate` (Task 3).
- Produces: `GET /api/users` (list), `POST /api/users` (create), `PATCH /api/users/:id` (update), `POST /api/users/:id/deactivate` — all `ADMIN`-only, all returning `PublicUser` (or `PublicUser[]`) matching the shape from Task 4. Consumed by the frontend's `api/users.ts` in Task 10.

- [ ] **Step 1: Write the failing test**

`backend/tests/routes/users.test.ts`:

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

describe('/api/users', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('rejects non-admin requests', async () => {
    const { token } = await createAgent();
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('lists users for an admin', async () => {
    const { token } = await createAdmin();
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].passwordHash).toBeUndefined();
  });

  it('creates a user', async () => {
    const { token } = await createAdmin();
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'new@example.com', password: 'password123', fullName: 'New User', role: 'AGENT' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('new@example.com');
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('rejects creating a user with a duplicate email', async () => {
    const { token } = await createAdmin();
    await prisma.user.create({
      data: { email: 'dup@example.com', passwordHash: await hashPassword('x'), fullName: 'Dup', role: 'AGENT' },
    });
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'dup@example.com', password: 'password123', fullName: 'Another', role: 'AGENT' });
    expect(res.status).toBe(400);
  });

  it('updates a user', async () => {
    const { token } = await createAdmin();
    const target = await prisma.user.create({
      data: { email: 'target@example.com', passwordHash: await hashPassword('x'), fullName: 'Target', role: 'AGENT' },
    });
    const res = await request(app)
      .patch(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Updated Name', role: 'SUPERVISOR' });
    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('Updated Name');
    expect(res.body.role).toBe('SUPERVISOR');
  });

  it('deactivates a user', async () => {
    const { token } = await createAdmin();
    const target = await prisma.user.create({
      data: { email: 'deact@example.com', passwordHash: await hashPassword('x'), fullName: 'Deact', role: 'AGENT' },
    });
    const res = await request(app)
      .post(`/api/users/${target.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — 404s on `/api/users/*`.

- [ ] **Step 3: Implement the service, controller, and routes**

`backend/src/services/users.service.ts`:

```ts
import { Role, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { HttpError } from '../lib/httpError';

type PublicUser = Omit<User, 'passwordHash'>;

function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

export async function listUsers(): Promise<PublicUser[]> {
  const users = await prisma.user.findMany({ orderBy: { fullName: 'asc' } });
  return users.map(toPublicUser);
}

export async function createUser(data: {
  email: string;
  password: string;
  fullName: string;
  role: Role;
  departmentId?: string | null;
  locale?: string;
}): Promise<PublicUser> {
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    throw new HttpError(400, 'EMAIL_TAKEN', 'A user with this email already exists');
  }
  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash: await hashPassword(data.password),
      fullName: data.fullName,
      role: data.role,
      departmentId: data.departmentId ?? null,
      locale: data.locale ?? 'en',
    },
  });
  return toPublicUser(user);
}

export async function updateUser(
  id: string,
  data: Partial<{ fullName: string; role: Role; departmentId: string | null; locale: string }>
): Promise<PublicUser> {
  try {
    const user = await prisma.user.update({ where: { id }, data });
    return toPublicUser(user);
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'User not found');
  }
}

export async function deactivateUser(id: string): Promise<PublicUser> {
  try {
    const user = await prisma.user.update({ where: { id }, data: { isActive: false } });
    return toPublicUser(user);
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'User not found');
  }
}
```

`backend/src/controllers/users.controller.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import * as usersService from '../services/users.service';

export async function listUsersHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await usersService.listUsers());
  } catch (err) {
    next(err);
  }
}

export async function createUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await usersService.createUser(req.body));
  } catch (err) {
    next(err);
  }
}

export async function updateUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await usersService.updateUser(req.params.id, req.body));
  } catch (err) {
    next(err);
  }
}

export async function deactivateUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await usersService.deactivateUser(req.params.id));
  } catch (err) {
    next(err);
  }
}
```

`backend/src/routes/users.routes.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  listUsersHandler,
  createUserHandler,
  updateUserHandler,
  deactivateUserHandler,
} from '../controllers/users.controller';

const roleEnum = z.enum(['AGENT', 'SUPERVISOR', 'ADMIN']);

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  role: roleEnum,
  departmentId: z.string().uuid().nullable().optional(),
  locale: z.enum(['en', 'ar']).optional(),
});

const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  role: roleEnum.optional(),
  departmentId: z.string().uuid().nullable().optional(),
  locale: z.enum(['en', 'ar']).optional(),
});

export const usersRouter = Router();

usersRouter.use(authenticate, authorize('ADMIN'));
usersRouter.get('/', listUsersHandler);
usersRouter.post('/', validate(createUserSchema), createUserHandler);
usersRouter.patch('/:id', validate(updateUserSchema), updateUserHandler);
usersRouter.post('/:id/deactivate', deactivateUserHandler);
```

`backend/src/app.ts` — add the import and mount:

```ts
import express, { Express } from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth.routes';
import { usersRouter } from './routes/users.routes';

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/users.service.ts backend/src/controllers/users.controller.ts backend/src/routes/users.routes.ts backend/src/app.ts backend/tests/routes/users.test.ts
git commit -m "feat(backend): add admin user management endpoints"
```

---

### Task 6: Department management endpoints (Admin-only)

**Files:**
- Create: `backend/src/services/departments.service.ts`
- Create: `backend/src/controllers/departments.controller.ts`
- Create: `backend/src/routes/departments.routes.ts`
- Modify: `backend/src/app.ts` (mount `departmentsRouter` at `/api/departments`)
- Test: `backend/tests/routes/departments.test.ts`

**Interfaces:**
- Consumes: `prisma`, `HttpError` (Task 1); `authenticate`, `authorize`, `validate` (Task 3).
- Produces: `GET /api/departments`, `POST /api/departments`, `PATCH /api/departments/:id` — all `ADMIN`-only, returning `Department` (`{ id, nameEn, nameAr, createdAt, updatedAt }`) or `Department[]`. Consumed by the frontend's `api/departments.ts` in Tasks 10–11.

- [ ] **Step 1: Write the failing test**

`backend/tests/routes/departments.test.ts`:

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

describe('/api/departments', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/departments');
    expect(res.status).toBe(401);
  });

  it('creates and lists departments', async () => {
    const { token } = await createAdmin();
    const createRes = await request(app)
      .post('/api/departments')
      .set('Authorization', `Bearer ${token}`)
      .send({ nameEn: 'Support', nameAr: 'الدعم' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.nameEn).toBe('Support');

    const listRes = await request(app).get('/api/departments').set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
  });

  it('updates a department', async () => {
    const { token } = await createAdmin();
    const dept = await prisma.department.create({ data: { nameEn: 'Sales', nameAr: 'المبيعات' } });
    const res = await request(app)
      .patch(`/api/departments/${dept.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nameEn: 'Sales & Marketing' });
    expect(res.status).toBe(200);
    expect(res.body.nameEn).toBe('Sales & Marketing');
  });

  it('rejects an update to a non-existent department', async () => {
    const { token } = await createAdmin();
    const res = await request(app)
      .patch('/api/departments/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ nameEn: 'Nope' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — 404s on `/api/departments/*`.

- [ ] **Step 3: Implement the service, controller, and routes**

`backend/src/services/departments.service.ts`:

```ts
import { Department } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/httpError';

export async function listDepartments(): Promise<Department[]> {
  return prisma.department.findMany({ orderBy: { nameEn: 'asc' } });
}

export async function createDepartment(data: { nameEn: string; nameAr: string }): Promise<Department> {
  return prisma.department.create({ data });
}

export async function updateDepartment(
  id: string,
  data: Partial<{ nameEn: string; nameAr: string }>
): Promise<Department> {
  try {
    return await prisma.department.update({ where: { id }, data });
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'Department not found');
  }
}
```

`backend/src/controllers/departments.controller.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import * as departmentsService from '../services/departments.service';

export async function listDepartmentsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await departmentsService.listDepartments());
  } catch (err) {
    next(err);
  }
}

export async function createDepartmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await departmentsService.createDepartment(req.body));
  } catch (err) {
    next(err);
  }
}

export async function updateDepartmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await departmentsService.updateDepartment(req.params.id, req.body));
  } catch (err) {
    next(err);
  }
}
```

`backend/src/routes/departments.routes.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  listDepartmentsHandler,
  createDepartmentHandler,
  updateDepartmentHandler,
} from '../controllers/departments.controller';

const createDepartmentSchema = z.object({
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
});

const updateDepartmentSchema = z.object({
  nameEn: z.string().min(1).optional(),
  nameAr: z.string().min(1).optional(),
});

export const departmentsRouter = Router();

departmentsRouter.use(authenticate, authorize('ADMIN'));
departmentsRouter.get('/', listDepartmentsHandler);
departmentsRouter.post('/', validate(createDepartmentSchema), createDepartmentHandler);
departmentsRouter.patch('/:id', validate(updateDepartmentSchema), updateDepartmentHandler);
```

`backend/src/app.ts` — add the import and mount:

```ts
import express, { Express } from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth.routes';
import { usersRouter } from './routes/users.routes';
import { departmentsRouter } from './routes/departments.routes';

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

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS (all tests). This completes the backend for this phase.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/departments.service.ts backend/src/controllers/departments.controller.ts backend/src/routes/departments.routes.ts backend/src/app.ts backend/tests/routes/departments.test.ts
git commit -m "feat(backend): add admin department management endpoints"
```

---

## Frontend Setup

### Task 7: Frontend scaffolding (Vite, Vuetify, Pinia, vue-router, vue-i18n)

**Files:**
- Create: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/tsconfig.node.json`, `frontend/vite.config.ts`, `frontend/index.html`
- Create: `frontend/.env.example`, `frontend/.gitignore`
- Create: `frontend/src/main.ts`, `frontend/src/App.vue`
- Create: `frontend/src/plugins/vuetify.ts`
- Create: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Create: `frontend/vitest.config.ts`, `frontend/tests/setup.ts`, `frontend/tests/testUtils.ts`
- Test: `frontend/tests/App.test.ts`

**Interfaces:**
- Produces: `mountWithPlugins(component, options?, routes?)` (`frontend/tests/testUtils.ts`) — the shared test helper every later frontend component test uses; `vuetify` plugin instance (`frontend/src/plugins/vuetify.ts`) configured with `locale.rtl = { en: false, ar: true }`, consumed by Task 9's locale switcher.

- [ ] **Step 1: Scaffold the Vite project and install dependencies**

```bash
npm create vite@latest frontend -- --template vue-ts
cd frontend
npm install
npm install vuetify @mdi/font pinia vue-router vue-i18n axios
npm install -D vitest @vue/test-utils jsdom @vitejs/plugin-vue
cd ..
```

- [ ] **Step 2: Write env and config files**

`frontend/.env.example`:

```
VITE_API_BASE_URL=http://localhost:4000/api
```

Copy to `frontend/.env` for local dev with the same value (adjust if your backend runs elsewhere).

Add to `frontend/.gitignore` (append if the Vite template already created one; it should already ignore `node_modules` and `dist`):

```
.env
```

`frontend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
});
```

Add a `"test": "vitest run"` script to `frontend/package.json`'s `"scripts"` block (alongside the Vite-generated `dev`/`build`/`preview` scripts).

- [ ] **Step 3: Write the Vuetify plugin and locale files**

`frontend/src/plugins/vuetify.ts`:

```ts
import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

export const vuetify = createVuetify({
  components,
  directives,
  locale: {
    locale: 'en',
    fallback: 'en',
    rtl: { en: false, ar: true },
  },
});
```

`frontend/src/locales/en.json`:

```json
{
  "nav": { "home": "Home", "users": "Users", "departments": "Departments", "logout": "Logout" },
  "login": { "title": "Sign in", "email": "Email", "password": "Password", "submit": "Sign in", "error": "Invalid email or password" },
  "home": { "welcome": "Welcome, {name}" },
  "users": {
    "title": "Users",
    "create": "New user",
    "email": "Email",
    "fullName": "Full name",
    "role": "Role",
    "department": "Department",
    "active": "Active",
    "deactivate": "Deactivate"
  },
  "departments": { "title": "Departments", "create": "New department", "nameEn": "Name (English)", "nameAr": "Name (Arabic)" }
}
```

`frontend/src/locales/ar.json`:

```json
{
  "nav": { "home": "الرئيسية", "users": "المستخدمون", "departments": "الأقسام", "logout": "تسجيل الخروج" },
  "login": { "title": "تسجيل الدخول", "email": "البريد الإلكتروني", "password": "كلمة المرور", "submit": "تسجيل الدخول", "error": "بريد إلكتروني أو كلمة مرور غير صحيحة" },
  "home": { "welcome": "مرحبًا، {name}" },
  "users": {
    "title": "المستخدمون",
    "create": "مستخدم جديد",
    "email": "البريد الإلكتروني",
    "fullName": "الاسم الكامل",
    "role": "الدور",
    "department": "القسم",
    "active": "نشط",
    "deactivate": "إيقاف"
  },
  "departments": { "title": "الأقسام", "create": "قسم جديد", "nameEn": "الاسم (إنجليزي)", "nameAr": "الاسم (عربي)" }
}
```

- [ ] **Step 4: Write App.vue and main.ts**

`frontend/src/App.vue` (replace the Vite template's default content):

```vue
<template>
  <router-view />
</template>

<script setup lang="ts"></script>
```

`frontend/src/main.ts` (replace the Vite template's default content):

```ts
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import App from './App.vue';
import { vuetify } from './plugins/vuetify';
import router from './router';
import en from './locales/en.json';
import ar from './locales/ar.json';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en, ar },
});

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(vuetify);
app.use(i18n);
app.mount('#app');
```

Note: `./router` doesn't exist yet — it's created in Task 8. This file is finished here but won't compile/run standalone until Task 8 adds the router. That's fine; the test in this task doesn't import `main.ts`.

- [ ] **Step 5: Write the shared test setup and mount helper, and the failing App test**

`frontend/tests/setup.ts`:

```ts
import { vi } from 'vitest';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error jsdom does not implement ResizeObserver
global.ResizeObserver = ResizeObserverMock;

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}
```

`frontend/tests/testUtils.ts`:

```ts
import { mount, type ComponentMountingOptions } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import en from '../src/locales/en.json';
import ar from '../src/locales/ar.json';

export function mountWithPlugins<T>(
  component: T,
  options: ComponentMountingOptions<T> = {},
  routes: RouteRecordRaw[] = [{ path: '/', component: { template: '<div />' } }]
) {
  const vuetify = createVuetify({
    components,
    directives,
    locale: { locale: 'en', fallback: 'en', rtl: { en: false, ar: true } },
  });
  const pinia = createPinia();
  const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en, ar } });
  const router = createRouter({ history: createWebHistory(), routes });

  return mount(component, {
    ...options,
    global: {
      plugins: [vuetify, pinia, i18n, router],
      ...(options.global ?? {}),
    },
  });
}
```

`frontend/tests/App.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mountWithPlugins } from './testUtils';
import App from '../src/App.vue';

describe('App', () => {
  it('mounts without throwing', () => {
    const wrapper = mountWithPlugins(App);
    expect(wrapper.exists()).toBe(true);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `App.vue`'s `<router-view />` needs an active router with matching routes, or the test setup files are missing pieces. (If it fails for an unrelated reason like a missing `tests` directory, that's expected too — the goal here is confirming the harness runs before we make it pass.)

- [ ] **Step 7: Fix up until the test passes**

The `mountWithPlugins` helper already provides a router with a `/` route, so `App.vue` should mount cleanly once all the files from Steps 1–5 are in place. Re-run:

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add frontend
git commit -m "feat(frontend): scaffold Vite/Vue3/Vuetify/Pinia/i18n project"
```

---

### Task 8: Auth store, API client, login view, and router guards

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/auth.ts`
- Create: `frontend/src/stores/auth.ts`
- Create: `frontend/src/views/LoginView.vue`
- Create: `frontend/src/views/HomeView.vue`
- Create: `frontend/src/router/index.ts`
- Test: `frontend/tests/stores/auth.test.ts`
- Test: `frontend/tests/views/LoginView.test.ts`

**Interfaces:**
- Consumes: `mountWithPlugins` (Task 7).
- Produces: `useAuthStore()` Pinia store with `token`, `currentUser: CurrentUser | null`, `isAuthenticated` getter, `login(email, password): Promise<void>`, `logout(): void` (`frontend/src/stores/auth.ts`); `CurrentUser` type (`{ id, email, fullName, role, departmentId, isActive, locale }`) — used by Task 9's `AppShell.vue` and Tasks 10–11's route guards; `apiClient` (axios instance, `frontend/src/api/client.ts`) — used by every `api/*.ts` module in Tasks 10–11; the default-exported `router` (`frontend/src/router/index.ts`) with named routes `login`, `home`, and route `meta.roles` support, extended by Tasks 10–11.

- [ ] **Step 1: Write the failing auth store test**

`frontend/tests/stores/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../src/api/auth', () => ({
  loginRequest: vi.fn(),
}));

import { loginRequest } from '../../src/api/auth';
import { useAuthStore } from '../../src/stores/auth';

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.mocked(loginRequest).mockReset();
  });

  it('starts unauthenticated', () => {
    const store = useAuthStore();
    expect(store.isAuthenticated).toBe(false);
  });

  it('stores the token and user on successful login', async () => {
    vi.mocked(loginRequest).mockResolvedValue({
      token: 'fake-token',
      user: { id: '1', email: 'a@b.com', fullName: 'A B', role: 'ADMIN', departmentId: null, isActive: true, locale: 'en' },
    });
    const store = useAuthStore();
    await store.login('a@b.com', 'password');
    expect(store.isAuthenticated).toBe(true);
    expect(store.currentUser?.email).toBe('a@b.com');
    expect(localStorage.getItem('azmcrm_token')).toBe('fake-token');
  });

  it('clears state on logout', async () => {
    vi.mocked(loginRequest).mockResolvedValue({
      token: 'fake-token',
      user: { id: '1', email: 'a@b.com', fullName: 'A B', role: 'ADMIN', departmentId: null, isActive: true, locale: 'en' },
    });
    const store = useAuthStore();
    await store.login('a@b.com', 'password');
    store.logout();
    expect(store.isAuthenticated).toBe(false);
    expect(store.currentUser).toBeNull();
    expect(localStorage.getItem('azmcrm_token')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `Cannot find module '../../src/stores/auth'`.

- [ ] **Step 3: Implement the API client and auth store**

`frontend/src/api/client.ts`:

```ts
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api',
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('azmcrm_token');
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('azmcrm_token');
      localStorage.removeItem('azmcrm_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

`frontend/src/api/auth.ts`:

```ts
import { apiClient } from './client';
import type { CurrentUser } from '../stores/auth';

export async function loginRequest(email: string, password: string): Promise<{ token: string; user: CurrentUser }> {
  const res = await apiClient.post('/auth/login', { email, password });
  return res.data;
}
```

`frontend/src/stores/auth.ts`:

```ts
import { defineStore } from 'pinia';
import { loginRequest } from '../api/auth';

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: 'AGENT' | 'SUPERVISOR' | 'ADMIN';
  departmentId: string | null;
  isActive: boolean;
  locale: string;
}

interface AuthState {
  token: string | null;
  currentUser: CurrentUser | null;
}

function loadStoredUser(): CurrentUser | null {
  const raw = localStorage.getItem('azmcrm_user');
  return raw ? (JSON.parse(raw) as CurrentUser) : null;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: localStorage.getItem('azmcrm_token'),
    currentUser: loadStoredUser(),
  }),
  getters: {
    isAuthenticated: (state) => !!state.token,
  },
  actions: {
    async login(email: string, password: string) {
      const { token, user } = await loginRequest(email, password);
      this.token = token;
      this.currentUser = user;
      localStorage.setItem('azmcrm_token', token);
      localStorage.setItem('azmcrm_user', JSON.stringify(user));
    },
    logout() {
      this.token = null;
      this.currentUser = null;
      localStorage.removeItem('azmcrm_token');
      localStorage.removeItem('azmcrm_user');
    },
  },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 5: Write the failing LoginView test**

`frontend/tests/views/LoginView.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../testUtils';

vi.mock('../../src/api/auth', () => ({
  loginRequest: vi.fn(),
}));

import { loginRequest } from '../../src/api/auth';
import LoginView from '../../src/views/LoginView.vue';

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(loginRequest).mockReset();
  });

  it('shows an error message on failed login', async () => {
    vi.mocked(loginRequest).mockRejectedValue(new Error('Invalid credentials'));
    const wrapper = mountWithPlugins(LoginView, {}, [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: LoginView },
    ]);

    await wrapper.find('input[type="email"]').setValue('a@b.com');
    await wrapper.find('input[type="password"]').setValue('wrong');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper.text()).toContain('Invalid email or password');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `Cannot find module '../../src/views/LoginView.vue'`.

- [ ] **Step 7: Implement LoginView, HomeView, and the router**

`frontend/src/views/LoginView.vue`:

```vue
<template>
  <v-container class="fill-height" fluid>
    <v-row justify="center" align="center">
      <v-col cols="12" sm="6" md="4">
        <v-card :title="$t('login.title')">
          <v-card-text>
            <form @submit.prevent="handleSubmit">
              <v-text-field v-model="email" :label="$t('login.email')" type="email" required />
              <v-text-field v-model="password" :label="$t('login.password')" type="password" required />
              <v-alert v-if="error" type="error" density="compact" class="mb-4">{{ $t('login.error') }}</v-alert>
              <v-btn type="submit" color="primary" block :loading="loading">{{ $t('login.submit') }}</v-btn>
            </form>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const email = ref('');
const password = ref('');
const error = ref(false);
const loading = ref(false);
const auth = useAuthStore();
const router = useRouter();

async function handleSubmit() {
  error.value = false;
  loading.value = true;
  try {
    await auth.login(email.value, password.value);
    router.push({ name: 'home' });
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}
</script>
```

`frontend/src/views/HomeView.vue`:

```vue
<template>
  <v-container>
    <h1>{{ $t('home.welcome', { name: auth.currentUser?.fullName }) }}</h1>
  </v-container>
</template>

<script setup lang="ts">
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
</script>
```

`frontend/src/router/index.ts`:

```ts
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import LoginView from '../views/LoginView.vue';
import HomeView from '../views/HomeView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/',
      meta: { requiresAuth: true },
      children: [{ path: '', name: 'home', component: HomeView }],
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

Note: the `/` route currently has no `component`, only `children` — Task 9 adds `AppShell.vue` as its component so the app shell wraps every authenticated page.

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/src/api frontend/src/stores frontend/src/views/LoginView.vue frontend/src/views/HomeView.vue frontend/src/router frontend/tests/stores frontend/tests/views/LoginView.test.ts
git commit -m "feat(frontend): add auth store, API client, login view, and router guards"
```

---

### Task 9: App shell layout with locale switcher

**Files:**
- Create: `frontend/src/layouts/AppShell.vue`
- Modify: `frontend/src/router/index.ts` (mount `AppShell` as the `/` route's component)
- Test: `frontend/tests/layouts/AppShell.test.ts`

**Interfaces:**
- Consumes: `useAuthStore` (Task 8), Vuetify's `useLocale` composable (configured in Task 7's `plugins/vuetify.ts`), `useI18n` from vue-i18n.
- Produces: locale switching that sets `document.documentElement.dir`/`lang` and both the vue-i18n and Vuetify active locale together — the pattern any later bilingual page relies on.

- [ ] **Step 1: Write the failing test**

`frontend/tests/layouts/AppShell.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../testUtils';
import { useAuthStore } from '../../src/stores/auth';
import AppShell from '../../src/layouts/AppShell.vue';

describe('AppShell', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.documentElement.dir = '';
    document.documentElement.lang = '';
  });

  it('switches document direction to rtl when Arabic is selected', async () => {
    const auth = useAuthStore();
    auth.currentUser = {
      id: '1',
      email: 'a@b.com',
      fullName: 'A B',
      role: 'ADMIN',
      departmentId: null,
      isActive: true,
      locale: 'en',
    };
    auth.token = 'fake-token';

    const wrapper = mountWithPlugins(AppShell, {}, [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
    ]);

    const arButton = wrapper.findAll('button').find((btn) => btn.text() === 'AR');
    expect(arButton).toBeTruthy();
    await arButton!.trigger('click');

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });

  it('logs out and redirects to login on logout click', async () => {
    const auth = useAuthStore();
    auth.currentUser = {
      id: '1',
      email: 'a@b.com',
      fullName: 'A B',
      role: 'ADMIN',
      departmentId: null,
      isActive: true,
      locale: 'en',
    };
    auth.token = 'fake-token';

    const wrapper = mountWithPlugins(AppShell, {}, [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
    ]);

    await wrapper.find('[data-testid="user-menu-activator"]').trigger('click');
    await wrapper.find('[data-testid="logout-item"]').trigger('click');

    expect(auth.isAuthenticated).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `Cannot find module '../../src/layouts/AppShell.vue'`.

- [ ] **Step 3: Implement AppShell.vue**

`frontend/src/layouts/AppShell.vue`:

```vue
<template>
  <v-app>
    <v-navigation-drawer permanent>
      <v-list>
        <v-list-item :title="$t('nav.home')" :to="{ name: 'home' }" />
        <v-list-item v-if="isAdmin" :title="$t('nav.users')" :to="{ name: 'users' }" />
        <v-list-item v-if="isAdmin" :title="$t('nav.departments')" :to="{ name: 'departments' }" />
      </v-list>
    </v-navigation-drawer>

    <v-app-bar>
      <v-app-bar-title>AzmCRM</v-app-bar-title>
      <v-spacer />
      <v-btn-toggle :model-value="currentLocale" mandatory density="compact" class="mr-4">
        <v-btn value="en" @click="setLocale('en')">EN</v-btn>
        <v-btn value="ar" @click="setLocale('ar')">AR</v-btn>
      </v-btn-toggle>
      <v-menu>
        <template #activator="{ props }">
          <v-btn v-bind="props" data-testid="user-menu-activator">{{ auth.currentUser?.fullName }}</v-btn>
        </template>
        <v-list>
          <v-list-item :title="$t('nav.logout')" data-testid="logout-item" @click="handleLogout" />
        </v-list>
      </v-menu>
    </v-app-bar>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLocale } from 'vuetify';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const { locale: i18nLocale } = useI18n();
const { current: vuetifyLocale } = useLocale();

const currentLocale = ref(auth.currentUser?.locale === 'ar' ? 'ar' : 'en');

function setLocale(value: 'en' | 'ar') {
  currentLocale.value = value;
  i18nLocale.value = value;
  vuetifyLocale.value = value;
  document.documentElement.dir = value === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = value;
}

function handleLogout() {
  auth.logout();
  router.push({ name: 'login' });
}
</script>
```

Update `frontend/src/router/index.ts` to use `AppShell` as the `/` route's component:

```ts
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import LoginView from '../views/LoginView.vue';
import HomeView from '../views/HomeView.vue';
import AppShell from '../layouts/AppShell.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/',
      component: AppShell,
      meta: { requiresAuth: true },
      children: [{ path: '', name: 'home', component: HomeView }],
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

Note: the `users` and `departments` named routes referenced in `AppShell.vue`'s nav items don't exist until Tasks 10–11. That's fine — `v-list-item :to` only resolves when clicked/rendered against the active router, and this task's own test only exercises the locale switcher and logout, not those links.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/layouts frontend/src/router/index.ts frontend/tests/layouts
git commit -m "feat(frontend): add app shell layout with bilingual/RTL locale switcher"
```

---

### Task 10: User management UI (Admin)

**Files:**
- Create: `frontend/src/api/users.ts`
- Create: `frontend/src/api/departments.ts`
- Create: `frontend/src/views/users/UserListView.vue`
- Modify: `frontend/src/router/index.ts` (add the `users` route, `meta: { roles: ['ADMIN'] }`)
- Test: `frontend/tests/views/users/UserListView.test.ts`

**Interfaces:**
- Consumes: `apiClient` (Task 8).
- Produces: `ApiUser` type and `fetchUsers`, `createUser`, `updateUser`, `deactivateUser` (`frontend/src/api/users.ts`); `ApiDepartment` type and `fetchDepartments` (`frontend/src/api/departments.ts`, extended in Task 11 with `createDepartment`/`updateDepartment`).

- [ ] **Step 1: Write the failing test**

`frontend/tests/views/users/UserListView.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/users', () => ({
  fetchUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deactivateUser: vi.fn(),
}));
vi.mock('../../../src/api/departments', () => ({
  fetchDepartments: vi.fn(),
}));

import { fetchUsers } from '../../../src/api/users';
import { fetchDepartments } from '../../../src/api/departments';
import UserListView from '../../../src/views/users/UserListView.vue';

describe('UserListView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchUsers).mockResolvedValue([
      { id: '1', email: 'a@b.com', fullName: 'Alice Bee', role: 'AGENT', departmentId: null, isActive: true, locale: 'en' },
    ]);
    vi.mocked(fetchDepartments).mockResolvedValue([]);
  });

  it('renders fetched users', async () => {
    const wrapper = mountWithPlugins(UserListView);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Alice Bee');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `Cannot find module '../../../src/api/users'`.

- [ ] **Step 3: Implement the API modules and the view**

`frontend/src/api/users.ts`:

```ts
import { apiClient } from './client';

export interface ApiUser {
  id: string;
  email: string;
  fullName: string;
  role: 'AGENT' | 'SUPERVISOR' | 'ADMIN';
  departmentId: string | null;
  isActive: boolean;
  locale: string;
}

export async function fetchUsers(): Promise<ApiUser[]> {
  const res = await apiClient.get('/users');
  return res.data;
}

export async function createUser(data: {
  email: string;
  password: string;
  fullName: string;
  role: ApiUser['role'];
  departmentId?: string | null;
}): Promise<ApiUser> {
  const res = await apiClient.post('/users', data);
  return res.data;
}

export async function updateUser(
  id: string,
  data: Partial<{ fullName: string; role: ApiUser['role']; departmentId: string | null }>
): Promise<ApiUser> {
  const res = await apiClient.patch(`/users/${id}`, data);
  return res.data;
}

export async function deactivateUser(id: string): Promise<ApiUser> {
  const res = await apiClient.post(`/users/${id}/deactivate`);
  return res.data;
}
```

`frontend/src/api/departments.ts`:

```ts
import { apiClient } from './client';

export interface ApiDepartment {
  id: string;
  nameEn: string;
  nameAr: string;
}

export async function fetchDepartments(): Promise<ApiDepartment[]> {
  const res = await apiClient.get('/departments');
  return res.data;
}
```

`frontend/src/views/users/UserListView.vue`:

```vue
<template>
  <v-container>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1>{{ $t('users.title') }}</h1>
      <v-btn color="primary" @click="openCreate">{{ $t('users.create') }}</v-btn>
    </div>

    <v-data-table :items="users" :headers="headers">
      <template #item.isActive="{ item }">
        <v-chip :color="item.isActive ? 'success' : undefined">
          {{ item.isActive ? $t('users.active') : $t('users.deactivate') }}
        </v-chip>
      </template>
      <template #item.actions="{ item }">
        <v-btn size="small" variant="text" @click="openEdit(item)">Edit</v-btn>
        <v-btn v-if="item.isActive" size="small" variant="text" @click="handleDeactivate(item.id)">
          {{ $t('users.deactivate') }}
        </v-btn>
      </template>
    </v-data-table>

    <v-dialog v-model="dialogOpen" max-width="480">
      <v-card :title="editingId ? 'Edit user' : $t('users.create')">
        <v-card-text>
          <form @submit.prevent="submit">
            <v-text-field v-model="form.email" :label="$t('users.email')" :disabled="!!editingId" />
            <v-text-field v-if="!editingId" v-model="form.password" label="Password" type="password" />
            <v-text-field v-model="form.fullName" :label="$t('users.fullName')" />
            <v-select v-model="form.role" :items="roles" :label="$t('users.role')" />
            <v-select
              v-model="form.departmentId"
              :items="departments"
              item-title="nameEn"
              item-value="id"
              :label="$t('users.department')"
              clearable
            />
            <v-btn type="submit" color="primary">Save</v-btn>
          </form>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { fetchUsers, createUser, updateUser, deactivateUser, type ApiUser } from '../../api/users';
import { fetchDepartments, type ApiDepartment } from '../../api/departments';

const users = ref<ApiUser[]>([]);
const departments = ref<ApiDepartment[]>([]);
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const roles: ApiUser['role'][] = ['AGENT', 'SUPERVISOR', 'ADMIN'];

const headers = [
  { title: 'Email', key: 'email' },
  { title: 'Name', key: 'fullName' },
  { title: 'Role', key: 'role' },
  { title: 'Status', key: 'isActive' },
  { title: '', key: 'actions', sortable: false },
];

const form = reactive({
  email: '',
  password: '',
  fullName: '',
  role: 'AGENT' as ApiUser['role'],
  departmentId: null as string | null,
});

async function load() {
  [users.value, departments.value] = await Promise.all([fetchUsers(), fetchDepartments()]);
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, { email: '', password: '', fullName: '', role: 'AGENT', departmentId: null });
  dialogOpen.value = true;
}

function openEdit(item: ApiUser) {
  editingId.value = item.id;
  Object.assign(form, { email: item.email, password: '', fullName: item.fullName, role: item.role, departmentId: item.departmentId });
  dialogOpen.value = true;
}

async function submit() {
  if (editingId.value) {
    await updateUser(editingId.value, { fullName: form.fullName, role: form.role, departmentId: form.departmentId });
  } else {
    await createUser({ email: form.email, password: form.password, fullName: form.fullName, role: form.role, departmentId: form.departmentId });
  }
  dialogOpen.value = false;
  await load();
}

async function handleDeactivate(id: string) {
  await deactivateUser(id);
  await load();
}

onMounted(load);
</script>
```

Update `frontend/src/router/index.ts` to add the `users` route:

```ts
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import LoginView from '../views/LoginView.vue';
import HomeView from '../views/HomeView.vue';
import AppShell from '../layouts/AppShell.vue';
import UserListView from '../views/users/UserListView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/',
      component: AppShell,
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'home', component: HomeView },
        { path: 'users', name: 'users', component: UserListView, meta: { roles: ['ADMIN'] } },
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/users.ts frontend/src/api/departments.ts frontend/src/views/users frontend/src/router/index.ts frontend/tests/views/users
git commit -m "feat(frontend): add admin user management UI"
```

---

### Task 11: Department management UI (Admin)

**Files:**
- Modify: `frontend/src/api/departments.ts` (add `createDepartment`, `updateDepartment`)
- Create: `frontend/src/views/departments/DepartmentListView.vue`
- Modify: `frontend/src/router/index.ts` (add the `departments` route, `meta: { roles: ['ADMIN'] }`)
- Test: `frontend/tests/views/departments/DepartmentListView.test.ts`

**Interfaces:**
- Consumes: `ApiDepartment`, `fetchDepartments` (Task 10).
- Produces: `createDepartment`, `updateDepartment` in `frontend/src/api/departments.ts`. This is the last task in the Foundation phase — after this, `npm run dev` in both `/backend` and `/frontend` gives a working login → app shell → user/department management flow in English and Arabic.

- [ ] **Step 1: Write the failing test**

`frontend/tests/views/departments/DepartmentListView.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/departments', () => ({
  fetchDepartments: vi.fn(),
  createDepartment: vi.fn(),
  updateDepartment: vi.fn(),
}));

import { fetchDepartments } from '../../../src/api/departments';
import DepartmentListView from '../../../src/views/departments/DepartmentListView.vue';

describe('DepartmentListView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchDepartments).mockResolvedValue([{ id: '1', nameEn: 'Support', nameAr: 'الدعم' }]);
  });

  it('renders fetched departments', async () => {
    const wrapper = mountWithPlugins(DepartmentListView);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Support');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `Cannot find module '../../../src/views/departments/DepartmentListView.vue'`.

- [ ] **Step 3: Implement the API additions and the view**

`frontend/src/api/departments.ts` (full file, replacing Task 10's version):

```ts
import { apiClient } from './client';

export interface ApiDepartment {
  id: string;
  nameEn: string;
  nameAr: string;
}

export async function fetchDepartments(): Promise<ApiDepartment[]> {
  const res = await apiClient.get('/departments');
  return res.data;
}

export async function createDepartment(data: { nameEn: string; nameAr: string }): Promise<ApiDepartment> {
  const res = await apiClient.post('/departments', data);
  return res.data;
}

export async function updateDepartment(
  id: string,
  data: Partial<{ nameEn: string; nameAr: string }>
): Promise<ApiDepartment> {
  const res = await apiClient.patch(`/departments/${id}`, data);
  return res.data;
}
```

`frontend/src/views/departments/DepartmentListView.vue`:

```vue
<template>
  <v-container>
    <div class="d-flex justify-space-between align-center mb-4">
      <h1>{{ $t('departments.title') }}</h1>
      <v-btn color="primary" @click="openCreate">{{ $t('departments.create') }}</v-btn>
    </div>

    <v-data-table :items="departments" :headers="headers">
      <template #item.actions="{ item }">
        <v-btn size="small" variant="text" @click="openEdit(item)">Edit</v-btn>
      </template>
    </v-data-table>

    <v-dialog v-model="dialogOpen" max-width="480">
      <v-card :title="editingId ? 'Edit department' : $t('departments.create')">
        <v-card-text>
          <form @submit.prevent="submit">
            <v-text-field v-model="form.nameEn" :label="$t('departments.nameEn')" />
            <v-text-field v-model="form.nameAr" :label="$t('departments.nameAr')" />
            <v-btn type="submit" color="primary">Save</v-btn>
          </form>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { fetchDepartments, createDepartment, updateDepartment, type ApiDepartment } from '../../api/departments';

const departments = ref<ApiDepartment[]>([]);
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);

const headers = [
  { title: 'Name (EN)', key: 'nameEn' },
  { title: 'Name (AR)', key: 'nameAr' },
  { title: '', key: 'actions', sortable: false },
];

const form = reactive({ nameEn: '', nameAr: '' });

async function load() {
  departments.value = await fetchDepartments();
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, { nameEn: '', nameAr: '' });
  dialogOpen.value = true;
}

function openEdit(item: ApiDepartment) {
  editingId.value = item.id;
  Object.assign(form, { nameEn: item.nameEn, nameAr: item.nameAr });
  dialogOpen.value = true;
}

async function submit() {
  if (editingId.value) {
    await updateDepartment(editingId.value, { nameEn: form.nameEn, nameAr: form.nameAr });
  } else {
    await createDepartment({ nameEn: form.nameEn, nameAr: form.nameAr });
  }
  dialogOpen.value = false;
  await load();
}

onMounted(load);
</script>
```

Update `frontend/src/router/index.ts` to add the `departments` route:

```ts
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import LoginView from '../views/LoginView.vue';
import HomeView from '../views/HomeView.vue';
import AppShell from '../layouts/AppShell.vue';
import UserListView from '../views/users/UserListView.vue';
import DepartmentListView from '../views/departments/DepartmentListView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/',
      component: AppShell,
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'home', component: HomeView },
        { path: 'users', name: 'users', component: UserListView, meta: { roles: ['ADMIN'] } },
        { path: 'departments', name: 'departments', component: DepartmentListView, meta: { roles: ['ADMIN'] } },
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 5: Manual end-to-end check**

With `backend/.env` pointing at your dev database (migrated + seeded per Task 1) and `frontend/.env` set:

```bash
cd backend && npm run dev
```

In a second terminal:

```bash
cd frontend && npm run dev
```

Open the printed frontend URL, log in with your seeded `ADMIN_EMAIL`/`ADMIN_PASSWORD`, confirm you land on the Home view, can navigate to Users and Departments, create a department, create a user assigned to it, and that switching to AR flips the layout to RTL.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/departments.ts frontend/src/views/departments frontend/src/router/index.ts frontend/tests/views/departments
git commit -m "feat(frontend): add admin department management UI"
```

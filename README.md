# AzmCRM — Customer Support CRM

AzmCRM is a bilingual (Arabic/English, RTL-aware) Customer Support CRM built for internal use at a single organization. The project features a structured layered monolith architecture designed to scale across customer management, ticket management, agent dashboards, and automatic SLA systems.

## 🛠️ Tech Stack

* **Backend**: Node.js, Express, TypeScript, Prisma ORM, PostgreSQL.
* **Frontend**: Vue 3, Vite, Vuetify 3 (Material Design), Pinia, Vue Router, vue-i18n.
* **Testing**: Vitest, Supertest (for integration testing).

---

## 📂 Project Structure

```text
/backend      # Express + TypeScript Monolith API
  ├── prisma/  # Database schemas, migrations, and seeds
  ├── src/     # Controllers, Services, Middlewares, and Routes
  └── tests/   # Integration & unit test suites
/frontend     # Vue 3 + Vuetify + TypeScript Vite SPA
  ├── src/     # Pinia stores, router, views, components, and locale setup
  └── public/  # Static assets
/docs         # System design specifications and roadmap
users.md      # Seeded test account credentials
```

---

## 🚀 Running the App Locally

### Prerequisites
* **Node.js**: v18.x or higher
* **npm**: v9.x or higher
* **PostgreSQL**: A running local or remote instance (or Docker)

### 1. Database Setup
Ensure you have a PostgreSQL server running and database(s) created for both development (`azmcrm`) and testing (`azmcrm_test`).

### 2. Backend Setup
1. Open a terminal in the `/backend` directory.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file by copying the template:
   ```bash
   cp .env.example .env
   ```
4. Update the environment variables in `.env` with your PostgreSQL credentials and a secure `JWT_SECRET`.
5. Run the Prisma migrations to set up database tables:
   ```bash
   npx prisma migrate dev
   ```
6. Seed the database with default accounts:
   ```bash
   npm run prisma:seed
   ```
7. Start the development server:
   ```bash
   npm run dev
   ```
   The backend will be running at `http://localhost:4000`.

### 3. Frontend Setup
1. Open a terminal in the `/frontend` directory.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file (optional, defaults to `http://localhost:4000/api`):
   ```bash
   cp .env.example .env
   ```
4. Start the Vite development server:
   ```bash
   npm run dev
   ```
   The frontend will be running at the URL displayed in the terminal (usually `http://localhost:5173`).

---

## 🧪 Running Tests

Both backend and frontend contain comprehensive test suites using **Vitest**.

### Backend Integration Tests
To run backend integration tests against the test database:
1. Ensure your `.env.test` file is configured correctly (defaults to using the `azmcrm_test` database).
2. Inside `/backend`, run:
   ```bash
   npm run test
   ```

### Frontend Component Tests
To run component and route guard tests:
1. Inside `/frontend`, run:
   ```bash
   npm run test
   ```

---

## 📦 Deployment Guide

To deploy AzmCRM to a production environment, follow these steps:

### 1. Database Migration (Production)
Run Prisma migrations against your production database instance. Do **not** use `migrate dev` in production; instead, use:
```bash
npx prisma migrate deploy
```

### 2. Deploying the Backend
1. Build the TypeScript application:
   ```bash
   npm run build
   ```
   This compiles the backend code into the `/backend/dist` directory.
2. Configure your production environment variables (e.g., in your hosting provider's panel or via system environment variables) matching `.env.example`. Make sure `NODE_ENV` is set to `production`.
3. Start the node server:
   ```bash
   npm run start
   ```
   For production process management, it is recommended to run the app using a process manager like **PM2**:
   ```bash
   pm2 start dist/index.js --name "azmcrm-backend"
   ```

### 3. Deploying the Frontend
1. Build the frontend assets:
   ```bash
   npm run build
   ```
   This compiles the Vue 3 application into static files (HTML, CSS, JS) inside the `/frontend/dist` directory.
2. Host the contents of `/frontend/dist` on a static web host or CDN (e.g., Nginx, Netlify, Vercel, AWS S3, or Cloudflare Pages).
3. If using Nginx, ensure it is configured to route all unknown requests to `index.html` to support Vue Router history mode:
   ```nginx
   server {
       listen 80;
       server_name crm.yourcompany.com;
       root /var/www/azmcrm/frontend/dist;
       index index.html;

       location / {
           try_files $uri $uri/ /index.html;
       }

       location /api {
           proxy_pass http://localhost:4000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

---

## 🧩 Embeddable Ticket Widget

AzmCRM ships a small, embeddable widget that lets anyone submit a support ticket from an external website — no AzmCRM account required. Add this to any page:

```html
<script
  src="https://your-azmcrm-domain.com/widget-embed.js"
  data-origin="https://your-azmcrm-domain.com"
  data-locale="en"
></script>
```

**Attributes:**

| Attribute | Required | Description |
|---|---|---|
| `data-origin` | Yes | The full origin (scheme + host, no trailing slash) where AzmCRM is hosted. The script logs a console error and does nothing if this is omitted. |
| `data-locale` | No | `en` (default) or `ar`. Controls the widget's language and text direction. |
| `data-container` | No | The `id` of an element to mount the iframe into. If omitted, the iframe is inserted immediately after the `<script>` tag. |

The widget POSTs to the unauthenticated, rate-limited (5 submissions per 15 minutes per IP) `/api/public/tickets` endpoint and shows the submitter a short reference code on success.

### Deployment note: framing policy

Because this app is now expected to be embedded in an iframe on third-party sites, your reverse proxy or hosting configuration must **not** apply a blanket `X-Frame-Options: DENY` or `frame-ancestors 'none'` — that would block the widget everywhere it's embedded. Apply a permissive framing policy only on the `/widget/embed` route and keep the rest of the app restrictive. If you run behind a reverse proxy, also set Express's `app.set('trust proxy', ...)` so the public endpoint's rate limiting attributes requests to the real client IP rather than the proxy's.

---

## 🔑 Seeded Accounts
Please refer to the [`users.md`](file:///c:/Users/moham/Desktop/AzmCRM/users.md) file at the root of the workspace for pre-configured Super Admin and Agent credentials.

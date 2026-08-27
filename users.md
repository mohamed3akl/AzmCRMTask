# AzmCRM — Seeded User Accounts

The following system accounts have been successfully created in the local PostgreSQL database for testing and administrative use.

## 👥 Accounts Reference

### 1. Super Admin Account
* **Full Name:** Super Admin
* **Email:** `admin@azmcrm.local`
* **Password:** `SuperAdminPassword123!`
* **Role:** `ADMIN`
* **Department:** None (Global Access)
* **Status:** Active
* **Preferred Locale:** English (`en`)
* **Access Level:** Full administrative privileges, including user management, department management, and ticket category configuration.

---

### 2. Support Agent Account
* **Full Name:** Support Agent
* **Email:** `agent@azmcrm.local`
* **Password:** `SupportAgentPassword123!`
* **Role:** `AGENT`
* **Department:** `Customer Support` (الدعم الفني)
* **Status:** Active
* **Preferred Locale:** English (`en`)
* **Access Level:** Standard support agent access, including ticket listing, detailed view, adding ticket notes, and claiming/releasing ticket assignments.

---

## 🛠️ Verification & Database Details
The accounts have been verified as active in the PostgreSQL database with passwords encrypted using `bcrypt` hashes.

### Department Created
* **Name (EN):** Customer Support
* **Name (AR):** الدعم الفني
* **ID:** Associated with the Support Agent account.

## 🚀 How to Log In
1. Start the backend server (`npm run dev` in `/backend`).
2. Start the frontend development server (`npm run dev` in `/frontend`).
3. Open the frontend login page.
4. Log in using the email and password credentials provided above.

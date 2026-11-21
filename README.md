# Frontdesk — Arvo Systems Support Desk

A full-stack support-ticket workspace for support agents. The app includes JWT authentication, ticket management, atomic claiming, private team notes, audit history, and working-hours SLA tracking.

## Stack
- Frontend: React 18, Vite, React Router, Axios, Tailwind CSS
- Backend: Node.js 20+, Express, PostgreSQL (`pg`)
- Authentication: bcrypt password hashes + 12-hour JWTs

## Features
- Agent login and authenticated API routes
- Dashboard and searchable/filterable ticket listing
- Create tickets, change priority/status, and claim tickets atomically
- Public replies and agent-only internal notes
- Append-only audit log enforced by PostgreSQL UPDATE/DELETE triggers
- SLA due dates and overdue indicators on dashboard/list/detail
- SLA pauses while status is `WAITING_CUSTOMER`; paused working time is added back on resume
- Daily maintenance endpoint closes tickets after five working days waiting for a customer
- Reopen resolved tickets within five working days
- Configurable public holidays in the `holidays` table

## Business rules and explicit assumptions
The assignment defines working hours as Monday–Friday, 09:30–18:30, with weekends and configured festival holidays excluded. The server is started with `TZ=Asia/Kolkata`, so business-hour calculations use India local time.

| Priority | First response target | Resolution target |
|---|---:|---|
| Urgent | 2 working hours | End of the same working day |
| Medium | Half a working day (4.5 working hours) | 3 working days |
| Small | 1 working day | 5 working days |

The brief does not define exact durations for “about three days” and “about one week”; these are interpreted as three and five working days.

**Priority changed mid-ticket:** the brief explicitly leaves this unanswered. This implementation resets the *unmet* response target and the resolution target from the time of the priority change using the new priority. If the ticket is waiting on the customer, the pause restarts at the priority-change time so the new target is not extended by time that elapsed before the change. This is a deliberate, documented product decision.

**Waiting on customer:** SLA time is paused only while the ticket is in `WAITING_CUSTOMER`. The daily maintenance endpoint closes a waiting ticket after five working days (45 business hours) from its current waiting period. It must be scheduled; the app does not run a background scheduler itself.

**Reopening:** allowed for five working days after resolution, interpreted as “about one week”.

**Holiday calendar:** the code excludes dates present in `holidays`. Populate this table with the actual Arvo festival-holiday calendar; only the sample Christmas date is seeded by default.

## Local setup

Requirements: Node.js 20+, npm, PostgreSQL 14+.

### 1. Database and backend

Create a PostgreSQL database called `frontdesk`, then:

```bash
cd backend
cp .env.example .env
```

Set these values in `backend/.env`:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — long, random secret (do not use the example value in production)
- `MAINTENANCE_SECRET` — another long, random secret
- `CORS_ORIGIN` — frontend origin (comma-separated origins are supported)

Then run:

```bash
npm install
npm run db:setup
npm run seed
npm run dev
```

Backend health check: `http://localhost:5000/api/health`

Seeded local demo agent:
- Email: `agent@frontdesk.local`
- Password: `Frontdesk123!`

Change/remove this demo account before exposing the app publicly.

### 2. Frontend

In another terminal:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`. Set `VITE_API_URL` to the backend API base URL if it is not `http://localhost:5000/api`.

### 3. Tests and production build

```bash
cd backend
npm test
```

```bash
cd frontend
npm install
npm run build
```

## Deployment

The assignment requires a live URL and asks that it remain available for one week. This repository is prepared for a separate frontend and backend deployment; deployment itself requires access to your hosting and database accounts.

### PostgreSQL
Create a managed PostgreSQL database (for example, Neon or Render PostgreSQL). Copy its connection string into the backend `DATABASE_URL`. Ensure the provider's SSL requirements are met.

### Backend (Render example)
- Create a Web Service from this repository.
- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm start`
- Environment variables: `DATABASE_URL`, `JWT_SECRET`, `MAINTENANCE_SECRET`, `CORS_ORIGIN` (your deployed frontend origin), `NODE_ENV=production`
- Run `npm run db:setup` and `npm run seed` once from the service shell, or execute `backend/sql/schema.sql` and the seed operations in the database console.
- Verify `https://YOUR-BACKEND/api/health`.

### Frontend (Vercel example)
- Import the same repository.
- Root directory: `frontend`
- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: `VITE_API_URL=https://YOUR-BACKEND/api`
- After deploying, set backend `CORS_ORIGIN` to the exact frontend origin.

### Required daily maintenance schedule
Configure a daily cron job (for example, a scheduled GitHub Action or hosting cron) to call:

```bash
curl -X POST "https://YOUR-BACKEND/api/maintenance/close-stale" \
  -H "x-maintenance-secret: YOUR_MAINTENANCE_SECRET"
```

Run it once per day. The endpoint is protected by the maintenance secret and uses the working-day calendar.

## Security notes
- Passwords are stored as bcrypt hashes; JWT secret must be unique and private.
- All ticket routes require a valid agent JWT.
- The ticket detail endpoint is agent-only and includes internal notes for that agent workspace. No customer-facing API or export endpoint is implemented; do not reuse this agent endpoint for a customer portal.
- Internal notes are never included in the ticket-list response.
- Audit rows reject UPDATE and DELETE at the database trigger level. For stronger production tamper resistance, use a separate database owner/migration role and grant the application DB role INSERT/SELECT (not UPDATE/DELETE/TRUNCATE) on `audit_logs`; retain logs externally as well.
- Restrict CORS to the deployed frontend origin and rotate demo credentials/secrets before public deployment.

## Remaining limitations
- This is an agent-facing hiring-test MVP, not a customer portal: customer authentication, customer-facing ticket APIs, email delivery, attachments, and role-based admin screens are not included.
- The app's business calendar must be populated with Arvo's complete holiday list.
- Deployment, DNS, managed database provisioning, and the daily cron must be configured in accounts owned by the submitter.

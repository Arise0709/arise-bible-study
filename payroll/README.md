# Arise Payroll

Internal payroll preparation for Arise Church (Decatur, Alabama). Admins enter hours and pay, an approver reviews and approves, the admin exports a review CSV for the payroll provider and reconciles the provider's results, and staff see their own published pay statements.

**What it does not do:** move money, file taxes, calculate withholding, or store Social Security numbers, bank accounts or tax forms. Those stay with the payroll provider. Live money movement and tax filing are locked off in the database.

## Quick start (demo, no accounts needed)

Requires Node.js 20+.

```bash
cd payroll
npm install
cp .env.example .env.local
# put a long random value in APP_SECRET, e.g.:  openssl rand -base64 48
npm run demo          # resets demo data, builds, starts http://localhost:3100
```

The demo runs on an embedded Postgres stored in `payroll/.data/` (same migrations and security rules as Supabase). The sign-in page lists the fictional demo accounts, the shared password, and live MFA codes for admin and approver accounts.

| Account | Role |
|---|---|
| admin@arise-demo.test | Payroll Admin (Dana Whitfield) |
| approver@arise-demo.test | Payroll Approver (Marcus Bell) |
| exec@arise-demo.test | Admin + Approver, for small teams (Ruth Okafor) |
| grace@ / tyrese@ / nathaniel@ / simone@arise-demo.test | Staff: salaried, hourly, clergy, contractor |

### Demo walkthrough
1. **Admin** opens pay run #2 (Nov 9 to 22, 2026, paid Nov 27). Upload `demo/sample-hours.csv`, approve the hours, submit for review.
2. **Approver** sees two review flags (clergy setup, contractor classification). Confirm them, then approve (or return with a reason).
3. **Admin** exports. Two clearly labeled review files: employee payroll and contractor payments.
4. **Admin** records a batch reference (any text), imports `demo/mock-provider-results.csv` (or use the "Download mock provider results" button), and marks the run reconciled.
5. **Staff** sign in and see only their own statements.

## Running on Supabase

1. Create a dedicated Supabase project. In **Project Settings → Database**, copy the connection string (session pooler or direct) and download the SSL certificate.
2. In `.env.local`: `DATABASE_URL=<connection string>`, `DATABASE_CA_CERT=/path/to/prod-ca.crt`, a strong `APP_SECRET`, `APP_URL=https://your-domain`, `DEMO_MODE=false`.
3. `npm run db:migrate` applies `supabase/migrations/*.sql` (you can also use `supabase db push`).
4. Create the first admin (accounts are otherwise invite-only):
   ```bash
   npm run create-admin -- you@arisechurch.org "Your Name"
   ```
   Open the printed link, set a password, and set up MFA. Invite everyone else from **Settings → People and access**.
5. Deploy anywhere that runs Node (Vercel, Render, Fly). Keep it on HTTPS.

Do **not** put the Supabase anon or service_role keys in this app. It connects with the database connection string only.

## Before entering real staff
Read [`docs/CONFIRM-BEFORE-LIVE.md`](docs/CONFIRM-BEFORE-LIVE.md) (also in the app at `/settings/checklist`): worker classification, clergy compensation, overtime, federal and Alabama requirements, provider mapping, and security settings.

## How security works
- **Invite-only sign-in.** Passwords hashed with scrypt; 5 failed attempts lock the account for 15 minutes; sessions expire after 60 idle minutes or 12 hours.
- **MFA** (authenticator app, TOTP) required for every admin and approver, with replay protection. Secrets are encrypted with `APP_SECRET`.
- **Server-side authorization.** Every page, action and download checks the role on the server, and every service function checks again.
- **Database access controls.** Each request runs as a limited `payroll_app` role with row level security keyed to the signed-in person. Staff can only read their own record and statements, even if app code had a bug. Tables live in a private `payroll` schema with no Supabase API access.
- **Guard rails in the database.** Hours and earnings can only change while a run is a draft; status changes must follow the workflow; rate history, exports, provider results and the audit log are append-only.
- **Audit trail** of rates, hours, approvals, exports, corrections, settings and access.

## Workflow rules
- Draft → Submitted for Review → Approved → Exported → Reconciled (or Voided, record kept).
- Changing an approved run reopens it as a draft and clears the approval.
- After export, use **Correct or void this run**: a correction run copies the inputs and links to the original, which is never changed.
- Separate approval is on by default. Turning it off allows same-person approval, which is flagged on the run and in the audit log.
- Approval is blocked until an approver clears review flags (unconfirmed classification; unconfirmed clergy provider setup).
- Rates are effective-dated; hourly time uses the rate in effect on each work date, and a mid-period raise exports as one row per rate.

## Tests
```bash
npm test             # calculations, MFA, CSV, permissions and database rules (19 tests)
npm run db:reset && npm run build && npm start   # then in another terminal:
npm run e2e          # full browser walkthrough, 89 checks (needs Playwright: npm i -g playwright && npx playwright install chromium)
```

## Branding
Drop the official logo at `public/brand/arise-logo.svg` (or `.png`) and it replaces the text wordmark.

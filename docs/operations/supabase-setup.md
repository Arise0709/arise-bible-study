# Setting up accounts and sync (Supabase) for Carter Study Bible

Follow these steps once. Do them for a **Preview** deployment first; production comes only after the preview
checks pass and the owner approves. Never paste keys into chat, issues, or code.

## 1. Create the project

1. supabase.com > New project. Name `carter-study-bible`, region US East, Pro plan. Save the database password
   in a password manager.
2. Project Settings > API: note the **Project URL**, the **anon public** key, and the **service_role** key
   (secret: server only).

## 2. Create the tables and security rules

SQL Editor > New query. Paste and run, in order:

1. `supabase/migrations/20261102000100_cycle6_sync.sql`
2. `supabase/migrations/20261102000200_cycle6_mfa_required.sql`

Then Table Editor: `user_records`, `user_record_history`, `profiles`, `audit_events` should each show
"RLS enabled".

## 3. Sign-in settings (Authentication)

- **URL configuration**: Site URL `https://www.carterstudybible.app`. Redirect URLs: add
  `https://www.carterstudybible.app/account` and your preview URL pattern, e.g.
  `https://arise-bible-study-*-joeydcarter2-4984s-projects.vercel.app/account`.
- **Providers > Email**: enabled, "Confirm email" on, minimum password length 10.
- **Multi-factor**: TOTP (authenticator app) enabled.
- **Emails (SMTP)**: use Resend (Settings > SMTP in Resend gives host, port, user, password). Sender
  `no-reply@carterstudybible.app`. Add Resend's DNS records for the domain first.
- **Rate limits**: keep the defaults.

## 4. Vercel environment variables

Vercel > Project > Settings > Environment Variables. Add for **Preview** (branch `kaizen/cycle-6.1`) only:

| Name | Value | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | Project URL | Public, built into the app |
| `VITE_SUPABASE_ANON_KEY` | anon public key | Public by design; the security rules protect data |
| `SUPABASE_URL` | Project URL | Server functions |
| `SUPABASE_ANON_KEY` | anon public key | Server functions |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | **Secret.** Used only by `api/account` to delete an account |

Then Deployments > the latest `kaizen/cycle-6.1` preview > Redeploy.

## 5. Preview checks (about 20 minutes, two devices)

1. On a laptop with existing notes: Account icon > Create an account (13+). Confirm via the email.
2. The "Bring this device's study data into your account" panel appears. Download the backup, then
   Combine. It should say all items are confirmed, then "Synced".
3. On your phone: sign in. Your notes and sermons appear.
4. Edit a note on the phone; within a minute (or Sync now) it appears on the laptop.
5. Turn on airplane mode on both, edit the same sermon differently on each, reconnect the phone, then the laptop.
   The laptop shows "Conflict detected"; the Account page shows both versions. Choose "Keep both".
6. Turn on two-step sign-in, sign out, sign back in: the app asks for the 6-digit code.
7. Forgot password: the email arrives and lets you set a new one.
8. Sign out: everything stays on the device and the Bible works as before.

## 6. Production

Only after the owner approves: add the same five variables for Production, redeploy, and confirm the backup
retention period in Database > Backups (record it in `backup-and-recovery.md`).

To switch accounts off at any time, remove `VITE_SUPABASE_URL` and redeploy; every device keeps its local copy.

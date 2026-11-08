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

## 7. Release 6.2: church workspaces

Do these for the **Preview** first, as in sections 2 to 5. Production only after the owner approves.

1. **Database.** SQL Editor > New query. Paste and run `supabase/migrations/20261108000100_r62_orgs.sql`.
   Then run this check. It should show `28`, `33`, and `0`:

   ```sql
   select (select count(*) from pg_tables where schemaname = 'public' and (tablename = 'orgs' or tablename like 'org\_%')) as tables,
          (select count(*) from pg_policies where schemaname = 'public' and (tablename = 'orgs' or tablename like 'org\_%')) as read_rules,
          (select count(*) from pg_tables where schemaname = 'public' and (tablename = 'orgs' or tablename like 'org\_%') and not rowsecurity) as tables_without_rules;
   ```

2. **Invitation emails (Resend).** Resend > API Keys > Create API key. Name `carter-study-bible-invites`,
   permission **Sending access**, domain `carterstudybible.app`. Copy the key once (it starts with `re_`).
3. **Vercel.** Settings > Environment Variables > add `RESEND_API_KEY` = that key, type **Secret**, for the same
   environments as the other Supabase settings. Redeploy.
   Without this key, invitations still work: the leader copies the link and sends it themselves.
4. **Preview checks** (two devices, about 15 minutes):
   1. Laptop: Account > Open church workspaces > Create a workspace (18+). It opens with you as Owner.
   2. Settings: add a logo. Invitations: invite your second email as Pastor/Teacher. "Emailed to ..." appears.
   3. Phone: open the email, sign in with that address, review, and accept. The workspace opens as Pastor/Teacher.
   4. Laptop: Members shows the new person with their email; change their role; Activity lists each step.
   5. Open the same invitation link again: it says it was already used.
   6. Laptop: Courses > Add a course > a copy of one of your courses. Edit a lesson, Publish to the workspace.
      Invitations: invite the phone's address into that course. Phone: accept, open the course, write a reflection,
      take the quiz (it is graded by the server), mark the lessons done.
   7. Laptop: the course's Manage page shows the student; grade the reflection; add a session and mark attendance.
      Phone: the feedback appears and the course completes (if attendance was required).
   8. Laptop: Groups > Create a group, prepare a Romans 8 study, assign it. Phone: submit a response. Laptop: the
      response appears under Responses. Turn on discussion, post, report, hide.
   9. Phone: in the Study Workspace, Share a copy of a study with the group; laptop sees it under Shared.
      Post an announcement; the phone shows "(1 new)". Reports shows the numbers; download the spreadsheets.
   10. Phone: My membership > Download my work, then Leave. Notes on the phone are unchanged.

To switch workspaces off without touching accounts, run the undo file
`supabase/migrations/20261108000100_r62_orgs.down.sql` after taking a backup (it deletes workspace data only).

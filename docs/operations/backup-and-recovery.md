# Backup, restore, and recovery (accounts and sync)

This is the runbook for the cloud data added in Kaizen Cycle 6.1. Scripture and reference data are static files
in the repository and on Vercel; they are rebuilt from Git and are not part of these backups.

## What is stored where

| Data | Where | Protected by |
|---|---|---|
| Notes, highlights, bookmarks, studies, sermons, folders, settings, plans, courses, progress | Each device's browser database (the working copy) and, for signed-in people, the `user_records` table | Device backups (Settings), Supabase daily backups, owner's weekly export |
| Earlier versions of long-form records (last 30 each) | `user_record_history` | Same as above |
| Accounts and sign-in factors | Supabase Auth (`auth` schema) | Supabase daily backups |
| Account events (no study content) | `audit_events` | Supabase daily backups |

## Backups

1. **Supabase daily backups** (Pro plan). Confirm the retention period on the project's Database > Backups page
   after creating the project and record it here: `________ days`.
2. **Owner's weekly export** (recommended): from a trusted computer,
   `pg_dump "$DATABASE_URL" -Fc -f csb-$(date +%F).dump` using the connection string from the project's
   Database settings. Store the file encrypted (for example in a password-protected archive) in two places.
3. **People's own exports**: every person can download a device backup and "everything in your account"
   from the Account page at any time. Both are ordinary backup files that restore in Settings.
4. **Before any migration**: the app saves a full copy of a device's data on that device before combining it
   with an account; it can be restored from the Account page.

## Restore drill (tested November 2, 2026, local copy)

1. Take a dump: `pg_dump -Fc -f backup.dump`.
2. Create an empty database and restore: `pg_restore --no-owner -d restore_drill backup.dump`.
3. Compare a checksum of every synced record (user, kind, id, version, data, deleted) between the source and
   the restored database.

Result: 594 synced records for 14 accounts, their sign-in records, and 15 history rows restored with an
identical checksum (`4b80c8fd3e3c069b6f79a7762ca8be49`), and row-level security came back enabled with its
policies. Repeat this drill against a Supabase backup before turning on sync in production, and every
quarter after that.

## Restoring production

- **Point in the past for everyone**: use Supabase's Database > Backups > Restore. All accounts return to that
  moment; devices keep their newer local copies and will offer conflicts or re-send changes on their next sync,
  so nothing typed after the backup is lost on a device that still has it.
- **One person's records**: restore the dump into a separate database, export that person's rows with
  `copy (select * from user_records where user_id = '...') to stdout`, and load them after review. Never
  overwrite newer rows: insert only missing ids, or raise the version and let the person resolve conflicts.

## Schema changes and rollback

- Each change is a numbered file in `supabase/migrations/` with a matching `.down.sql` undo file.
- Apply to a copy first (the local stack in `dev/supabase-local`, or a Supabase branch), run `npm run test:cloud`
  and the cloud tests, then apply to production.
- Undo files that drop tables delete cloud copies: take a dump first. Devices keep their local copies either way.
- Emergency stop for sync: remove `VITE_SUPABASE_URL` from the Vercel project and redeploy. The app returns to
  device-only mode with every local copy intact; the account page then says accounts are not switched on.

## Monitoring

- Supabase: watch Database > Backups for failed backups, Auth > Logs for sign-in errors, and the usage page for
  database size and egress against the plan limits.
- The app reports sync failures to the person on screen; release 6.3 adds an admin health page.

## Account deletion

Deleting an account (Account page, password and typed confirmation) removes the account and, by cascade, every
synced record and history row. The person's device copies are not touched. Supabase's backups keep deleted
data until they expire, as stated in the retention period above.

## Church workspaces (Release 6.2)

### What is stored

| Data | Tables | Who can read it |
|---|---|---|
| Workspaces, members, roles, invitations (token hashes only), ownership transfers | `orgs`, `org_members`, `org_member_contacts`, `org_invitations`, `org_ownership_transfers` | Members see leaders and people they share a group or course with; emails and invitations: administrators |
| Workspace courses, frozen versions, student copies | `org_courses`, `org_course_drafts`, `org_course_versions`, `org_course_releases`, `org_course_instructors` | Drafts and full versions: the course's instructors and administrators; student copies (no answers): enrolled students |
| Enrollment, progress, quiz attempts, written answers and grades, sessions, attendance | `org_enrollments`, `org_lesson_progress`, `org_quiz_attempts`, `org_written_answers`, `org_sessions`, `org_attendance` | The student (their own) and the course's instructors and administrators |
| Groups, studies, responses, discussions, reports | `org_groups`, `org_group_members`, `org_group_studies`, `org_group_responses`, `org_discussion_topics`, `org_discussion_posts`, `org_content_reports` | Group members and leaders; responses only once submitted |
| Shared copies, editors, announcements | `org_shared_resources`, `org_resource_editors`, `org_announcements`, `org_announcement_reads` | The audience chosen by the owner or poster |
| Workspace activity log (no study content) | `org_audit_events` | Owner and administrators |

Personal study data (`user_records`) is separate. No workspace role can read it.

### When someone leaves, is removed, or deletes their account

| Event | Personal study data | Workspace records about them |
|---|---|---|
| Leaves or is removed | Not touched | Kept for the church (enrollments, grades, attendance, submitted responses), shown as a former member. Access ends at once. Shared copies they made stay until they or an administrator withdraw them. |
| Deletes their account | Deleted (as in 6.1) | Their memberships, submitted responses, posts, and shared copies are deleted; course enrollments, grades, and attendance stay with the name removed ("Former member"). Workspaces they owned alone are deleted with the account; an owner of a workspace with other members must transfer ownership first. |
| Workspace deleted by its owner | Not touched | Access ends at once. Records are kept 30 days so the owner can restore it from the Church page. |

Before leaving, a member can download their own work from each course page (and every member's own data stays exportable from the Account page as in 6.1).

**Removing deleted workspaces for good after 30 days** (run monthly from the SQL Editor until the admin page in 6.3 does it):

```sql
delete from public.orgs where deleted_at is not null and purge_after < now();
```

### Restore drill (tested November 8, 2026, local copy)

`pg_dump -Fc`, restore into an empty database with `pg_restore --no-owner`, then compare a checksum over every
workspace table (workspaces, members, enrollments, progress, quiz attempts, written answers, attendance, groups,
responses, shared copies, course versions) plus every personal synced record.

Result: 5 workspaces, 243 members, 1,027 enrollments, 3,507 lesson-progress rows, and 5,120 personal records restored
with an identical checksum (`abfa14cff9596eac9b309056535a9793`); row-level security came back on for all 28 workspace
tables with all 33 read rules.

### Undo

`supabase/migrations/20261108000100_r62_orgs.down.sql` removes every workspace table and function (take a dump
first). Personal study data and 6.1 sync are not affected; it was applied, undone, and reapplied cleanly in testing.

# Kaizen Release 6.2 Completion Report
## Church Workspaces, Group Bible Studies, and Discipleship Administration

Prepared November 8, 2026 for J. Davon Carter.

- **Branch:** `kaizen/release-6.2` (latest commit `45c6572`). All GitHub checks green on every push.
- **Not merged or deployed.** Production is still Release 6.1 (`4c2e56f`).
- **Release 6.3 has not started.**

## Status in one paragraph

Release 6.2 is **built and fully tested against a faithful local copy of Supabase**: its sign-in service, its database, and the same security rules. Testing covered real accounts on laptop and phone screen sizes, and a 200-member workspace. It is **ready for a preview test on your Supabase project**.

It is **not production-ready yet.** Three things can only be checked once the new database file runs on your project and the Resend key is in Vercel: real invitation emails, the hosted service, and your real devices. Until then the live site is unchanged, and the database file adds nothing until it is run.

---

## A. Previous condition

- **Accounts and sync (6.1).** Live and working: personal notes, highlights, studies, sermons, plans, and courses sync across a person's own devices.
- **No church features.** There was no way for a church to gather members, assign roles, or teach together.
- **Courses were one device, one person.** Instructors shared courses by sending a file. A student's progress, quiz scores, and reflections never reached the instructor. Quizzes were graded in the student's browser, with the answers inside the course file. Attendance was a typed name on the instructor's own device, Present or blank.

## B. Architecture changes

**Database (one migration file plus a tested undo file):**
- **28 new tables** for workspaces, members, invitations, ownership transfers, courses and frozen versions, enrollments, progress, quiz attempts, written answers, class sessions, attendance, groups, group studies, responses, discussions, content reports, shared copies, editors, announcements, and an activity log.
- **33 read rules**, with row-level security on every table.
- **About 70 checked database functions.** Role changes, invitations, enrollment, grading, attendance, groups, sharing, and announcements happen only through these. The tables themselves cannot be written directly, except a person's own responses, posts, and read markers, and only in specific columns.

**Personal data is untouched.** The 6.1 tables, the sync functions, the device database version (3), and the backup format (1) are unchanged. No church role has any rule that reaches `user_records`.

**Roles:** Owner, Administrator, Pastor/Teacher, Instructor, Group Leader, Member.
- Course and group access needs an **assignment**, not just a rank. An instructor sees only courses they teach; a leader sees only groups they lead.
- Every check uses the caller's **current** membership, so removing someone ends their access on their very next request.
- Two-step sign-in is respected everywhere.
- **Membership is adults only (18+), by your decision.** Joining records the person's confirmation.

**Server functions (Vercel):**
- **`api/org-invite`:** creates an invitation **as the signed-in leader**, so the database decides whether they may offer that role. It then emails the link through Resend, or returns it to copy. It holds no private key.
- **`api/org-quiz`:** grades church quizzes on the server with **the same grading code the app already uses**, so there is no second quiz engine. It records the attempt with the private key, only after the database has confirmed the student's enrollment and tries left.
- **`api/account`:** now refuses to delete an owner whose workspace has other members until they transfer ownership. A workspace owned alone goes with the account.

**Code changes that support this, with no change in behavior:**
- Quiz grading moved to `src/lib/grading.ts` and the plain data types to `src/db/types.ts`, so the server can share them.
- The course and lesson editors accept a "workspace" mode, so church courses use **the same builder**.

**New settings for production:**
- Run `supabase/migrations/20261108000100_r62_orgs.sql` on the Supabase project.
- Add `RESEND_API_KEY` (Secret) in Vercel.
- Step-by-step instructions are in `docs/operations/supabase-setup.md`, section 7.

## C. Implemented features

**Workspaces**
- **Creating a workspace:** name, type (church, ministry, Bible study group, Christian education), description, city and state, website (https only), logo (shrunk to under 270 KB; PNG, JPEG, or WebP), contact email, time zone, and your name as members see it. Each person can own up to 3.
- **Sections:** Overview, Members, Courses, Groups, Announcements, Shared, Invitations, Reports, Settings, Activity, My membership. Each person sees only the sections their role allows.
- **Switcher and top bar:** a switcher appears for people in more than one workspace. A "Church" icon appears in the top bar only for workspace members; it costs no network request.
- **Members:** search, paging (50 at a time), role changes (only roles below your own), removal, and former members. Plain members see leaders and the people they share a group or course with; email addresses are visible to administrators only.
- **Ownership transfer:** the owner offers it to an administrator, and nothing changes until that person accepts.
- **Deleting a workspace:** you type its name to confirm, everyone loses access at once, and it can be restored for 30 days.
- **My membership:** your display name, the announcement badge setting, exactly what the workspace can and cannot see, a "Download my work" file, and Leave.

**Invitations**
- Sent by email through Resend, and the leader can always copy the link instead.
- The link works once, only for the email it was sent to, and expires (3 to 30 days).
- Leaders can withdraw an invitation or send it again with a new link.
- An invitation can include groups and courses. Group leaders can invite only into groups they lead; instructors only into courses they teach.
- The invitation page shows the workspace, who invited you, the role, and what the workspace can and cannot see. The person then accepts it themselves.

**Courses**
- **Adding a course:** copy one of your own courses (an explicit copy; your personal course is never changed or linked), or start a new one.
- **Editing:** the same builder as personal courses. Edits save to the workspace with a revision check, so two editors never overwrite each other silently.
- **Publishing:** draft, submit for review (optional per workspace), published, or archived. Publishing freezes a version containing only lessons marked Published. Students keep the version they started until they choose to update, and finished work is never changed.
- **Students' copy:** answers, explanations, and instructor notes are removed from it. Quizzes are graded on the server, and answers are shown only if the instructor allows it.
- **Enrollment:** by invitation, by staff, or from the workspace catalog, with enrollment deadlines, finish-by dates, and withdrawal.
- **Student side:** progress, Continue, reflections and assignments saved to the course (also when leaving the page), instructor feedback, and a certificate once complete.
- **Manage page for instructors:**
  - students and their progress, with a spreadsheet download;
  - grading of written answers and written quiz questions, with feedback;
  - class sessions with Present, Absent, Excused, or Late attendance, with a spreadsheet download;
  - the catalog setting, deadlines, instructors, and archiving.
- **Completion** is worked out from saved lessons, required quizzes, and recorded attendance. It is never inferred from app activity.

**Group Bible studies**
- **Groups:** pastors and teachers create them and assign a leader. A group can be private, invitation-only, or listed for the workspace (members ask to join, and the leader approves). Leaders can add co-leaders.
- **Studies:** the leader sets the passage, instructions, questions, commentary notes (quoted with their source), related passages, https research links, and a due date, then assigns or closes it.
- **Members** read the passage, open **Study This Passage** (a private study in their own workspace), save a private draft, and submit.
- **The leader** sees only submitted responses and who has not submitted yet, and can reply with a note.
- **Discussion:** off by default. Leaders start topics, hide posts, and lock or delete topics. Anyone can report a post. There are no private messages anywhere.

**Sharing**
- **"Share a copy"** is in the Study Workspace and the sermon editor. A **Shared** section lists studies, outlines, lessons, Scripture collections, handouts (up to 2 MB), and notes.
- **The share itself:** it goes to the whole workspace or to one group. Workspace-wide shares from members need an administrator's approval.
- **Readers** can save their own copy.
- **Owners** can update the copy from their latest version, invite editors, or withdraw it (deleted for everyone; the original is untouched). Anyone can report a shared item.

**Announcements**
- Workspace, group, and course announcements, with pinned items and an expiry date.
- They appear in the app only and are never emailed. Members see a "new" count, which they can turn off.

**Reports**
- Administrators see the whole workspace; instructors their courses; group leaders their groups.
- **Course reports:** enrollment, completion rate, average lessons done, average best quiz score, written answers and how many are graded, and attendance rate.
- **Group reports:** members, studies assigned, responses submitted, participation, and posts.
- Spreadsheet (CSV) downloads, protected against spreadsheet formula injection.
- Reports never include notes, drafts, sermons, unshared studies, or AI conversations.

## D. Security verification

**174 database security checks** (`e2e/orgs.cjs`) use real accounts and real sign-in tokens against the local Supabase copy, on every GitHub run. All pass. The 14 scenarios the brief requires:

| # | Scenario | Result |
|---|---|---|
| 1 | Church A member cannot read Church B | Blocked |
| 2 | Leader cannot view a group they do not lead | Blocked (in the database and on screen) |
| 3 | Instructor cannot see or grade unrelated students | Blocked |
| 4 | Student cannot change their own grade or quiz score | Blocked (function, direct table write, and direct score insert) |
| 5 | Student cannot make themselves an administrator | Blocked |
| 6 | Administrator cannot take ownership without an accepted transfer | Blocked (role change, self-offer, and direct table write) |
| 7 | Expired invitation | Refused |
| 8 | Revoked or already-used invitation | Refused |
| 9 | Removed member loses access | Immediately, with the same sign-in token |
| 10 | Administrator cannot read private notes, sermons, history, or sync data | Blocked |
| 11 | Changing workspace ids in a request | Returns nothing, changes nothing |
| 12 | Server functions enforce the same rules | Invitation and quiz functions refuse the same people the database does (integration tests) |
| 13 | Shared links do not bypass permission | Knowing an id shows nothing to outsiders |
| 14 | Leaving does not delete private study data | Verified |

**Also verified:**
- **Invitations:** only a hash of the token is stored. A forwarded link fails, and the preview shows a different account nothing. Rate limits apply per leader and per workspace each day.
- **Answer keys:** the student copy contains no answers or instructor notes, and the browser page has no answer key before submitting.
- **Data integrity:** the workspace id on directly written rows always comes from the parent record, never from the request.
- **Two-step sign-in:** with it turned on, a password-only session sees no workspace data.
- **Internal functions** cannot be called by signed-in users.
- **Logos and links:** text is cleaned on input, logos must be images, and websites and research links must be https.

**After the speed work:** the faster read rules (section F) give the same answers as before, and all 174 checks pass unchanged.

**Not done:** an independent penetration test.

## E. Data protection

| Check | Result |
|---|---|
| Upgrade from production 6.1 with real-size data | **31 of 31**: every note, highlight, bookmark, study, sermon, folder, dictionary entry, and setting identical; old backups merge and restore with no losses or duplicates |
| 6.1 sync and accounts | Cloud security and sync 30 of 30; sync, migration, and account integration tests pass; account browser tests 23 of 23 |
| Device database and backup format | Unchanged (version 3, format 1) |
| Restore drill (local copy) | Back up, restore, and checksum over every workspace table plus personal records: **identical** (`abfa14cf...`); row-level security back on all 28 tables with 33 rules |
| Undo | The database file was applied, undone, and reapplied cleanly |
| Leaving, removal, account and workspace deletion | Documented in `docs/operations/backup-and-recovery.md`; members can download their own work first |

## F. Performance results (measured)

**Guest Bible reading:** a cold load of John 3, on slow 4G with a 4x slower CPU, on the same machine, median of 5 runs.

| | Production 6.1 | Release 6.2 |
|---|---|---|
| First chapter | 2,689 ms (2,612 to 2,809) | 2,486 ms (2,416 to 2,787): no slowdown |
| Account or church code downloaded by guests | none | none |

**Bundle and deployment size:**

| Item | Size (compressed) |
|---|---|
| Main app, production settings | 130.78 KB to 131.64 KB (+0.86 KB) |
| Church screens (load only when opened) | 13.3 KB (workspace), 12.1 KB (courses), 10.9 KB (groups), 8.5 KB (sharing) |
| Deployment | 386 MB, unchanged (+196 KB of code before compression) |

**Workspace screens with 200 members, 5 courses, 1,000 enrollments, and 6 groups.** The app is already open; median of 3 runs.

| Screen | Local network | Slow 4G + 4x CPU |
|---|---|---|
| Workspace overview | 95 ms | 927 ms |
| Members (first 50) | 113 ms | 902 ms |
| Courses | 92 ms | 865 ms |
| Reports (whole workspace) | 87 ms | 897 ms |
| Manage: 200 students | 126 ms | 1,867 ms |
| Group study responses | 208 ms | 1,206 ms |
| Student lesson page | 193 ms | 1,379 ms |
| Student group study | 90 ms | 336 ms |

**Problems found by measuring, and fixed:**

| Item | Before | After |
|---|---|---|
| Reports | 13,865 ms (permission checked on every row) | 87 ms (one database call that checks permission once) |
| Member list for a plain member | 1,313 ms | 44 ms (rules look up the caller's courses and people once per query) |
| Manage students | 1,332 ms | 126 ms |
| Invitation limits | 50 a day per leader blocked onboarding a congregation | 100 per leader and 300 per workspace a day |

**Database calls** (local; real internet adds roughly 100 to 300 ms per round trip):
- **Writes:** create or accept an invitation 6 to 9 ms; enroll 7 to 10 ms; mark a lesson done 7 ms; save a reflection 6 ms.
- **Reads:** the workspace report 28 ms; one page of 50 members 14 ms; progress for 200 students 33 ms.
- **6.1 sync** for a church member: 4 ms, no change.

## G. Test results

| Suite | Result |
|---|---|
| Unit and integration tests (including server functions against the local Supabase copy) | 266 of 266 |
| Workspace security checks | 174 of 174 |
| 6.1 cloud security and sync | 30 of 30 |
| Browser: workspaces, invitations, roles, transfer (laptop and phone) | 44 of 44 |
| Browser: courses, grading, attendance, certificate, my-work export | 31 of 31 |
| Browser: Romans 8 group study, discussion, moderation | 27 of 27 |
| Browser: sharing and announcements | 23 of 23 (see the note below) |
| Browser: reports (exact numbers, role limits, spreadsheets) | 12 of 12 |
| Browser: 6.1 accounts and sync | 23 of 23 |
| Browser: whole-app acceptance | 225 of 225 |
| Upgrade from production | 31 of 31 |
| Accessibility (axe-core, WCAG 2.2 A and AA plus best practice): 32 church screens, light and dark, desktop and phone | **0 findings in 128 checks** (the tool was confirmed to catch known errors) |

**Bugs the tests found, all fixed:**
1. Leaving a lesson right after typing could lose the reflection.
2. A database error code made the local server retry one request forever.
3. Publishing included draft lessons, which would have blocked completion.
4. A course page could crash for one moment while loading.
5. The page blanked itself while refreshing its data.
6. After the last lesson, "Mark done" left the student on that lesson instead of the course.
7. Reports and member lists were slow at church scale.
8. The invitation limit was too low to onboard a congregation.

**Note:** in one of 7 local runs, the sharing browser test stopped with an error I could not reproduce. The other 6 local runs and every GitHub run passed. It is most likely a timing issue in the test, but it is not proven.

## H. Remaining issues

**Must happen before production:**
1. Run the database file on your Supabase project and add `RESEND_API_KEY` in Vercel (setup guide, section 7).
2. Run the preview checks on your laptop and phone (setup guide, section 7, about 30 minutes). Real email delivery, the hosted service, and real devices are **not verified** until then.
3. Your approval to merge and deploy.

**Deferred by decision:**
- **Teens in church workspaces.** Adults only in 6.2. Teen participation needs your church's safeguarding policy and a parental-consent step first.
- **Announcement emails.** In the app only.

**Known limits:**
- **Quiz time limits** are shown and enforced in the student's browser. The server records the submission time but does not refuse a late submission.
- **Course editing conflicts:** if two people edit the same course at once, the second is told to reload. There is no word-by-word merge.
- **Shared items** are snapshots. Editors can change notes and Scripture collections directly; for studies, outlines, and lessons, the owner updates the copy from their own version.
- **Deleted workspaces** are removed for good by a monthly SQL command (in the runbook) until the 6.3 admin page does it.
- **Rate limits in the server functions** count per server instance until a shared counter (Upstash, free tier) is added. The database's own daily limits are workspace-wide.
- **Resend's free tier** sends 100 emails a day. Past that, leaders copy the link.

**Not done:** an independent security review or penetration test.

## I. Release 6.3 recommendations (in priority order)

1. **Admin health page.** Counts and errors only, never content: failed syncs, invitation bounces, report queues, storage use, and the monthly workspace purge done for you.
2. **Four-translation comparison** in the reader and Study Workspace. It needs no new infrastructure.
3. **Privacy-safe analytics and the Kaizen dashboard.** Counts of features used, with no personal content and no tracking of individuals.
4. **Teen participation**, once your safeguarding policy and consent step are written: guardian consent, limited profiles, and discussions off for groups with teens.
5. **Server-enforced quiz time limits** and a word-by-word view for course editing conflicts.
6. **Shared rate-limit store (Upstash)** before heavy use, and an independent security review.

# Kaizen Cycle 1 Completion Report
Carter Study Bible (repo: Arise0709/arise-bible-study)
Branch: `kaizen/cycle-1` (pushed, NOT merged, NOT deployed to production)
Date: October 30, 2026

## 1. Summary

All six Cycle 1 items are built, tested, and committed. Your existing data is untouched: the database name, version, and tables are identical, and the backup format is unchanged. An upgrade test created data with the current live version, then opened it with the new version. Every record came through byte-for-byte identical.

| Item | Status | Commit |
|---|---|---|
| C1 Autosave fix + saving indicator | Done | 3e0b4b7 |
| C3 Secure the AI endpoint | Done | 93bfbcb |
| C2 Storage protection, installable app, backup reminders | Done | 3d852e4 |
| M2 Undo for deleted notes, bookmarks, highlights | Done | 0c6cdd6 |
| M3 Safe restore: validate, preview, merge or replace | Done | 2f0301d |
| M6 Automated checks (CI) + private error reporting | Done | 3723c24 |

## 2. Exact changes

### C1. Autosave never drops edits
- Problem confirmed in the audit: typing and then leaving or reloading within about a second lost the edit.
- New shared autosave (`src/lib/autosave.ts`) used by the Study Workspace and the Sermon editor.
  - Saves 0.6 seconds after you stop typing.
  - Saves immediately when you switch tabs, close the page, or navigate away.
  - Keeps an instant safety copy of each unsaved edit in the browser. If the page closes before the database write finishes, the edit is recovered the next time the app opens. It only applies if it is newer than what is saved.
- Status indicator next to the title: "Saving…", "Saved", or "Not saved" with a Retry button.
- Deleting a study or sermon cancels any pending save, so a deleted item cannot reappear.

### C3. AI endpoint secured
- **Access code:** the AI only runs for requests carrying your private code (`AI_ACCESS_CODE`). If the code is not set, the AI stays locked. It fails closed.
- **Code safety:** codes are compared in constant time. Ten wrong codes in an hour lock that visitor out for the hour.
- **Server-enforced limits:**
  - 6 requests per person per minute
  - 60 per day for the whole site
  - Both adjustable with `AI_LIMIT_PER_MINUTE` / `AI_LIMIT_PER_DAY`
- **Shared counters:** counters can be shared across servers through Upstash Redis (optional). Without it, each server instance counts on its own. If the counter store fails, requests are refused, not let through.
- **Request checks:**
  - size caps on requests (200 KB) and on study material (120,000 characters)
  - a 2-minute timeout
  - validation of every field
- **Same-site check:** kept as an extra layer only.
- **Usage logging:** task, sizes, tokens, and time. Never study content.
- **App side:** a Settings field "AI access code" with "Save and check code", and clear messages for locked, no code, wrong code, and limit reached. The code is stored on the device only and is never included in backups.

### C2. Data protection on the device
- **Storage protection:**
  - The app asks the browser to protect its storage once you have data.
  - Settings shows the status and has a "Turn on protection" button.
- **Installable app:**
  - manifest, icons, and Home Screen support
  - Settings shows an Install button, or iPhone/iPad instructions explaining that Home Screen apps are exempt from Safari's 7-day data erase
- **Backup reminders:**
  - A banner appears when you have work and no backup in 7 days, with "Download backup" and "Remind me later" (3 days).
  - Settings shows "Last backup: date (N days ago)".
  - The reminder never appears in Teaching view.
- No cloud sync was added, per your instruction.

### M2. Undo
- Deleting a verse note, removing or changing a highlight, or removing a bookmark (in the reader or in Saved Studies) shows an "Undo" button for 6 seconds.
- Undo restores the exact original item.

### M3. Safe restore
- **Checked before writing:**
  - A file that is not a backup, or is from a newer version, is refused with a clear message, and nothing changes.
  - Damaged items are skipped and counted.
- **Preview:** a table of what is in the backup next to what is on this device.
- **Merge (default):**
  - adds what is missing and keeps the most recently edited copy
  - never deletes anything
  - also fixes an old crash when a verse already had a highlight or bookmark
- **Replace:** requires a confirmation checkbox, and downloads a safety copy of your current data first (on by default).
- **All or nothing:** every restore either completes fully or changes nothing.

### M6. Automated checks and error reporting
- **CI (`.github/workflows/ci.yml`):** every push and pull request runs the type check, unit tests, build, and full browser test suite.
- **Private error reports:**
  - **What is sent:** the error message, a short code location, the page path with ids removed, the build, and the browser family.
  - **What is scrubbed out:** quoted text, emails, ids, and long numbers.
  - **Never sent:** notes, studies, sermons, highlights, or settings.
  - **Limits:** 5 per page load, and 30 per hour per visitor on the server.
  - **Where reports go:** your Vercel function logs only.
  - **Turning it off:** Settings has a "Send anonymous error reports" toggle.
- **Crash screen:** a crash on one page now shows "Your saved notes, studies, and sermons are safe" with a Reload button, instead of a blank screen.

## 3. Tests performed and results

| Check | Result |
|---|---|
| Type check (app + server) | Pass |
| Unit tests | 56 / 56 pass |
| Production build | Pass |
| Full browser test suite (17 sections, Chromium) | 88 / 88 pass |
| Upgrade test: live version data opened by new version | 29 / 29 pass |

New tests this cycle:
- **Autosave:**
  - leave within 100 ms
  - instant reload
  - study notes
  - recovery after close
  - a deleted study stays deleted
- **AI endpoint (11 tests):**
  - locked without a code
  - wrong or right code
  - lockout
  - per-minute and daily limits
  - cross-site refused
  - oversized and malformed requests refused
  - store failure fails closed
- **Backups:**
  - format unchanged
  - damaged items skipped
  - merge keeps the newer copy
  - highlight conflict handled
  - replace keeps device-only settings
  - a failed restore changes nothing
- **Undo:** for notes, highlights, and bookmarks; a deletion without undo stays deleted.
- **Restore UI:**
  - bad file refused
  - preview counts
  - Replace locked until confirmed
  - safety copy downloaded
  - merge and replace results checked
- **Error reports:**
  - personal text scrubbed
  - only allowed fields sent
  - toggle stops reports
  - server truncates, rate-limits, and refuses cross-site requests
- **Upgrade (your real-data concern):**
  - 151 notes, 101 highlights, 41 bookmarks, 25 dictionary entries, a study, a sermon, a folder, and settings, created on the live version
  - every record identical after upgrade
  - a live-version backup merges with no duplicates and restores identically into a fresh browser

## 4. Remaining risks

1. **AI is locked until you set `AI_ACCESS_CODE`** in Vercel (Production and Preview). This is intentional.
2. **Rate limits are per server instance** until Upstash Redis is connected. The daily cap still applies, but per instance.
3. **Safety-copy recovery covers studies and sermons**, where long typing happens. Verse notes and dictionary entries save on the button press, as before.
4. **Storage protection depends on the browser.** Safari may still decline unless the app is added to the Home Screen. Backups remain the real safety net until sync exists.
5. **Tested in Chromium only.** Safari and Firefox were not run in this environment.
6. **CI status not confirmed from here.** GitHub CLI access is not authorized in this session, so check the Actions tab after the push.
7. **The error-screen fallback** was verified by code review and unit wiring, not by forcing a real page crash in the browser.
8. **Naming mismatch:** the installed app name is "Carter Study Bible", but some in-app text still says "Arise" (M5 in the audit).
9. **Possible deployment lag (C4)** from the audit is still unverified.

## 5. Your actions before release

1. Vercel → Settings → Environment Variables: add `AI_ACCESS_CODE` (a private passphrase) for Production and Preview.
2. Anthropic Console: set a monthly spend limit.
3. Optional: connect Upstash Redis through Vercel Marketplace for shared rate limits.
4. On the live app today: Settings → Download backup (an extra safety copy of your real data).
5. Open the Vercel preview for branch `kaizen/cycle-1` and try it. Check that the GitHub Actions run is green.
6. Tell me "approved to merge" when you are ready. Nothing goes to production until you say so.

## 6. Recommended Cycle 2: Search and accuracy

| Audit item | Focus |
|---|---|
| H1 | One-chapter book references (Jude 3, Obadiah 4) go to the wrong place. |
| H5 | Range bookmarks don't show on the verses. |
| H2 | First search is slow on phones (20 s on slow 4G). Build a prebuilt search index. |
| H3 | Search covers the KJV only. Extend to the other translations. |
| M8 | Search and reference conveniences. |

Also worth pairing in: M1 (two open tabs overwriting each other), which finishes the data-safety work from this cycle.

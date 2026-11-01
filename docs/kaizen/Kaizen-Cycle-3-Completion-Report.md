# Kaizen Cycle 3 Completion Report
Carter Study Bible: Accessibility, Reliability & Reading Performance
Branch: `kaizen/cycle-3` (commit cf4a70a). Pushed for preview only. NOT merged, NOT in production.
Started after confirming Cycle 2 (0a1db92) and the Search button (feed543) were merged, passed CI, and deployed.
Date: October 31, 2026

## Summary

| Area | Target | Result |
|---|---|---|
| Accessibility (H4) | 0 serious/moderate automated findings | **0** (was 25), 24 page states, light and dark |
| Keyboard stops | Under 60 per chapter | **32 for the whole page** (John 3 was 627; Psalm 119 was 1,233) |
| Two tabs (M1) | No silent overwrite | Detected, warned, both versions kept |
| Range notes | All verses marked | Done; cross-chapter ranges too |
| Chapter loading | Faster, measured | **3.6 s → 2.15 s** first chapter on slow 4G |
| Offline (M10) | Read without a connection | Done, with safe updates |
| Security (M4) | Headers, self-hosted fonts | Done; no third-party requests |
| Everything else | Unchanged | 138/138 browser checks, 165/165 unit tests, CI green |

## 1. Accessibility (H4)

**Previous condition**
- **Keyboard:** 627 Tab stops on John 3 and 1,233 on Psalm 119. Every word and verse number was its own stop.
- **Selected red-letter words:** contrast was 4.42:1 (light) and 3.87:1 (dark); the requirement is 4.5:1.
- **Verse numbers:** tap targets were 9–12 px wide (WCAG 2.2 requires 24×24).
- **Headings:** the order skipped levels in the word panel and the study worksheet, and the sermon editor had no page heading.
- **Teaching view:** the gold "[LEADER CUE]" label had 2.57:1 contrast.
- **Sermon list:** links were 15–22 px tall.

**Verified root cause:** every word was coded as an always-focusable button (`tabIndex=0`). The colors were mixed from the accent color without a contrast check for red text. The headings were written without a level-2 heading above them.

**Improvements**
- **Chapter keyboard model:** the chapter text is one Tab stop. Inside it:
  - **Up/Down** move verse by verse.
  - **Left/Right** move word by word.
  - **Home/End** jump to the first or last verse.
  - **Enter/Space** selects a verse or a word.
  - Tab returns to wherever you last were.
- **Screen readers:** they hear a short instruction, and every word keeps its label ("loved: show Hebrew or Greek word").
- **Original-language words:** individual words are still selectable by keyboard, mouse, and touch.
- **Selected red-letter words** use a stronger red. A new test checks every accent color × page tone × light/dark.
- **Verse numbers** are now 24×24 px targets, with almost no change to the text layout.
- **Headings:**
  - a hidden "Study tools" heading for screen readers
  - "Guided breakdown" is a real heading
  - the sermon editor has a page heading
- **Teaching view:** the cue uses the readable Arise gold on screen. Word and PDF exports keep the template gold.
- **Sermon list links** are 24 px tall.

**Results (axe-core, WCAG 2.0/2.1/2.2 A+AA + best practice)**

| | Before | After |
|---|---|---|
| Serious/critical/moderate findings (12 pages × light/dark) | 25 | **0** |
| Tab presses to cycle the John 3 page | 627 | **32** |
| Tab presses to cycle the Psalm 119 page | 1,233 | **32** |
| Focusable items inside the chapter text | 598 | **3** (one roving item + Previous/Next) |

**Keyboard-only test (automated):**
1. Tab reaches verse 1.
2. Down, Down reaches verse 3.
3. Right moves to "Jesus".
4. Enter opens the Greek word study.
5. Up returns to verse 3.
6. Enter selects John 3:3 and shows its actions.
7. End jumps to verse 36.

## 2. Two tabs editing the same item (M1)

**Previous condition:** Cycle 1's autosave saved whatever was on screen, so the last tab to save silently won.

**Root cause:** saves didn't check whether the stored record had changed since this tab loaded it.

**Improvements**
- **Guarded saves:** every save of a study or sermon first checks that the stored version is still the one this tab started from. If it isn't, nothing is written.
- **Idle tab:** if another tab saves while this one has no unsaved edits, this tab loads the newer version and says so.
- **Both tabs editing:** a banner appears: "This outline was changed in another tab or window while you were editing here."
  - **Keep my version** saves yours and keeps theirs as a separate outline.
  - **Use the other version** saves yours as a separate copy.
  - Nothing is ever lost.
- **Deleted elsewhere:** if the item was deleted in another tab, you can restore it or close it.
- **Status line:** the save indicator reads "Not saved: changed in another tab".
- **Cycle 1 safety copies** (crash recovery) now also check this. A leftover copy that is older than another tab's change becomes a "(recovered copy)" instead of overwriting. Safety copies from before this change still restore as before.

**Tests**
- **5 unit tests:**
  - a normal save works
  - a newer version is refused and nothing is written
  - a deletion is detected
  - recovery keeps both versions
  - old-style recovery still works
- **Browser test with two tabs open on the same outline:**
  - the idle tab updates
  - simultaneous edits trigger the warning, and the stored title stays the other tab's version
  - "Keep my version" leaves both versions saved

## 3. Notes on verse ranges, and cross-chapter ranges

**Previous condition:** a note on John 3:16–18 showed only on verse 16. Gen 1:1–2:3 opened at 1:1 and marked only that verse.

**Root cause:** notes were grouped by their first verse only. The reader's address couldn't express a range that crosses chapters.

**Improvements**
- **Range notes:** note markers now appear on every verse a note covers, including notes that cross chapters, and update instantly when notes change. Stored notes are unchanged, and one range note is still one record.
- **Cross-chapter ranges:** Gen 1:1–2:3 opens at Genesis 1:1 as before, marks the rest of chapter 1, and adds "The passage continues in Genesis 2:1-3 →". That link marks 2:1–3.

**Tests**
- the note marks all three verses
- exactly one note is stored
- deleting it clears all three markers
- Gen 1:1–2:3 marks 31 verses
- the "continues" link marks Genesis 2:1–3

## 4. Chapter loading performance

**Root cause**
- **Whole books for one chapter:** opening John 3 downloaded the entire tagged book of John (146 KB compressed).
- **Fonts:** came from Google (178 KB).
- **Word study:** downloaded whole books for its "other passages" list (139 KB of Genesis to show a few verses).

**Improvements**
- **Per-chapter files:** one file per KJV chapter (1,189 files), generated from the existing book files. A test confirms every chapter is identical to its book file, including text, Strong's tags, margin notes, and Psalm titles.
- **Original-language data kept:** the word tagging stays in each chapter file. It adds only about 4 KB per chapter, and keeping it together avoids any risk to original-language accuracy.
- **Background preloading:** the next and previous chapters load in the background.
- **Word panel:** loads single chapters, in parallel.
- **Fonts:** self-hosted. Literata uses its weight-only version (51 KB instead of 107 KB).
- **Editors on demand:** the Study Workspace and Sermon editor load when first opened.

**Before and after.** Measured with the audit's conditions: phone screen, Lighthouse slow 4G (150 ms, 1.6 Mbps), 4× slower CPU, median of 3 runs, service worker off (a first visit).

| Measure | Before | After |
|---|---|---|
| First chapter, cold (John 3) | 3,630 ms (472 KB) | **2,154 ms (200 KB)** |
| Next chapter after a normal reading pause | 185 ms | **177 ms** |
| Next chapter pressed the instant the first appears | 188 ms | 860 ms (see Remaining issues) |
| Another book on page load (Psalm 119) | 1,927 ms (176 KB) | **954 ms (12 KB)** |
| Word study (Psalm 119:105) | 1,781 ms | 1,914 ms (same data path; within run-to-run variation) |
| Data for a word study's passage list | 139 KB (all of Genesis) | ~20 KB (chapter files) |

**Search (Cycle 2) check:** first search 2.2 s and repeat 1.35 s. Hardest cases show the count in 1.4–2.5 s. That matches Cycle 2.

## 5. Offline reading (M10)

**Improvements**
- **App storage:** a service worker stores this version's app files when installed. Chapters you read are kept automatically.
- **Settings → Offline reading:**
  - Download any of the 8 translations, with progress and a "saved on" date.
  - The KJV is always included, since every translation uses it for verse layout and word links.
  - Sizes are shown: KJV about 16 MB stored (about 4 MB to download), others about 4 MB each.
  - Any download can be removed.
- **Offline banner:** "You're offline. Downloaded Bibles, chapters you've read, and all your notes, studies, and sermons still work."
- **Unsaved chapters:** a chapter that isn't saved says so and explains how to get it.
- **Safe updates:**
  - a new version waits until you click "Reload now", so the app never mixes versions
  - other open tabs are told to reload
  - old app files are cleaned up, and downloaded Bibles are kept
- **Untouched:** the AI assistant and error reports are never stored. Notes, sermons, and backups are untouched (they live in the browser database).

**Tests (browser network emulation)**
- **Download and read offline:**
  - the service worker activates
  - downloading the BSB completes, with the KJV included
  - offline, Psalm 23 opens
  - the offline banner shows
  - the BSB reading setting is kept, and Romans 8:28 opens in the BSB
  - the Sermons page works offline
- **Never saved:** a chapter never read shows the "not saved on this device" message.
- **Read earlier:** a chapter read earlier opens offline with no download.
- **Update flow** (scripted, real file change):
  - the banner appears
  - the old version keeps running until reload
  - after reload the new version runs and old files are removed
  - another open tab gets the "updated in another tab" notice

## 6. Security and privacy (M4)

**Headers added** (`vercel.json`, every response):
- Content-Security-Policy:
  - scripts only from this site
  - no `eval`, no plugins, no framing
  - connections only to this site
  - `upgrade-insecure-requests`
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: no camera, microphone, location, payment, or USB
- Cross-Origin-Opener-Policy: same-origin
- Strict-Transport-Security: 1 year

**Fonts:** self-hosted from open-source (OFL) packages. The app now makes **zero requests to other sites** (verified).

**Verification**
- **Same headers in testing:** the local preview sends the production headers, so the entire browser suite runs under them.
- **Nothing blocked:** a check fails the run if the security policy blocks anything. Result: nothing blocked, including Word/PDF export, search, the AI assistant (mocked), and error reporting.
- **No `eval` needed:** the export libraries' `Function("return this")` code only runs in very old browsers, so the policy can forbid `eval`.

## 7. Files modified

| File | Change |
|---|---|
| `src/components/Reader.tsx` | Keyboard model, chapter files, range notes, cross-chapter link, offline message, preloading |
| `src/components/Conflict.tsx` (new) | Two-tab detection and choice banner |
| `src/components/Offline.tsx` (new) | Offline/update banners, Offline reading settings |
| `src/lib/offline.ts` (new) | Service worker registration, safe updates, downloads |
| `sw/sw.js` (new), `vite.config.ts` | Service worker and its build step; production headers in preview |
| `src/lib/autosave.ts` | Guarded saves, conflict state, safer recovery |
| `src/lib/data.ts`, `src/components/WordPanel.tsx` | Chapter loading |
| `src/lib/refs.ts`, `src/pages/BiblePage.tsx` | Cross-chapter ranges |
| `src/lib/appearance.ts`, `src/main.tsx`, `src/index.css` | Self-hosted fonts, contrast, target sizes |
| `src/pages/WorkspacePage.tsx`, `SermonPages.tsx`, `ToolsPane.tsx`, `ui.tsx` | Conflict banner, headings, status |
| `src/pages/OtherPages.tsx`, `src/App.tsx` | Offline settings, banners, editors loaded on demand |
| `scripts/build_chapters.mjs` (new), `public/data/kjv/{Book}/` (1,189 files) | Chapter files |
| `vercel.json` | Security headers |
| Tests | `chapters.test.ts` (new), `autosave`, `appearance`, `refs` tests; browser section 19 |

**Not touched:** database, backup format, stored data, server code, Bible text, Strong's data, dictionaries, cross-references.

## 8. Test results

| Test | Result |
|---|---|
| Unit tests (incl. chapter integrity, two-tab saves, contrast for every theme) | 165 / 165 |
| Browser suite (19 sections), run twice | 138 / 138 both times |
| Accessibility audit, 12 pages × light/dark | 0 serious/moderate |
| Security policy violations across the full run | 0 |
| GitHub CI | Passed |
| Vercel preview build | Completed |

## 9. Remaining issues

1. **"Next chapter" pressed instantly on slow 4G takes 0.86 s** (before 0.19 s). The whole book used to be loaded already; now the next chapter competes with fonts that are still arriving. After even a short reading pause it's 0.18 s, the same as before.
2. **Literata font** now uses its weight-only version, half the size. The automatic optical-size tuning is gone, a very small visual difference at reading sizes.
3. **Offline, Bible text only:** offline downloads cover the Bible text. Search, Strong's word studies, and dictionaries work offline only for what you've already opened, and the AI needs a connection.
4. **Testing limits:**
   - Tested in Chromium with network emulation.
   - Not tested on a real iPhone or Android, or with a real screen reader (VoiceOver, TalkBack, NVDA).
   - Slow-network emulation can't throttle service-worker traffic, so all speed numbers were taken with it off (first-visit conditions).
5. **Header checks:** headers were verified locally and in CI. I can't fetch the live site from here, so after release you can confirm at securityheaders.com.
6. **Styles policy:** `'unsafe-inline'` is allowed for styles only, which the app's inline styling needs. Scripts are strict.
7. **Extra copies:** conflict resolution creates extra copies in your lists, which you delete when no longer needed.
8. **Data refresh:** corrected Bible data reaches a device on the visit after it's deployed (stored copy first, refreshed in the background).
9. **Deployment size:** about 16 MB and 1,189 files larger, from the chapter files.

## 10. Recommended Cycle 4: Study depth

| Item | Why |
|---|---|
| H8 Deeper original-language tools | Morphology explanations, lexical forms, word-family views; the app's core strength |
| H6 Public-domain commentaries (e.g., Matthew Henry, Jamieson-Fausset-Brown) | Most-requested study feature; fits the existing panels |
| H7 Reading plans | Daily engagement; pairs with offline reading |
| Offline word studies and search | Extends M10 to Strong's and the search index as optional downloads |
| Real-device and screen-reader pass | Confirms Cycle 3 on iPhone/Android with VoiceOver/TalkBack |

## Your next steps

1. In Vercel, go to **Deployments**, remove the Production filter, open the newest **kaizen/cycle-3** row, and click **Visit**.
2. Try:
   - **Keyboard:** press Tab until a verse number is highlighted, then use the arrow keys and Enter.
   - **Offline:** in Settings, use **Offline reading** to download a Bible, then turn on airplane mode and open a chapter.
   - **Two tabs:** open the same sermon in two tabs and edit both.
   - **Range note:** add a note to John 3:16–18.
3. Reply **"approved to merge"** when you're satisfied.

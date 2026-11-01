# Carter Study Bible: Kaizen Audit Report

**Audit date:** October 30, 2026 · **Codebase:** `Arise0709/arise-bible-study` (latest commit `086d0f9`) · **Mode:** read-only. No code, data, settings, or design was changed. Throwaway test scripts lived in a scratch folder outside the project.

## How this audit was done, and its limits

**How each finding was confirmed:**
- **[Verified]** Reproduced in a running copy of the production build (Playwright browser tests).
- **[Code-verified]** Confirmed by reading the source, with file and line references.
- **[Measured]** A number taken during the audit.
- **[Unverified]** Needs the owner's confirmation.
- **[Suggestion]** A judgment call, not a defect.

**Limitations:**
1. **The live site was not reachable.** `carterstudybible.app`, `arise-bible-study.vercel.app`, and webkit.org were blocked by the audit workspace's network policy. Every test ran against a local copy of the same build.
2. **Speed numbers are a local baseline,** with simulated slow 4G and a 4× slower phone CPU. Vercel compresses files and serves them from nearby servers, so real numbers should be somewhat better.
3. **Browser coverage is limited.** Testing used Chromium (Chrome's engine) only, not real iPhone Safari or Android hardware.
4. **The AI assistant's live answers were not tested.** There was no API key access. Its safety checks were tested with a deliberately bad mock answer.
5. **There's no real-user data.** The app has no analytics or error logging, so there's no information on crashes, usage, or how long sessions last.
6. **There's no server database or user accounts to audit.** Everything is stored in each person's browser (IndexedDB). That design is itself a finding (C2).

---

## Baseline metrics (the "before" for every Kaizen cycle)

| Measure | Result |
|---|---|
| KJV text integrity | 66 books, 31,102 verses; every Strong's number has a dictionary entry (0 missing) [Verified] |
| Search accuracy | 7 of 7 test searches matched an independent count exactly (grace 159, Jesus wept 1, father's 137, LORD 6,667, charity in NT 24, believ* 287) [Verified] |
| Open John 3 (slow 4G phone / fast) | 5.8 s / 2.1 s [Measured] |
| Click a word to its Strong's entry | 3.0 s / 1.4 s [Measured] |
| **First search on a page load** | **20.1 s** / 2.3 s [Measured] |
| Main app code | 581 KB (177 KB compressed) [Measured] |
| Accessibility scan (axe-core, 8 pages, light and dark) | 3 serious, 1 moderate issue; **598 keyboard stops** in John 3 [Measured] |
| Automated tests | 21 unit tests, 56 browser checks, all passing at last run; none run automatically on GitHub [Verified] |
| Dependency vulnerabilities (npm audit) | 0 [Verified] |

---

## Area-by-area findings

**1. Interface and navigation**
- **Exists:**
  - Five-section navigation, plus a bottom bar on phones.
  - A global search box, a help dialog, and keyboard shortcuts.
- **Works:**
  - Navigation is consistent, and no page scrolls sideways at phone width [Verified].
- **Needs improvement:**
  - The app still calls itself **"Arise Bible Study"** everywhere: tab titles, the logo, help, exports, and the backup file name [Code-verified] (M5).
- **Unnecessarily complicated:**
  - Verse notes and study worksheet notes are separate systems, and Saved Studies overlaps the Study Workspace [Suggestion].

**2. Bible reading**
- **Exists:**
  - KJV with translators' italics, red letters, paragraph marks, and 1611 margin notes.
  - Highlights in 5 colors, bookmarks, notes, and 7 fonts.
- **Works:**
  - The text is exact against the source [Verified].
- **Broken:**
  - Bookmarking a verse range shows no bookmark mark on those verses (H5) [Verified].
- **Missing:**
  - Audio, reading plans, and continuous scrolling across chapters.

**3. Search**
- **Exists:**
  - Search by all words, exact phrase, or any word; wildcards (`believ*`); Testament and book filters.
  - Typing a reference or a Strong's number jumps straight to it.
- **Works:**
  - Result counts are exact [Verified].
- **Broken:**
  - **"Jude 3", "Philemon 6", and "3 John 4" open a chapter that doesn't exist** (H1) [Verified].
- **Needs improvement:**
  - The first search takes 20 s on slow mobile (H2).
  - Search covers the KJV only (H3).
  - Comma lists like "John 3:16,18" don't work.
  - There's no spelling help ("beleive" returns 0 results).
  - Exact phrase "living water" misses "living waters" (M8) [Verified].

**4. Translations and comparison**
- **Exists:**
  - KJV plus BSB, NHEB, ASV, YLT, Webster, BBE, and Geneva; one comparison line under each verse; translation-aware quotes.
- **Works:**
  - All seven line up chapter for chapter with the KJV [Verified].
- **Missing:**
  - Modern licensed translations such as NKJV, ESV, and NIV (L6).
  - More than 2 versions side by side (M9).
  - Cross-reference previews always show the KJV [Code-verified].

**5. Study tools**
- **Exists:**
  - Strong's dictionary (14,197 entries), a concordance, Greek ranges of meaning (Abbott-Smith), and 341,385 cross-references.
  - ISBE, Hitchcock, Webster 1913, and a thesaurus.
- **Works:**
  - Word mappings are correct in the tests, and no word mapping is ever guessed.
- **Missing:**
  - **Commentaries** (H6).
  - An interlinear view, Hebrew meanings beyond Strong's, decoded Hebrew verb forms, and pronunciation audio (H8).
- **Unnecessarily complicated:**
  - The word panel is dense for beginners [Suggestion].

**6. AI study assistant**
- **Exists:**
  - Four optional tasks, grounded only in the user's study.
  - Every quote, Strong's number, and citation is checked before display, and all output is labeled.
- **Works:**
  - The owner confirmed it works live, and the safety checks caught a bad quote and a made-up Strong's number in testing [Verified].
- **Broken:**
  - **The AI endpoint has no protection: anyone on the internet can use the API key** (C3) [Code-verified].
- **Needs improvement:**
  - There's no timeout setting or streaming, and no quality evaluation (M7).

**7. Notes, highlights, and bookmarks**
- **Works:**
  - They survive a reload, and references inside notes become links [Verified].
- **Broken:**
  - **Edits made just before leaving a page are lost** (C1).
  - The range bookmark mark is missing (H5).
- **Needs improvement:**
  - Deleting is instant with no undo (M2).
- **Missing:**
  - Sync between devices (C2).

**8. Sermon preparation**
- **Strengths:**
  - Church-template manuscripts in Word and PDF.
  - Building a sermon straight from a study, Teaching view, folders, and tags.
  - Building straight from a study into the church's own template was not described for any of the competitors checked.
- **Problems:**
  - C1 (lost edits) and M1 (two open tabs overwrite each other).
- **Missing vs. Logos:**
  - Slides and handouts (L5).

**9. Discipleship and learning**
- **Exists:**
  - No dedicated features.
- **Missing:**
  - Reading plans, course tracks (101 and 201), progress tracking, and sharing (H7, M11).

**10. Mobile and desktop**
- **Works:**
  - Three resizable panels on desktop, tabs on mobile, no sideways scrolling [Verified].
- **Needs improvement:**
  - The reader toolbar takes 3 rows on a phone (L1).
- **Not tested:**
  - Real iPhones and tablets.

**11. Speed**
- See the baseline metrics above.
- **Biggest problem:** the first search downloads all 66 books with full word tagging, 3.8 MB compressed (H2).

**12. Data sync and reliability**
- **There's no sync, and storage isn't protected** (C2).
- No automated checks run on GitHub, and there's no error reporting (M6).
- Production may be lagging behind the code (C4).

**13. Security and privacy**
- **Good:**
  - No accounts, and no personal data stored on a server.
  - The API key stays on the server, reference-work text is cleaned when the data is built, and there are no known vulnerable dependencies.
- **Issues:**
  - The open AI endpoint (C3).
  - No security headers (M4).
  - Fonts load from Google, which shares visitors' IP addresses with Google (M4).
  - The AI sends study text to Anthropic. Settings discloses this [Code-verified].

**14. Accessibility**
- 598 keyboard stops per chapter.
- The selected red-letter word fails contrast.
- A list on Saved Studies is coded incorrectly, and one heading level is skipped (H4).
- All six color themes pass the WCAG AA contrast test [Verified].

**15. Overall experience**
- The full workflow from reading to exporting works end to end, and the sourcing is unusually transparent.
- The biggest risk is **losing work** (C1, C2).
- There's no first-time guide for beginners [Suggestion].

---

## Competitor comparison (sourced; blank means not verified)

| Capability | Carter Study Bible | YouVersion | Bible Gateway | Blue Letter Bible | Logos | Olive Tree |
|---|---|---|---|---|---|---|
| Translations | 8 (all public domain) | 2,000+ in 1,300+ languages ([App Store](https://apps.apple.com/us/app/bible/id282935706)) | ~200 in 70+ languages ([newsroom](https://biblegateway.com/newsroom)) | | | |
| Side-by-side versions | 2 | | Up to 5 ([help](https://www.biblegateway.com/blog/?p=6684)) | | | Split window ([listing](https://apps.apple.com/al/app/bible-study/id472790630?mt=12)) |
| Strong's / lexicon | Yes, with counts | | | Yes ([BLB help](https://www.blueletterbible.org/help/using_blb.cfm)) | | |
| Interlinear with pronunciation audio | No | | | Yes ([review](https://compellingtruth.org/Blue-Letter-Bible.html)) | | |
| Commentaries | No | | | Text and audio ([App Store](https://apps.apple.com/app/365547505)) | | Resource Guide ([listing](https://apps.apple.com/al/app/bible-study/id472790630?mt=12)) |
| Reading plans | No | Thousands ([App Store](https://apps.apple.com/us/app/bible/id282935706)) | | | | |
| Offline | No | Select versions | | Partly; some tools need internet ([BLB Android](https://www.blueletterbible.org/android/man04_2.cfm)) | | Full offline ([listing](https://apps.apple.com/al/app/bible-study/id472790630?mt=12)) |
| Notes sync across devices | No | | | | | Yes ([listing](https://apps.apple.com/al/app/bible-study/id472790630?mt=12)) |
| Sermon builder | Yes, exports into the church template (Word/PDF) | | | | Slides, handouts, PowerPoint export; paid tiers ([Logos](https://logos.com/features/sermon-editor)) | |

**Takeaway:** Carter leads on sermon prep in the church's own manuscript format, and on transparent sourcing. It trails on data safety (sync and offline), commentaries, reading plans, and breadth of translations.

---

## Prioritized Kaizen Improvement Report

Effort scale: **S** under 1 day · **M** 1–3 days · **L** 1–2 weeks · **XL** more than 2 weeks.

### CRITICAL

**C1. Edits are lost when you leave a page quickly [Verified]**
- **Problem:** typing in a sermon or study and leaving within about 0.6 s discards the edit. In the test, both the sermon title and a study note were lost.
- **Likely cause:** autosave waits 600 ms, and leaving the page cancels the pending save (`SermonPages.tsx:184-190`, `WorkspacePage.tsx:117-123`). Nothing saves when the tab closes.
- **Fix:** save immediately when leaving a page, switching tabs, or closing the app, and show "Saving…" until the save finishes.
- **Benefit:** no silent loss of sermon work.
- **Effort:** S · **Regression risk:** Low
- **Test:** browser test that types, then leaves within 100 ms, then reopens; plus a close-tab test.

**C2. Data can be wiped by the browser, and there's no sync [Verified + documented]**
- **Problem:**
  - Every note, study, and sermon lives in one browser on one device.
  - The browser's "keep this data" protection is off.
  - Apple's tracking prevention deletes such storage after 7 days of Safari use without visiting the site, unless the site was added to the Home Screen ([WebKit](https://webkit.org/tracking-prevention/)).
- **Likely cause:** version 1 was built local-only, with no accounts.
- **Fix, in stages:**
  - (a) ask the browser to keep the data permanently;
  - (b) add an app manifest so the site can be installed to the Home Screen, which is exempt from the 7-day rule;
  - (c) show the last backup date and remind the user to back up;
  - (d) later, accounts and cloud sync, as a separate project.
- **Benefit:** protects years of sermon work.
- **Effort:** S–M for (a)–(c); XL for sync · **Regression risk:** Low for (a)–(c); High for sync
- **Test:** check that storage is protected; install to Home Screen on iPhone; confirm the reminder appears.

**C3. The AI endpoint is open to anyone [Code-verified]**
- **Problem:** `/api/assist` accepts any request, with no login, origin check, or rate limit. Anyone who finds it can spend the Anthropic credit, up to about $0.44 per call at Opus 5.5 rates.
- **Likely cause:** it was built for a single user, with no accounts.
- **Fix:**
  - **Today, no code needed:** set a monthly spend limit in the Anthropic Console.
  - **In code:** accept requests only from the app's own site, add a per-device rate limit, add an optional passcode in Settings, and log usage.
- **Benefit:** capped cost and no abuse.
- **Effort:** S · **Regression risk:** Low (a bad setting could block the owner, which the test catches)
- **Test:** requests from other sites get refused; more than N requests per minute get a "too many requests" reply; the normal flow still works.

**C4. Production may be several releases behind [Unverified]**
- **Problem:** a screenshot showed the deployed commit "Word panel: lead with the main word…" (`c4f2f63`). GitHub `main` is `086d0f9`, 6 commits later.
- **Likely cause:** a failed build, a skipped deploy, or simply an older screenshot.
- **Fix:** check Vercel → Deployments; if a build failed, read the build log. Add automatic checks on GitHub (M6).
- **Benefit:** the live site runs the code that was tested.
- **Effort:** S · **Regression risk:** None
- **Test:** the live site shows Settings → Appearance and Bible translations.

### HIGH

**H1. One-chapter book references go to the wrong place [Verified]**
- **Problem:** "Jude 3", "Philemon 6", and "2 John 5" are read as chapter numbers.
- **Likely cause:** the reference reader in `refs.ts` treats a lone number as a chapter.
- **Fix:** for Obadiah, Philemon, 2 John, 3 John, and Jude, treat a lone number as a verse.
- **Effort:** S · **Regression risk:** Low
- **Test:** unit tests for all 5 books, plus the existing reference tests.

**H2. First search is slow on phones (20 s on slow 4G) [Measured]**
- **Likely cause:** search downloads all 66 books with full word tagging (3.8 MB compressed) and rebuilds the index every time the page loads.
- **Fix:** build a compact search-only text file per translation when the data is built, and keep it in the browser after the first download.
- **Benefit:** fast search on phones.
- **Effort:** M · **Regression risk:** Medium (results must stay identical)
- **Test:** the 7 baseline counts must match exactly; target under 5 s on slow 4G.

**H3. Search covers the KJV only [Code-verified]**
- **Fix:** add a translation choice to search, built on the H2 search file.
- **Effort:** S after H2 · **Regression risk:** Low
- **Test:** searching the BSB for "one and only Son" finds John 3:16.

**H4. Keyboard and screen-reader barriers [Measured]**
- **Problem:**
  - 598 keyboard stops in John 3.
  - The selected red-letter word fails contrast.
  - A list on Saved Studies is coded incorrectly.
  - One heading level is skipped.
- **Fix:**
  - Make each verse one keyboard stop, with arrow keys to move between its words.
  - Fix the contrast, the list, and the heading.
- **Effort:** M · **Regression risk:** Medium (word clicking)
- **Test:** the accessibility scan finds 0 issues; fewer than 60 keyboard stops per chapter; a keyboard-only browser test.

**H5. Range bookmarks don't show on the verses [Verified]**
- **Likely cause:** a range is saved under its range id (`Reader.tsx:125`), but the bookmark mark checks single-verse ids (`:259/:275`).
- **Fix:** mark every verse inside a bookmarked range.
- **Effort:** S · **Regression risk:** Low
- **Test:** bookmark 16–17 and confirm both verses show the mark.

**H6. No commentaries [Verified missing]**
- **Available sources:** CrossWire's source repository includes public-domain commentaries: Matthew Henry (complete and concise), Jamieson-Fausset-Brown, Adam Clarke, Spurgeon's *Treasury of David*, and Scofield 1917.
- **Fix:** add a Commentary tab for each verse, labeled by source and era. Verify each license first.
- **Benefit:** closes the biggest study-tool gap against BLB and Olive Tree.
- **Effort:** M–L · **Regression risk:** Low (new tab)
- **Test:** every entry maps to a real verse; open John 3:16 commentary in the browser.

**H7. No reading plans [Verified missing]**
- **Fix:** built-in plans (Bible in a Year, NT in 90 Days, Gospels), custom plans, and progress tracking.
- **Effort:** M · **Regression risk:** Low
- **Test:** progress survives a reload; dates calculate correctly across years.

**H8. Shallow original-language depth [Verified]**
- **Problem:** no interlinear view, Hebrew verb codes shown raw, no Hebrew ranges of meaning, no Greek pronunciation.
- **Fix:**
  - Add an interlinear toggle built from the existing tags, honestly labeled: dictionary forms for the OT, actual Greek forms for the NT.
  - Decode Hebrew tense codes from a published table.
  - Evaluate a public-domain 1906 Brown-Driver-Briggs Hebrew lexicon. Its license needs verifying.
- **Effort:** L · **Regression risk:** Medium
- **Test:** spot-check 20 words against the sources.

### MEDIUM

- **M1. Two open tabs overwrite each other** [Code-reasoned, not reproduced]
  - **Problem:** each editor saves the whole record it loaded, so the second tab overwrites the first.
  - **Fix:** check for newer saves before writing and ask before overwriting.
  - **Effort:** M · **Risk:** Medium
  - **Test:** edit in two tabs and confirm neither edit is lost.
- **M2. Deleting is instant with no undo** [Code-verified]
  - **Applies to:** notes, bookmarks, and highlights.
  - **Fix:** a 5-second "Undo" message.
  - **Effort:** S · **Risk:** Low
  - **Test:** delete, then undo, then confirm it's restored.
- **M3. Restoring a backup isn't checked and merges silently** [Code-verified]
  - **Fix:** validate the file, preview what it contains, and offer replace or merge.
  - **Effort:** S–M · **Risk:** Low
  - **Test:** a damaged file is rejected; an old backup still restores.
- **M4. No security headers; fonts load from Google** [Verified]
  - **Fix:**
    - Add standard security headers in `vercel.json`: Content Security Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
    - Host the fonts on the app's own site.
  - **Effort:** S · **Risk:** Medium (a strict policy can block things)
  - **Test:** no blocked-content errors in the browser console on any page; a headers scan passes.
- **M5. Rename to Carter Study Bible** [Verified]
  - **Fix:** change every visible name.
  - **Warning:** **keep the internal database name and backup format id** (`arise-bible-study`). Renaming those would make everyone's saved notes disappear.
  - **Effort:** S · **Risk:** Low if those stay unchanged
  - **Test:** a backup from the old version restores, and existing data is still visible after deploy.
- **M6. No automatic checks on GitHub, no error reporting** [Verified]
  - **Fix:** run the type check, unit tests, build, and browser tests on every push, and add privacy-respecting error logging.
  - **Effort:** S–M · **Risk:** Low
  - **Test:** a deliberately broken commit is caught before it deploys.
- **M7. AI request limits and quality** [Suggestion]
  - **Problem:** no time limit is set for the AI request, and the answer arrives all at once, so a long study might time out.
  - **Fix:**
    - Set the time limit.
    - Stream the answer so it appears as it's written, with progress shown.
    - Build a 10-study test set to measure accuracy.
  - **Effort:** M · **Risk:** Low
  - **Test:** a large study completes; the test set keeps 0 unverified quotes.
- **M8. Search and reference conveniences** [Verified]
  - **Fix:**
    - Support comma lists ("John 3:16,18") and "Phil 4 13".
    - Highlight the whole range on "Rom 8:28-39" (today only verse 28 is marked).
    - Warn when a verse doesn't exist ("Gen 50:27").
    - Offer an "include word forms" option for phrases.
    - Add spelling suggestions.
  - **Effort:** S–M · **Risk:** Low
  - **Test:** unit tests for each pattern.
- **M9. Comparing more versions**
  - **Fix:** up to 4 columns on desktop, and cross-reference previews in the reading translation.
  - **Effort:** M · **Risk:** Low
- **M10. Offline reading** [Verified missing]
  - **Fix:** a service worker (offline cache) for the app and the chosen books. Pairs with C2(b).
  - **Effort:** M · **Risk:** Medium (stale copies, handled with versioning)
  - **Test:** reading works in airplane mode.
- **M11. Discipleship course tracks** [Suggestion]
  - **Fix:** 101 and 201 tracks built on the study worksheet, with lessons, progress, and printable handouts.
  - **Effort:** L · **Risk:** Low

### LOW

- **L1. Compact phone toolbar:** fold the font and toggle buttons into a menu. S.
- **L2. Load page code only when needed:** split Sermons and Dictionary out of the main app file (581 KB). S–M.
- **L3. Expand the archaic-word list,** and note that Webster's "[Obs.]" labels were lost in the source data. S.
- **L4. Read-aloud** using the device's voice. S–M.
- **L5. Sermon slides and handouts,** for example fill-in-the-blank handouts for Men ARISE. M.
- **L6. Modern licensed translations:** NKJV, ESV, and NIV require publisher licenses or a paid Bible API, with costs and terms that need checking first. Business decision.

---

## Recommended implementation sequence

| Step | Items | Why first |
|---|---|---|
| **0. Owner, today, no code** | Check Vercel deployments (C4); set an Anthropic spend limit (C3); download a backup in Settings | Stops the two biggest risks immediately |
| **1. Data safety and security** | C1, C2 (a–c), C3, M2, M3, M6 | Protects the work and the account |
| **2. Search and accuracy** | H1, H5, H2, H3, M8 | Daily-use correctness and speed |
| **3. Access and polish** | H4, M5, M4, L1 | Everyone can use it; correct name |
| **4. Study depth** | H6, H8 | Closes the gap with BLB and Olive Tree |
| **5. Discipleship** | H7, M11 | Supports 101, 201, and Men ARISE |
| **6. Platform** | M10, M1, M9; then accounts and sync as its own planned project | Biggest effort, builds on everything before |

Each cycle follows the Kaizen loop: record the baseline, make one change, re-run the same measurements and tests, then standardize by adding the test permanently.

---

## Sources

- [YouVersion App Store listing](https://apps.apple.com/us/app/bible/id282935706)
- [Bible Gateway Newsroom](https://biblegateway.com/newsroom)
- [Bible Gateway parallel reading help](https://www.biblegateway.com/blog/?p=6684)
- [Blue Letter Bible: Using BLB](https://www.blueletterbible.org/help/using_blb.cfm)
- [Blue Letter Bible App Store listing](https://apps.apple.com/app/365547505)
- [BLB for Android](https://www.blueletterbible.org/android/man04_2.cfm)
- [Compelling Truth: Blue Letter Bible](https://compellingtruth.org/Blue-Letter-Bible.html)
- [Logos Sermon Builder](https://logos.com/features/sermon-editor)
- [Logos support: Sermon Builder](https://support.logos.com/hc/en-us/articles/360016747391-Sermon-Builder)
- [Olive Tree Bible Study App Store listing](https://apps.apple.com/al/app/bible-study/id472790630?mt=12)
- [WebKit: Tracking Prevention](https://webkit.org/tracking-prevention/)
- [WebKit: Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)

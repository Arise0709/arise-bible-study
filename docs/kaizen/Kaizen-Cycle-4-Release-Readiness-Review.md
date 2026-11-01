# Kaizen Cycle 4: Release-Readiness Review

Branch: `kaizen/cycle-4` (commit 2c1bd1c). Production: `main` (cf4a70a). Nothing merged or deployed.
Date: November 1, 2026

## 1. Overall result

**Ready to merge, with two items only you can verify.** Every test I can run here passes. Two things can't be tested from this environment:
- the real AI provider (no API key here)
- real phones and screen readers

Both are explained below with steps for checking them yourself.

## 2. Results by requirement

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Study This Passage workflow, from Scripture through sermon | **PASS** | Romans 8:28, 11/11 checks: Greek word (G4903, present active indicative), Henry and Clarke excerpts saved with citations, personal note, survives reload, flows into sermon builder |
| 2 | Sermon exports keep research and citations | **PASS** | .md, .docx, .pdf each keep both commentary citations with "Public domain", the word study, the personal note, and the KJV text |
| 3 | AI assistant with the real configured provider | **NOT VERIFIED** | No API key in this environment, and the preview site is blocked from here. Mocked tests pass (sources sent with ids, invented sources removed, uncited commentator names flagged). |
| 4 | Source citations and commentary attribution | **PASS** | Every excerpt carries author, work, dates, passage, and license. Sources page lists all 6 commentaries, STEPBible, Open Scriptures BDB, and the works not included (with reasons). |
| 5 | Lexical accuracy | **PASS** | 1,200 random Hebrew and Greek words checked against the raw STEPBible files: 1,200 exact matches (text, transliteration, gloss, Strong's, grammar, lemma). Plus unit tests on known words (Gen 1:1, Ps 23:1, John 3:16). |
| 6 | Existing endpoint protections | **PASS** | Access code, same-site check, rate limits, and size limits are unchanged. Cycle 4 only added checks (question required for "Ask", 500-character cap, question fenced off from instructions). Endpoint unit tests pass. |
| 7 | Interlinear and study panels on real iPhone Safari | **NOT VERIFIED** | No iPhone and no Safari engine (WebKit) available here |
| 8 | Same on real Android Chrome | **NOT VERIFIED** | No Android device. Chrome engine emulation passed (see 9). |
| 9 | Phone layouts (emulated) | **PASS** | 40/40 across iPhone SE, 13, 15 Pro Max, Pixel 7, Galaxy S9+ profiles with touch: no sideways scrolling, tap targets 24px or larger, tap a word to open its study, 200% text reflows |
| 10 | Accessibility (automated) | **PASS** | axe-core: 0 findings on all Cycle 4 screens and all existing pages, light and dark, desktop and phone |
| 11 | Screen readers (VoiceOver, TalkBack, NVDA, JAWS) | **NOT VERIFIED** | None available here |
| 12 | Existing user data, sermons, notes, backups, settings | **PASS** | Upgrade test from production: 29/29. Production data (151 notes, 101 highlights, 41 bookmarks, 25 dictionary entries, a study, a sermon, folders, settings) is identical after the upgrade. Old backups merge and restore with no losses or duplicates. Database name, version, and tables are unchanged. |
| 13 | Bible text, Strong's, study resources, templates preserved | **PASS** | Compared with production, no existing data file changed except sources.json, which only gained entries. All 8,682 data changes are new files. Sermon templates are untouched. |
| 14 | Full regression suite | **PASS** | Unit 189/189, end-to-end 170/170, no security-policy violations, no page errors, lint and build clean |
| 15 | Deployment size | **PASS, with a watch item** | 14,860 files, about 310 MB. Vercel preview built successfully and GitHub checks passed. The repo has 14,797 tracked files, close to a 15,000-file limit Vercel documents (see Risk 3). |
| 16 | Resource loading | **PASS** | The Bible reader downloads no commentary, lexicon, or interlinear data. Each loads only when opened. Main app code: 125 KB gzipped (Cycle 3 was 192 KB). |
| 17 | Performance | **PASS** | Slow 4G with a 4x slower CPU: first chapter 2.2 s (same as Cycle 3); next chapter 0.8 s (0.17 s once preloaded); commentary 1.2 s; Greek study 1.6 s; Hebrew 1.6 s; BDB 2.4 s; interlinear 1.0 s; context 1.2 s |
| 18 | Licensing attribution | **PASS** | All sources pinned to exact versions with checksums. CC BY sources (STEPBible, OSHB BDB, OpenBible) are credited on the Sources page. |

## 3. Issue found and fixed during this review

- **Flaky unit tests.** On the very first run, 2 of 189 tests timed out at 5 seconds. They read thousands of files, and on a cold disk that took too long. They passed on every rerun.
- **Fix:** gave tests 30 seconds (`vitest.config.ts`, a test setting only, no app code).
- **Verified:** after clearing the disk cache, 189/189 passed.
- **Commit:** 2c1bd1c, pushed to the branch.

## 4. Unresolved risks

1. **The real AI is untested with Cycle 4's new tasks.**
   - Cycle 4 added "sources" to the required answer format and four new tasks (Explain, Compare commentaries, Words, Ask).
   - If the live model returned an unexpected shape, the app shows an error message. It does not save bad content.
   - The access code still protects spending.
2. **Real Safari and screen readers are untested.**
   - Hebrew right-to-left layout and the Hebrew font are the likeliest places for Safari to differ from Chrome.
3. **File count headroom.**
   - Vercel documents a 15,000-file cap on source uploads. One docs page says deployments over the limit fail at build time.
   - Today's git deployment built fine at 14,797 files.
   - Adding another large resource (for example, Treasury of David) could approach the limit. It would need to be packed into fewer files first.
4. **Known source gaps (labeled in the app, not errors):**
   - MHCC has no note on John 3:9-21
   - Only about 560 BDB entries are fully transcribed (the rest are labeled partial)
   - ISBE has no article for 24 books
   - Cross-references aren't classified by type
5. **Small export credit gap.**
   - The "Sources and further study" footer in exports lists KJV, Strong's, and OpenBible, but not the commentaries or STEPBible.
   - Each excerpt carries its own citation, so attribution is present.
   - A fuller footer would be a small Cycle 5 polish.
6. **AI response time.** The server waits up to 120 seconds. A long "Explain" on a large study could hit that and show a "could not reach" message.

## 5. What you can verify before approving (about 20 minutes)

### A. Real AI on the preview
1. In Vercel, go to Settings, then Environment Variables. Add `ANTHROPIC_API_KEY` and `AI_ACCESS_CODE` for **Preview**, branch `kaizen/cycle-4`.
2. Go to Deployments, open the latest `kaizen/cycle-4` deployment, and click Redeploy.
3. On the preview: Settings, turn on the AI assistant, and enter your access code.
4. Open Romans 8:28, then Study this passage. On the Commentary tab, pick JFB. On the AI tab, run each task:
   - **Compare the commentaries:** every section shows source chips, and clicking a chip opens that commentary note.
   - **Explain the original words:** it mentions G4903 and does not invent Strong's numbers.
   - **Ask:** type "What does all things include?" and you get an answer, or an honest "the materials don't say".
   - **Wrong access code:** you see a clear refusal.

### B. iPhone Safari (repeat in Android Chrome)
1. Open Genesis 1, set View to Interlinear, and confirm the Hebrew reads right to left with nothing cut off.
2. Tap a Hebrew word. The word study opens and the Hebrew font looks right.
3. Open John 3 in Interlinear, tap "loved", then open BDB, Forms, Commentary, and Context.
4. Romans 8:28, Study this passage, save a commentary excerpt, then Turn into sermon. Export .docx and .pdf and open them on the phone.
5. Rotate the phone. Nothing should overflow sideways.

### C. Screen reader spot check
- **VoiceOver:** Settings, Accessibility, VoiceOver. Swipe through the interlinear. Each word should read its English and Strong's number. The Commentary and Context tabs should announce as tabs.
- **TalkBack:** run the same steps on Android.

## 6. Next step

Your call: approve the merge now, or run sections A and B first. I won't merge or deploy until you say so. Cycle 5 has not started.

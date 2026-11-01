# Kaizen Cycle 4 Completion Report
Carter Study Bible: Comprehensive Biblical Research & Advanced Study
Branch: `kaizen/cycle-4` (commit a94dc82). Pushed for preview only. NOT merged, NOT in production.
Started after confirming Cycles 1–3 and the Search button were merged, passed CI, and deployed (main = cf4a70a).
Date: October 31, 2026

## Summary

| Area | Result |
|---|---|
| Commentary library (H6) | 6 verified public-domain commentaries; 4 requested works documented as not included |
| Hebrew & Greek research (H8) | Actual inflected words for all 31,102 verses, full grammar from STEPBible's tables, BDB with roots |
| Interlinear | Optional reader view; Hebrew right to left; every word opens its study |
| Historical context | Sourced excerpts only (ISBE + commentary introductions), as you approved |
| Cross-references | Search, compare, open with a way back; no invented categories |
| Study This Passage | One connected workspace: Scripture, words, commentary, context, cross-references, AI, notes, sermon |
| AI | Same protected endpoint; grounded in cited sources; unsupported sources removed and flagged |
| Beginner / Advanced | Same sources, different depth; remembered |
| Your data | Unchanged: upgrade test 29/29 from the live version |
| Tests | 189/189 unit, 170/170 browser (twice), 0 accessibility findings, CI green, Vercel preview built |

## Decisions you made during this cycle
1. Integrate the 6 verified commentaries; hold back Treasury of David; list Gill, Barnes, and Wesley as not verified.
2. Approve STEPBible TAHOT/TAGNT and the Open Scriptures BDB (CC BY 4.0).
3. Host on Vercel, proven on a preview first.
4. Context from sourced excerpts, not generated summaries.
5. BDB: show every real definition, with incomplete entries labeled.

## A. Previous condition

| Area | Before Cycle 4 |
|---|---|
| Commentaries | None |
| Hebrew | Dictionary form (lemma) only, from Strong's. No grammar, no actual word as written. BDB deliberately excluded (needed permission). |
| Greek | Form and grammar from the KJV's tagging. Abbott-Smith sense ranges. |
| Interlinear | None |
| Context | ISBE dictionary, searchable separately; nothing tied to the passage |
| Cross-references | A list with verse text and "Add to study" |
| Study Workspace | Scripture, tools (word, dictionary, thesaurus, cross-refs, notes, AI), and the worksheet |
| AI | Organize, questions, summarize, outline; verified quotes, references, and Strong's |

## B. Verified problems and root causes
1. **No commentary system.** No licensed source had been integrated.
2. **Hebrew surface forms and grammar missing.** The KJV's OSIS tagging carries Strong's lemmas only for the Old Testament.
3. **Research scattered.** Background, words, and references lived in separate places, not centered on the passage.
4. **AI not grounded in research sources.** It only saw the passage, word studies, and notes.

## C. Implemented improvements

### Commentary library
- **Six works:** Matthew Henry Complete and Concise, Jamieson-Fausset-Brown, Adam Clarke, Keil & Delitzsch (OT only), and Scofield 1917.
- **Exact coverage levels:** book, chapter, passage, and verse, exactly as each source assigns them. A note on verses 14–16 is labeled "passage note, verses 14–16".
- **Introductions separated:** introductions that sources store inside a verse entry (Clarke's Genesis preface sits in 1:1) are split out by explicit, logged rules. 1,249 splits were reviewed via the build log.
- **Reprinted Bible text labeled:** Bible text that Matthew Henry reprints is marked "Bible text (KJV) as printed in this commentary".
- **Commentary tab features:**
  - choose a commentary and compare two side by side
  - a "Notes on this verse in:" coverage line
  - an honest "has no note that includes…" message
  - search within a book
  - save an excerpt (or selected text) with a full citation, or an excerpt plus your note
  - about 249,000 Scripture links
  - author, era, perspective (labeled editorial summary), edition, rights, and source for each work
- **Not included, shown in-app with reasons:** Gill, Barnes, Wesley (no verifiable source reachable) and Treasury of David (transcription source unstated; under review).

### Hebrew and Greek
- **Coverage:** every verse has its actual Hebrew (Leningrad Codex) or Greek words, 441,714 words in all, keyed to KJV verse numbers by the source itself (Psalm titles = verse 0).
- **Word study, "As written in this verse":**
  - Hebrew prefixes and suffixes shown as parts (Ps 23:1 רֹעִי = "shepherd" + "my")
  - transliteration and the gloss in this verse
  - STEPBible's sense label for this word ("to create")
  - grammar in plain words (Beginner) or full fields with codes (Advanced), all from STEPBible's official expansions; 0 codes left unexplained
- **Greek edition notes:** 4,072 words appear only in the Textus Receptus behind the KJV, 883 only in critical editions, and 284 only in other editions; each is labeled.
- **BDB (Hebrew):**
  - real BDB definitions, roots, and related words
  - 560 complete entries; partial ones labeled "BDB basic definitions; the full entry is not yet transcribed"
  - when Strong's joins words BDB separates (H1254 "create" / "be fat"), all are listed with a note, never auto-picked
- **Forms in Scripture:** every form a word takes, with counts.
- **Kept and unchanged:** Strong's, Abbott-Smith, KJV renderings, occurrences, and the context caution note.

### Interlinear
- **View control:** Reading / Word study / Interlinear in the reader, remembered.
- **Each word box:** the original word, transliteration, and English gloss; Strong's and grammar are optional ("grammar").
- **Hebrew direction:** runs right to left.
- **Verse lines:** your translation line (and comparison) under each verse.
- **Advanced mode:** shows which KJV words carry the same Strong's numbers.
- **Integration:** verse numbers, highlights, bookmarks, and notes still work; selecting a word opens its study.

### Context
- **Context tab, with every item labeled by source and date:**
  - surrounding verses
  - the ISBE (1915) article on the book (a hand-checked mapping; 42 books have one)
  - each commentary's introduction to the book
  - each commentary's chapter overview
- **Plain notes:** what isn't available is stated, and that older sources may reflect views debated today.

### Cross-references
- **Search:** filter by book name or by words in the linked passages.
- **Compare:** up to 4 side by side.
- **Open:** opens in the reader with "← Back to Romans 8:28"; inside a study, it opens in the Scripture panel.
- **Translation:** text shown in your reading translation.
- **No invented categories:** the source has relevance votes only, and the panel says so.

### Study This Passage (unified)
- **Same workspace:** "Study this passage" still opens the existing Study Workspace, now with Commentary and Context tabs.
- **Original words:** the Word tab lists the passage's Hebrew or Greek words.
- **Follows the passage:** tools follow the studied passage.
- **Research flows on:** excerpts save into the existing worksheet and carry into the existing "Turn into sermon or lesson".
- **No new note system:** Romans 8:28 was tested end to end.

### AI grounding
- **Same endpoint, same protections:** the access code and rate limits still apply.
- **New tasks:**
  - explain the passage
  - compare the commentaries
  - explain the original words
  - ask a question (500-character limit, fenced in the prompt)
- **Labeled sources:** the materials now include commentary notes covering the passage (your chosen commentaries) and the passage's original words with grammar, Strong's, and Abbott-Smith, each with a source ID.
- **Stricter rules for the model:**
  - cite source IDs per section
  - never attribute a view to a source unless its excerpt states it
  - label synthesis and contested readings
  - not authority or revelation
- **App-side checks:**
  - unknown source IDs are removed with a warning
  - a section naming a commentator without citing that commentator's excerpt is flagged
  - valid sources show as buttons that open the exact commentary note or word study
- **Earlier safeguards unchanged:** the quote, reference, and Strong's checks still run.

### Beginner and Advanced
- **Detail switch:** a "Detail" switch at the top of the study tools.
- **Beginner:** plain grammar, fewer codes, and lexicons folded.
- **Advanced:** full fields and codes, KJV correspondences, and BDB open.
- **Same sources:** both modes use the same data, and the setting is saved.

## D. Source verification

| Resource | Edition / version | Source (pinned) | Rights | Status |
|---|---|---|---|---|
| Matthew Henry, Complete | CCEL text (from Logos); module v2.2 | CrossWire GitLab `mhc` @537591a | Public domain ("Copy Freely") | Approved |
| Matthew Henry, Concise | Moody Press printing via CCEL; v2.0 | `mhcc` @b15ff40 | Public domain | Approved |
| Jamieson-Fausset-Brown (1871) | CCEL; v3.0 | `jfb` @9f7106f | Public domain | Approved |
| Adam Clarke (1810–26) | Wikisource + sacred-texts; v2.0 | `clarke` @bd94d38 | Public domain | Approved |
| Keil & Delitzsch (Eng. 1866–91) | Wikisource; v2.0 | `kd` @206b2f6 | Public domain | Approved |
| Scofield Notes (1917) | Wikisource; v2.1 | `scofield` @e46fa4f | Public domain (US and UK) | Approved |
| Treasury of David | — | `tdavid` | Work is PD; transcription source unstated | Held for review |
| Gill, Barnes, Wesley | — | not reachable | — | Not verified, excluded |
| STEPBible TAHOT/TAGNT, TEHMC/TEGMC | STEPBible-Data @be4191f | GitHub | CC BY 4.0 (attribution) | Approved |
| Open Scriptures Hebrew Lexicon (BDB 1906) | HebrewLexicon @21c9add | GitHub | CC BY 4.0; BDB text public domain | Approved (partial entries labeled) |

- **Checksums:** every commentary file is checked against its pinned SHA-256 at build time; a mismatch stops the build.
- **Attribution:** all attributions, versions, changes, and checksums are on the Sources page.
- **STEPBible's request honored:** STEPBible asks that its raw files not be redistributed. The app ships only reformatted data inside the app.

## E. Technical changes

**New files**
- **Build scripts:** `scripts/build_commentaries.py`, `scripts/build_original.py`.
- **Components:** `src/components/CommentaryPanel.tsx`, `ContextPanel.tsx`, `OriginalWord.tsx`, `Interlinear.tsx`.
- **Shared helper:** `src/lib/grammar.ts`.
- **Tests:** `tests/commentary.test.ts`, `tests/original.test.ts`.

**Changed files**
- **Reader and pages:** `Reader.tsx` (view modes, interlinear, way back), `WordPanel.tsx` (original word, BDB, forms, passage words), `ReferencePanels.tsx` (cross-references), `ToolsPane.tsx` (tabs, detail level), `WorkspacePage.tsx`, `BiblePage.tsx`, `OtherPages.tsx` (Sources).
- **AI:** `src/ai/assist.ts`, `AiPanel.tsx`, `Blocks.tsx` (draft sources), `api/assist.ts`.
- **Data and state:** `src/lib/data.ts`, `state.tsx`, `db.ts` (an optional `sources` field on AI drafts; no storage change).
- **Styles:** `index.css`.
- **Data pipeline:** fetch, build, and meta scripts.

**New data** (all loaded only when used)
- `public/data/commentary/` (7,256 files, 111 MB)
- `orig/` (1,338 files, 37 MB)
- `bdb/` (87 files, 5.7 MB)

**Deployment:** about 14,860 files and 309 MB. The Vercel preview built and deployed successfully.

## F. Test results

| Test | Result |
|---|---|
| Unit tests | **189 / 189** |
| Commentary mappings, attribution, rights, safe markup, real links, intro splits, coverage honesty | 13 / 13 |
| Hebrew lookups, Greek grammar, every chapter covered, every grammar code explained, BDB homographs and status | 9 / 9 |
| AI endpoint: new tasks, same guard, question limits, source rule in the prompt | 13 / 13 |
| Browser suite (Cycles 1–4), run twice | **170 / 170** both times |
| Cycle 4 browser checks (both Testaments, desktop and phone) | 35, all pass |
| Accessibility (new screens; light and dark; desktop and phone) | **0** serious/moderate findings |
| Accessibility (Cycle 3 pages re-checked) | 0 findings; 35 keyboard stops per chapter |
| Security policy blocks during the full run | 0 |
| Upgrade test (live version data → Cycle 4) | **29 / 29** |
| GitHub CI · Vercel preview | Passed · Built |

## G. Performance
Conditions as in earlier cycles: Lighthouse slow 4G (150 ms, 1.6 Mbps), 4× slower CPU, median of 3.

| Measure | Cycle 3 | Cycle 4 |
|---|---|---|
| First chapter (cold, John 3) | 2,154 ms | 2,257 ms (+0.1 s; same ~180 KB of code) |
| Next chapter after reading | 177 ms | ~200–300 ms (run-to-run range) |
| First search ("living water") | 2.0–2.2 s | 2.0–2.3 s |
| Repeat search | 1.35 s | 1.38 s |
| Main app code (compressed) | 180 KB | **127 KB** (research tools load when opened) |

New features, each measured alone with the app already open:

| Feature | Time | Downloaded |
|---|---|---|
| Commentary tab | 1.3 s | 20 KB |
| Word study with the Greek word (John 3:16) | 1.6 s | 92 KB |
| Word study with the Hebrew word (Gen 1:1) | 1.2 s | 90 KB |
| Interlinear view (John 3) | 1.1 s | 13 KB |
| Context tab (Romans 8:28) | 1.4 s | 48 KB |
| Opening BDB (includes Strong's and concordance files) | 2.6 s | 271 KB |

The reader itself downloads no commentary, lexicon, or interlinear data (verified by test).

## H. Data preservation
- **Storage unchanged:** database name, version, and tables are unchanged. The only type change is an optional `sources` list on AI drafts, which older drafts simply lack.
- **Upgrade test:** live-version data (151 notes, 101 highlights, 41 bookmarks, a study, a sermon, 25 dictionary entries, a folder, and settings) is identical after the upgrade.
- **Backups:** a live-version backup merges with no duplicates and restores exactly into a fresh browser.
- **New settings:** commentary choice, detail level, and interlinear are added with defaults, so existing settings are untouched.

## I. Remaining issues
1. **Commentaries not included:** Gill, Barnes, and Wesley have no verifiable source reachable here. Treasury of David awaits confirmation of its transcription source.
2. **Gaps in the sources themselves:** for example, Matthew Henry Concise in this edition has no comment on John 3:9–21. The app says so rather than filling it.
3. **BDB:** only 560 entries are complete (the rest are labeled). Strong's homographs are listed together because the two numbering systems can't be matched automatically without guessing.
4. **No cross-reference categories:** the source doesn't provide types (quotation, parallel, prophecy), so none are shown.
5. **No structured book introductions:** fields like author, date, and audience aren't available from a licensed source. ISBE has no book article for 24 books; Context says so.
6. **Commentary search:** works within one book at a time, not across the whole Bible.
7. **Interlinear and KJV wording:** the link to KJV words is through Strong's numbers (Advanced). It isn't a word-for-word alignment of every English word.
8. **Offline:** downloads cover Bible text. Commentaries and lexicons work offline only once opened.
9. **Deployment size:** about 309 MB and 14,860 files. The preview built fine, but this is large, so watch it if more data is added.
10. **AI:** tested with mocked AI responses. The grounding checks run in the app, but the live model wasn't called from here.
11. **Testing limits:**
   - tested in Chromium only, not real phones or screen readers
   - first-chapter time is about 0.1 s slower than Cycle 3
   - some lint style notes remain (no errors)

## J. Recommendations for Cycle 5
1. **Reading plans (H7):** daily plans tied to Study This Passage and offline reading.
2. **Verify and add the remaining commentaries:** confirm Treasury of David's source; find verifiable Gill, Barnes, and Wesley editions.
3. **Whole-Bible commentary search:** a compact index like the Scripture search.
4. **Structured book introductions:** if Tyndale Open Study Notes (CC BY-SA) can be reached and its terms fit, add it, with its share-alike terms reviewed with you first.
5. **Offline research packs:** optional downloads of commentaries and lexicons.
6. **Real-device and screen-reader pass:** iPhone/VoiceOver and Android/TalkBack.

## Your next steps
1. **Open the preview:** Vercel, then Deployments, remove the Production filter, open the newest **kaizen/cycle-4** row, and click **Visit**.
2. **Try:**
   - Romans 8:28: select it, then **Study this passage**.
   - Work through the tabs: Word (Greek words), Commentary (compare two), Context, Cross-refs, and AI if enabled.
   - Save an excerpt, then **Turn into sermon or lesson**.
   - Switch the reader to **Interlinear** on Genesis 1.
3. **Approve:** reply **"approved to merge"** when you're satisfied. Nothing goes to production until you say so.

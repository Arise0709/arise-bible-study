# Kaizen Cycle 2 Completion Report
Carter Study Bible: Scripture Search, Accuracy & Performance
Branch: `kaizen/cycle-2` (commit 0a1db92). Pushed for preview only. NOT merged, NOT in production.
Date: October 31, 2026

## 1. Summary

| Item | Target | Result |
|---|---|---|
| H1 Single-chapter books | "Jude 3" opens Jude 1:3 | Done, all 5 books |
| H2 Search speed | First search under 5 s (slow 4G) | **2.0 s** (was 19.2 s) |
| H3 Search across translations | BSB "one and only Son" finds John 3:16 | Done, all 8 translations |
| H5 Range bookmarks | John 3:16-17 marks both verses | Done |
| M8 Search and reference usability | 7 improvements | Done |
| Existing features | Fully functional | 108/108 browser checks, 152/152 unit tests |
| Stored data | No changes to storage | Database, backup, autosave, settings code untouched |

GitHub automated checks: passed. Vercel preview build: completed.

## 2. Previous condition and root causes

| Issue | Previous condition | Root cause |
|---|---|---|
| H1 | "Jude 3" tried to open Jude chapter 3, which doesn't exist | The parser always read the first number as a chapter, with no rule for books that have only one chapter |
| H2 | First search took 19.2 s on slow 4G (audit: ~20 s) | Search downloaded all 66 KJV books *with full Strong's word tagging* (3.7 MB compressed, 16 MB raw), then rebuilt the whole index on every page load |
| H3 | Search covered the KJV only | The search worker was written to read only the KJV files |
| H5 | Bookmarking John 3:16-17 showed no marker on either verse | Range bookmarks are stored as "John.3.16-John.3.17", but the reader only checked for an exact single-verse key like "John.3.16" |
| M8 | "John 3:16,18" and "Phil 4 13" ran as word searches; ranges marked only the first verse; Gen 50:27 opened silently; no spelling help | The parser accepted only one reference with a colon; the reader's address held only one verse number |

## 3. Changes implemented

### H2: Search speed
- **New prebuilt search files** for each translation (`scripts/build_search.mjs`):
  - a **word index split by first letter**: "grace" downloads only the "g" file (19 KB instead of 3.7 MB)
  - **verse text in pages of 64 verses**: showing results downloads only the pages that hold them
  - a **word list** used only for spelling suggestions
- **Exact by design:** every search term is still the same expression tested against the same verse text. The index only decides which verses could match. Phrases and punctuation are still checked against the actual text.
- **Faster display:** the count and references appear as soon as they're known, and the verse text fills in a moment later.
- **Caching:**
  - files stay in memory for the session
  - the browser's HTTP cache keeps them across visits (1 day, with background refresh)
  - the index is never rebuilt
- **Parallel downloads:** files download in parallel instead of book by book.

### H3: Search across translations
- **Picker:** a "Translation" picker on the search page offers KJV (the default), BSB, NHEB, ASV, YLT, WBS, BBE, and GNV.
- **Attribution:** results name the translation, and non-KJV results show its year and license with a link to Sources.
- **Empty verses:** a few verses are empty in some translations (for example, the BSB omits Matthew 17:21). These are treated as "not in this translation".

### H1 and M8: References
- **Single-chapter books:** Obadiah, Philemon, 2 John, 3 John, and Jude:
  - "Jude 3" opens Jude 1:3, and "Jude 3-5" is a verse range
  - "Jude 1:3" still works, and a bare "Jude 1" still opens the book
  - references written inside notes follow the same rule
- **Flexible formats:**
  - "Phil 4 13" works without a colon
  - en and em dashes work in ranges ("Romans 8:28–39")
- **Lists:**
  - "John 3:16,18" and "Rom 8:28-30, 38-39"
  - "Gen 1:1; 2:7" and "John 3:16; Rom 5:8"
- **Range highlighting:** every verse of a range or list stays marked in the reader (all 12 verses of Romans 8:28–39). Your own highlight colors stay visible.
- **Missing verses:** "Genesis 50 has 26 verses, so verse 27 does not exist. Showing the whole chapter."
- **Spelling help:**
  - "Jhon 3:16" offers John 3:16
  - "beleive" with no results offers "Did you mean believe?"
- **Word forms (optional):** an option to "include related word forms", off by default. When on, it lists exactly which forms were added. It's disabled for exact phrases, so a phrase is never broadened.
- **Unchanged:** all existing operators ("quotes", `*`, all/any/phrase, testament and book filters, whole words) work as before.

### H5: Range bookmarks
- **Markers:** bookmarks on a range, a whole chapter, or across chapters mark every verse they cover.
- **No duplicates:** bookmarking a verse already inside a bookmarked range shows "Already bookmarked as John 3:16-17" instead of adding a duplicate.
- **Updates:** deleting a range bookmark clears all its markers right away.
- **Storage:** existing bookmark records are read as-is, with no changes to how they're stored.

## 4. Files and components modified

| File | Change |
|---|---|
| `scripts/build_search.mjs` (new) | Builds the search files |
| `public/data/search/` (new, 4,120 files) | Search files for 8 translations |
| `src/lib/searchEngine.ts` (new) | The search engine |
| `src/lib/search.worker.ts` | Loads and caches search files |
| `src/lib/search.ts` | Count and references first, text after |
| `src/lib/refs.ts` | Single-chapter books, lists, flexible formats, suggestions, verse lists in addresses |
| `src/pages/OtherPages.tsx` (search page only) | Translation picker, word forms, suggestions, attribution |
| `src/pages/BiblePage.tsx` | Reads "16,18" and "28-39" from the address |
| `src/components/Reader.tsx` | Range marking, range bookmarks, no duplicates, missing-verse warning |
| `src/index.css` | Range marker style |
| `tests/search.test.ts`, `tests/refs.test.ts` (new) | Tests |
| `e2e/acceptance.cjs` | Section 18 (Cycle 2) |
| `scripts/build_all.sh`, `package.json`, `README.md` | Build step and docs |

**Not touched:** database, backups, autosave, settings storage, AI server, Bible text, Strong's data, dictionaries, cross-references.

## 5. Tests performed and results

| Required test | What was done | Result |
|---|---|---|
| 1. Reference-parser unit tests | All 5 single-chapter books (10 forms), explicit chapter:verse, ranges, notes, lists, flexible formats, addresses, invalid verses, book suggestions | 32 pass |
| 2. Search accuracy regression | The **original search code, copied unchanged**, runs beside the new engine on 61 KJV queries (all audit baselines, operators, filters, punctuation, wildcards, edge cases) comparing count, order, and text of every result. The `*` query compares the text of all 31,102 verses. | 61/61 identical |
| 3. Search speed | The audit's own script: phone screen, Lighthouse "slow 4G" (150 ms, 1.6 Mbps), 4x slower CPU | See section 6 |
| 4. Cross-translation search | All 7 other translations compared to a full scan of their text (7 queries each, including every verse); BSB "one and only Son" finds John 3:16 | 8/8 pass |
| 5. Bookmark-range browser tests | John 3:16-17 marks both verses, no duplicate, deleting clears both | Pass |
| 6. Mobile usability | Search page fits a phone screen with no sideways scrolling; ranges marked on a phone | Pass |
| 7. Data integrity | KJV data integrity tests; every verse's search text matches the source; storage code unchanged | Pass |
| 8. Existing regression tests | Full browser suite run twice back to back; full unit suite; type check; GitHub CI | 108/108 (x2), 152/152, pass, green |

## 6. Search performance: before and after

Same conditions as the audit: phone screen, slow 4G, 4x CPU slowdown, local server with gzip. Production uses brotli, which is smaller, so live times should be the same or better.

| Measure | Before | After |
|---|---|---|
| First search ("living water"), count shown | 19.2 s | **2.0 s** |
| First search, verse text shown | 19.2 s | **2.0 s** |
| Next search after reload ("grace") | 2.9 s | **1.4 s** |
| Search data downloaded for "grace" | ~3.7 MB | ~19 KB index + text pages |

Harder first searches (each in a fresh browser, nothing cached):

| Search | Results | Count shown | Text shown |
|---|---|---|---|
| "lord" | 6,667 | 1.4 s | 1.6 s |
| "the" | 24,091 | 1.9 s | 2.0 s |
| "the lord is my shepherd" | 1 | 2.4 s | 2.5 s |
| believ* | 287 | 1.4 s | 3.2 s |
| love + word forms | 440 | 1.4 s | 3.0 s |
| grace (BSB) | 127 | 1.5 s | 2.7 s |
| "one and only Son" (BSB) | 6 | 2.4 s | 2.5 s |
| beleive (with suggestion) | 0 | 2.0 s | 2.1 s |

Every case is under the 5-second target.

## 7. Remaining issues

1. **Notes on verse ranges** still show their marker only on the first verse. This is the same kind of bug as H5, found during this work and left alone because notes weren't in scope.
2. **Cross-chapter ranges** (Gen 1:1–2:3) open at the first verse but only mark that verse.
3. **Word forms use simple ending rules** (believe, believed, believeth, believing). Irregular forms such as speak/spake are not grouped. The option lists exactly what it adds, so nothing is hidden.
4. **Search-term highlighting** in results still works only for single-word searches, as before.
5. **Opening a chapter on slow 4G takes about 3.6 seconds.** The reader loads a whole tagged KJV book (John is 742 KB raw). This wasn't in scope.
6. **Deployment size:** the deployment grows by about 45 MB, in 4,120 small files. Vercel built the preview without issue.
7. **Search defaults to the KJV**, not your reading translation, to keep existing behavior. This is easy to change if you prefer.
8. **Browser coverage:** tested in Chromium only.

## 8. Recommended Cycle 3: Accessibility, reliability, and reading speed

| Item | Why |
|---|---|
| H4 Keyboard and screen-reader barriers | 598 tab stops on one chapter; the largest remaining usability gap |
| M1 Two open tabs overwrite each other | Finishes the data-safety work from Cycle 1 |
| Notes on verse ranges | Same fix pattern as H5 |
| Faster chapter loading | Split reading text from word tagging, as was done for search |
| M10 Offline reading | Builds on the installable app from Cycle 1 |
| M4 Security headers, self-hosted fonts | Small hardening and privacy step |

Larger feature work (H6 commentaries, H7 reading plans, H8 deeper original-language tools) is best as its own cycle after these.

## 9. Your next steps

1. **Try the preview:** in Vercel, open Deployments and remove the "Environment Production" filter. Open the newest kaizen/cycle-2 row and click Visit.
2. **Things to test there:**
   - type "Jude 3"
   - type "John 3:16,18"
   - type "Romans 8:28-39"
   - search BSB for "one and only Son"
   - bookmark John 3:16-17
   - search "beleive"
3. **Approve:** reply "approved to merge" when you're satisfied. Nothing goes to production until you say so.

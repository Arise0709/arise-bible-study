# Arise Bible Study

A Bible study app for reading the King James Version, studying words in their original Hebrew and Greek, and turning that study into sermon and teaching notes.

Built for beginners and for pastors, teachers, and experienced students.

## What it does

The core workflow:

**Open a KJV passage → click a word → explore its Strong's entry → check the dictionary and thesaurus → save a study → turn it into a sermon or lesson → export it.**

- **Bible:** the full KJV (66 books, 31,102 verses) by book, chapter, and verse. Search by reference (`Rom 8:28`), word, phrase (`"God so loved"`), or Strong's number (`G26`). Highlight, bookmark, and attach notes to single verses or ranges. Words the translators added are in italics, the words of Jesus can show in red, and the 1611 translators' margin notes can be switched on.
- **Word study:** click any tagged word to see the Strong's number, the original Hebrew or Greek word, transliteration, pronunciation (Hebrew), part of speech, definition, the Greek range of meanings (Abbott-Smith), how the KJV translates it (counted from the actual text), every verse where it is tagged, and related words. It handles phrases that stand for several original words, several English words for one original word, words split across a verse, translator-added words, and untagged words. It never guesses.
- **Dictionary:** ISBE (1915) for people, places, customs, and terms; Hitchcock's Bible Names; Webster 1913 for older English senses; and a labeled list of archaic KJV words. Build your own dictionary entries with your definition, Strong's numbers, Scripture, examples, notes, tags, and sources, always kept separate from published sources.
- **Thesaurus:** KJV-era meaning next to modern meaning (WordNet), synonyms, antonyms, and real KJV verses that show how the sense shifts. Presented as a writing aid, not proof of an interpretation, and kept apart from Hebrew and Greek word relationships.
- **Study Workspace:** Scripture, study tools, and notes side by side (three resizable panels on desktop, tabs on mobile) with a guided breakdown worksheet: Passage, Context, Observation, Word study, Cross-references, Interpretation, Application, Summary. Scripture quotes, sourced material, your conclusions, and AI drafts are visually and structurally different blocks. Mark any note as uncertain or debated.
- **Sermons & Lessons:** blank outlines or templates (expository sermon, Bible study lesson, topical study, small-group discussion), or build one straight from a study. Title, passage, main idea, objective, audience, length, sections and subpoints, Scripture blocks, word-study insights, illustrations, applications, discussion questions, conclusion, sources. Autosave, drafts, tags, folders, drag-to-reorder, teaching view, print, and export to PDF, Word, and Markdown.
- **Word and PDF exports use the Arise notes template** (`public/templates/notes-template.docx`): the same header, footer, fonts, gold Scripture boxes, and section headings as the church's sermon manuscripts. In your notes, start a line with `KEY TRUTH:`, `HARD TRUTH:`, `PRAYER:`, `[PREACHER NOTE]` (or any `[LABEL]`), or `- ` (bullet) to get the matching template format. The PDF uses the same layout with the Inter font (SIL Open Font License, `public/fonts/OFL.txt`) in place of SF Pro. To change the look, replace the template file with an updated template that keeps the `{{BODY}}`, `{{HEADER_TITLE}}`, `{{HEADER_REF}}`, and `{{FOOTER}}` placeholders.
- **Saved Studies:** your studies, verse notes, bookmarks, and recent places, with "pick up where you left off".
- **Optional AI assistant:** off by default. See below.

**Settings → Appearance:** Daylight, Dark, or match your device; six color themes (including Arise gold); warm, white, or sepia pages; seven Bible fonts and four app fonts; text size and line spacing, with a live preview. **Settings → Bible translations:** read in the KJV (with Strong's) or BSB, NHEB, ASV, YLT, Webster 1833, BBE, or Geneva 1599, and show a second translation under each verse to compare. Studies and sermons quote Scripture in your chosen translation (Settings → Quote Scripture in), each remembers its translation, and the editor can switch every quote at once.

Also: adjustable text size, keyboard navigation (`/` search, `[` `]` chapters, `?` help), and layouts for desktop, tablet, and phone.

## Data sources and licensing

Every verse, Strong's entry, cross-reference, and dictionary article comes from a published source. Exact versions, licenses, and SHA-256 checksums are in `public/data/sources.json` and on the app's **Sources** page.

| Data | Source | License |
|---|---|---|
| KJV text with Strong's tagging, italics, red letters, margin notes | CrossWire Bible Society KJV module (`kjvfull.xml`) | Public domain (Crown copyright in the UK) |
| Strong's Hebrew and Greek dictionaries | Open Scriptures `strongs` | CC BY-SA |
| Part of speech, short glosses, Greek senses (Abbott-Smith 1922) | STEPBible TBESH / TBESG | CC BY 4.0 |
| Cross-references | OpenBible.info | CC BY |
| Bible encyclopedia | ISBE (1915), via CrossWire | Public domain |
| Bible names | Hitchcock's Bible Names (1869), via CrossWire | Public domain |
| Older English definitions | Webster's 1913, via CrossWire | Public domain |
| Modern synonyms and antonyms | WordNet 3.1 | WordNet License |
| Other translations for reading and comparing: BSB, NHEB, ASV, YLT, Webster (1833), BBE, Geneva (1599) | scrollmapper/bible_databases (pinned commit) | BSB is CC0; the rest are public domain |
| Archaic word modern equivalents | App editorial list (`scripts/editorial/archaic.json`) | App content, labeled in the UI |

Notes:

- STEPBible's Hebrew "meaning" column (Abridged BDB from Online Bible) needs separate permission, so it is **not** used. Hebrew entries show Strong's definitions and STEPBible glosses.
- The Open Scriptures Greek dictionary has no pronunciation field, so Greek entries show transliteration only, and the app says so.
- Every sample verse in the editorial archaic list is checked at build time to exist and contain the word. The build fails if one does not.
- The share-alike terms of CC BY-SA apply to the Strong's data files in `public/data/strongs`.

## Running locally

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173.

## Deploying to Vercel

1. Push this repository to GitHub.
2. In Vercel, choose **Add New → Project** and import the repository. Vercel detects Vite; `vercel.json` sets the build command, output folder, SPA routing, and caching.
3. Deploy. The app works fully without any environment variables.

### Turning on the AI assistant (optional)

1. In the Vercel project, open **Settings → Environment Variables** and add `ANTHROPIC_API_KEY`.
2. Add `AI_ACCESS_CODE`, a private passphrase of your choosing. Without it the assistant stays locked, so strangers cannot run up your bill.
3. Redeploy.
4. In the app, open **Settings**, switch on the AI assistant, and enter the access code. An **AI** tab appears in the Study Workspace.

Optional limits (enforced on the server):

| Variable | Default | Meaning |
|---|---|---|
| `AI_LIMIT_PER_MINUTE` | 6 | Requests per person per minute |
| `AI_LIMIT_PER_DAY` | 60 | Requests for the whole site per day |
| `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or Vercel KV's `KV_REST_API_URL` and `KV_REST_API_TOKEN`) | not set | Shares the counters across all server instances. Without them, each instance counts on its own. |

Ten wrong access codes in an hour lock that visitor out for the hour. Also set a monthly spend limit in the Anthropic Console as a final safety net.

The key stays on the server (`api/assist.ts`). The assistant only sees the study you send it (the passage text, your word studies, and your notes). It can organize observations, suggest study questions, summarize your notes, or draft an outline. Before anything is shown, the app checks every quotation against the KJV text, every Strong's number against the lexicon, and every citation against your study materials. Quotations that do not match are removed, and anything questionable is flagged. All output is labeled as an AI draft.

## Your data

Notes, highlights, bookmarks, studies, sermons, and dictionary entries are stored in the browser (IndexedDB) on each device. Use **Settings → Download backup** regularly, and **Restore from backup** to move your work to another device or browser. Restoring shows a preview first and lets you merge (nothing deleted) or replace (with a safety copy downloaded first).

If something breaks, the app sends an anonymous error report (message, code location, page name, browser type; never your content) to `/api/log-error`, which writes it to the Vercel function logs. Turn this off in **Settings → Your data**.

## Tests

```bash
npm test
```

Unit tests: reference parsing, Greek grammar decoding, data integrity (66 books, 31,102 verses, exact text spot checks, Strong's mappings, no missing lexicon entries), and export content.

```bash
npm run build && npx vite preview --port 4173
```

```bash
npm run e2e -- http://127.0.0.1:4173
```

The end-to-end script (Playwright) walks the full acceptance workflow: navigation and search, word mappings, dictionary and thesaurus, study persistence after reload, personal dictionary, sermon editing and reordering, exports (checks the Markdown and Word contents and the PDF header), missing-data handling, mobile layout, and the AI safety checks with a deliberately bad mocked AI answer.

## Offline reading and security

- **Offline:** a service worker (`sw/sw.js`, built into `dist/sw.js` with this version's file list) keeps the app and recently read chapters on the device. In **Settings → Offline reading**, whole Bibles can be downloaded (the KJV is always included). When a new version is deployed, open pages show "A new version is ready" and switch over only when reloaded, so a device never mixes versions. Notes, studies, sermons, and backups are unaffected (they live in the browser database).
- **Security headers:** set in `vercel.json` (Content Security Policy, no framing, no MIME sniffing, strict referrer, locked-down permissions, HSTS). `vite preview` sends the same headers, and the browser tests fail if anything is blocked.
- **Fonts** are self-hosted from open-source (OFL) `@fontsource` packages; the app makes no requests to other sites.
- **Two tabs:** studies and sermons are only saved if no other tab has saved a newer version; otherwise the editor asks which version to keep and saves the other as a separate copy.

## Rebuilding the data

The generated data in `public/data` is committed so deploys are reproducible. To rebuild it from the pinned sources:

```bash
npm run data:fetch
```

```bash
npm run data:build
```

Requires Python 3.10+ and Node.js.

The KJV is also split into one file per chapter (`public/data/kjv/{Book}/{chapter}.json`, from `scripts/build_chapters.mjs`) so the reader downloads only the chapter it shows. Rebuild them with `npm run data:chapters`.

The search files in `public/data/search` are built from the Bible text by `scripts/build_search.mjs` (part of `data:build`). After changing any Bible text, rebuild them alone with:

```bash
npm run data:search
```

Each translation gets a small word index split by first letter and its text in pages of 64 verses, so a search downloads only what it needs. `tests/search.test.ts` runs the original full-scan search side by side with the new engine and requires identical results.

## Project layout

```
api/assist.ts          Optional AI assistant (Vercel function)
scripts/               Data pipeline (fetch, parse, validate, attribute)
public/data/           Generated datasets and sources.json
src/lib/               Reference parser, data loaders, search worker, Greek morphology
src/db/                IndexedDB schema (Dexie) and backup/restore
src/components/        Reader, word panel, dictionary/thesaurus, blocks, tools
src/pages/             Bible, Workspace, Dictionary, Sermons, Saved Studies, Settings, Sources
src/export/            One document model rendered to Markdown, Word, and PDF
tests/, e2e/           Unit and end-to-end tests
```

## Adding translations or reference works later

`public/data/sources.json` keeps a `translations` registry, and the reader loads books by translation path. To add a translation, add a parser in `scripts/` that writes the same per-book JSON shape (`chapters → verses → segments`), register it in `sources.json` with its license, and point the loaders at its path. Reference works follow the same pattern: a parser, a JSON output under `public/data/dict/`, and an entry in `sources.json` and the dictionary index.

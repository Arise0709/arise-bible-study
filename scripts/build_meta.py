"""Validate the editorial archaic-word list and write sources.json (attribution, license, checksums).

Every sample reference in scripts/editorial/archaic.json must exist and contain the word.
Any failure stops the build so a wrong citation can never ship.
"""
import hashlib, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data-src")
DATA = os.path.join(ROOT, "public", "data")
BOOKS = json.load(open(os.path.join(ROOT, "src", "lib", "books.json")))

_cache = {}


def verse_text(osis):
    b, c, v = osis.split(".")
    if b not in _cache:
        _cache[b] = json.load(open(os.path.join(DATA, "kjv", f"{b}.json"), encoding="utf-8"))
    ch = _cache[b]["chapters"][int(c) - 1]
    for vv in ch["verses"]:
        if vv["v"] == int(v):
            return "".join(s[0] for s in vv["s"])
    raise KeyError(osis)


def build_archaic():
    items = json.load(open(os.path.join(ROOT, "scripts", "editorial", "archaic.json"), encoding="utf-8"))
    errors = []
    for it in items:
        for r in it["refs"]:
            try:
                t = verse_text(r)
            except Exception:
                errors.append(f"{it['word']}: {r} does not exist")
                continue
            w = it["word"]
            stems = {w, w[:-1]} if w.endswith("e") else {w}
            alt = "|".join(re.escape(x) for x in stems)
            if not re.search(rf"\b(?:{alt})(?:s|es|ed|d|eth|th|ing|ings|est|edst)?\b", t, re.I):
                errors.append(f"{it['word']}: {r} does not contain the word: {t}")
    if errors:
        print("\n".join(errors))
        sys.exit(1)
    with open(os.path.join(DATA, "dict", "archaic-editorial.json"), "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, separators=(",", ":"))
    index = json.load(open(os.path.join(DATA, "dict", "index.json"), encoding="utf-8"))
    index = [e for e in index if e[1] != "archaic"] + [[it["word"], "archaic"] for it in items]
    with open(os.path.join(DATA, "dict", "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    print("archaic entries", len(items), "all references verified")


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_sources():
    S = [
        {
            "id": "kjv", "kind": "translation", "name": "King James Version (1769 Blayney text)",
            "provider": "CrossWire Bible Society, KJV module source (kjvfull.xml)",
            "url": "https://gitlab.com/crosswire-bible-society/kjv", "file": "kjvfull.xml",
            "version": "git d490be7e34762deb2c76cb2c1306d4808e27890d (2023-07-26)",
            "license": "Public domain (Crown copyright in the United Kingdom). CrossWire: General public license for distribution for any purpose.",
            "attribution": "KJV text and Strong's word tagging from the CrossWire Bible Society KJV module.",
            "notes": "Text preserved as in the source. Words in the source's divineName markup (LORD, GOD) are shown in small capitals, as in printed KJVs. Italic words are those the source marks as added by the translators. Margin notes are the 1611 translators' notes carried in the source. Maintainer comments (x-strongsMarkup) are not shown.",
        },
        {
            "id": "strongs", "kind": "lexicon", "name": "Strong's Hebrew and Greek Dictionaries (1890/1894)",
            "provider": "Open Scriptures (openscriptures/strongs)", "url": "https://github.com/openscriptures/strongs",
            "file": "strongs-hebrew.js, strongs-greek.js", "version": "git 0acd2f251c2d35ff8db2dece4e0593979d3ac223",
            "license": "CC BY-SA (JSON edition). Underlying work by James Strong is public domain.",
            "attribution": "Strong's dictionaries, JSON edition (c) Open Scriptures, CC BY-SA. XML e-texts by David Instone-Brewer, David Troidl (Hebrew) and Ulrik Petersen (Greek).",
            "notes": "Share-alike applies to the lexicon data files in public/data/strongs.",
        },
        {
            "id": "stepbible", "kind": "lexicon", "name": "STEPBible TBESH and TBESG lexicons",
            "provider": "STEPBible.org / Tyndale House, Cambridge", "url": "https://github.com/STEPBible/STEPBible-Data",
            "file": "tbesh.txt, tbesg.txt", "version": "git be4191f0082aeedddb0eff0c02c966292b2bd641",
            "license": "CC BY 4.0",
            "attribution": "Data created by www.STEPBible.org based on work at Tyndale House Cambridge (CC BY 4.0).",
            "notes": "Used fields: brief gloss and grammatical code (part of speech) for Hebrew and Greek, and the Abbott-Smith Manual Greek Lexicon (1922) senses for Greek. The Hebrew 'Meaning' column (Abridged BDB, Online Bible) is not used because it requires separate permission. Changes: reformatted to JSON; Scripture references converted to app links.",
        },
        {
            "id": "stepbible-tagged", "kind": "original-language text", "name": "STEPBible TAHOT and TAGNT (tagged Hebrew Old Testament and Greek New Testament)",
            "provider": "STEPBible.org / Tyndale House, Cambridge", "url": "https://github.com/STEPBible/STEPBible-Data",
            "file": "TAHOT (4 files), TAGNT (2 files), TEHMC, TEGMC", "version": "git be4191f0082aeedddb0eff0c02c966292b2bd641",
            "license": "CC BY 4.0",
            "attribution": "Data created by www.STEPBible.org based on work at Tyndale House Cambridge (CC BY 4.0).",
            "notes": "Used for the actual Hebrew and Greek words of each verse (Hebrew: Leningrad Codex via OSHB/Westminster; Greek: NA28, SBL, Tyndale House, Textus Receptus, Byzantine and others, with the editions containing each word), transliteration, word-by-word English glosses, Strong's numbers, grammar codes, and STEPBible's expansions of those codes. Readings not in the Leningrad Codex (marked X/R/V) are left out; Qere readings are shown and labeled. Changes: reformatted to JSON per chapter; Strong's numbers without leading zeros; the backslash that marks punctuation removed. STEPBible asks that its raw files be obtained from github.com/STEPBible; the app does not redistribute them.",
        },
        {
            "id": "oshb-lexicon", "kind": "lexicon", "name": "Open Scriptures Hebrew Lexicon (Brown-Driver-Briggs)",
            "provider": "Open Scriptures Hebrew Bible Project", "url": "https://github.com/openscriptures/HebrewLexicon",
            "file": "BrownDriverBriggs.xml, LexicalIndex.xml", "version": "git 21c9add13bc727d3a951361778e97e3ff7afd1ce",
            "license": "CC BY 4.0 (markup); the text of Brown, Driver, Briggs (1906) is public domain",
            "attribution": "Hebrew lexicon from the Open Scriptures Hebrew Bible Project (CC BY 4.0).",
            "notes": "A work in progress: each entry is marked done (full BDB entry, 560 entries) or partly transcribed (basic definitions, with or without references). Partial entries are shown with that label. Strong's numbers that combine words BDB treats separately show every BDB entry. Arabic, Ethiopic, and Syriac words not transcribed in the source are marked as such. Changes: XML converted to a small HTML subset; references converted to app links (references beyond KJV verse numbering are shown as text).",
        },
        {
            "id": "openbible-xrefs", "kind": "cross-references", "name": "OpenBible.info Cross References",
            "provider": "OpenBible.info, distributed in scrollmapper/bible_databases", "url": "https://www.openbible.info/labs/cross-references/",
            "file": "cross_references.txt", "version": "2024-11-04 (scrollmapper git 59b18c5af5845728c275d5b7178ad0d024172b1f)",
            "license": "CC BY", "attribution": "Cross references from OpenBible.info, CC BY.",
            "notes": "Votes are community relevance votes. Entries with zero or negative votes are excluded. The connection between two passages is for the reader to explain.",
        },
        {
            "id": "isbe", "kind": "dictionary", "name": "International Standard Bible Encyclopedia (1915)",
            "provider": "CrossWire Bible Society", "url": "https://gitlab.com/crosswire-bible-society/isbe", "file": "isbe.tei.xml",
            "version": "git ec5b70d0eb87db94b7c117182366028f907f0c17", "license": "Public domain",
            "attribution": "James Orr, general editor, The International Standard Bible Encyclopedia, 1915.",
            "notes": "Historical and archaeological statements reflect scholarship as of 1915 and may be outdated.",
        },
        {
            "id": "hitchcock", "kind": "dictionary", "name": "Hitchcock's Bible Names Dictionary (1869)",
            "provider": "CrossWire Bible Society", "url": "https://gitlab.com/crosswire-bible-society/hitchcock", "file": "hitchcock.tei.xml",
            "version": "git d79b9aae10337d6c0d387da91da3a5f997ee4829", "license": "Public domain",
            "attribution": "Roswell D. Hitchcock, Hitchcock's New and Complete Analysis of the Holy Bible, 1869/1874.",
            "notes": "Name meanings are traditional etymologies; many are uncertain or disputed by modern scholarship.",
        },
        {
            "id": "webster1913", "kind": "dictionary", "name": "Webster's Revised Unabridged Dictionary (1913)",
            "provider": "CrossWire Bible Society", "url": "https://gitlab.com/crosswire-bible-society/webster1913", "file": "webster1913.tei.xml",
            "version": "git 72baf03e62b6a0ebc659324b758bcf46a7dbdc8c", "license": "Public domain",
            "attribution": "Webster's Revised Unabridged Dictionary, G. & C. Merriam Co., 1913.",
            "notes": "Filtered to words found in the KJV. Older senses are often listed first; it is a 1913 work, not a modern dictionary.",
        },
        {
            "id": "wordnet", "kind": "thesaurus", "name": "WordNet 3.1",
            "provider": "Princeton University, via npm package wordnet-db 3.1.14", "url": "https://wordnet.princeton.edu/", "file": "wordnet-db",
            "version": "3.1", "license": "WordNet License (permissive, attribution required)",
            "attribution": "WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved. Princeton University makes no representations or warranties.",
            "notes": "Modern English senses, synonyms and antonyms. Filtered to words found in the KJV.",
        },
        {
            "id": "archaic-editorial", "kind": "editorial", "name": "KJV Archaic Words (app editorial list)",
            "provider": "Arise Bible Study (app-authored)", "url": "", "file": "scripts/editorial/archaic.json", "version": "1",
            "license": "App content",
            "attribution": "Editorial list written for this app. Not a published reference work.",
            "notes": "Short modern equivalents for common archaic KJV words. Every sample verse is checked at build time to exist and contain the word. Verify meanings against Webster 1913 and ISBE entries linked beside each item.",
        },
    ]
    files = {"kjv": ["kjvfull.xml"], "strongs": ["strongs-hebrew.js", "strongs-greek.js"], "stepbible": ["tbesh.txt", "tbesg.txt"],
             "openbible-xrefs": ["cross_references.txt"], "isbe": ["isbe.tei.xml"], "hitchcock": ["hitchcock.tei.xml"],
             "webster1913": ["webster1913.tei.xml"], "wordnet": ["wn/wordnet-db-3.1.14.tgz"],
             "stepbible-tagged": ["lang/TAHOT-Gen-Deu.txt", "lang/TAHOT-Jos-Est.txt", "lang/TAHOT-Job-Sng.txt", "lang/TAHOT-Isa-Mal.txt", "lang/TAGNT-Mat-Jhn.txt", "lang/TAGNT-Act-Rev.txt", "lang/TEHMC.txt", "lang/TEGMC.txt"],
             "oshb-lexicon": ["lang/BrownDriverBriggs.xml", "lang/LexicalIndex.xml"]}
    for s in S:
        s["sha256"] = {f: sha(os.path.join(SRC, f)) for f in files.get(s["id"], []) if os.path.exists(os.path.join(SRC, f))}
    missing = json.load(open(os.path.join(DATA, "reports", "strongs-missing.json")))
    extra_translations = []
    tindex = os.path.join(DATA, "translations", "index.json")
    if os.path.exists(tindex):
        for t in json.load(open(tindex, encoding="utf-8")):
            extra_translations.append({"id": t["id"], "name": t["name"], "path": f"translations/{t['id']}/", "source": t["id"]})
            S.append({
                "id": t["id"], "kind": "translation", "name": f"{t['name']} ({t['year']})",
                "provider": "scrollmapper/bible_databases", "url": t["url"], "file": t["source"], "version": t["source"].split("(")[-1].rstrip(")"),
                "license": t["license"], "attribution": f"{t['name']} text from the scrollmapper bible_databases collection.",
                "notes": t["note"] + " Plain text for reading and comparison; Strong's word study uses the KJV.", "sha256": {t["source"].split(" ")[1]: t["sha256"]},
            })
    out = {
        "generated": "build", "translations": [{"id": "kjv", "name": "King James Version", "path": "kjv/", "source": "kjv"}] + extra_translations,
        "sources": S, "integrity": missing,
        "notAvailable": [
            {"name": "Easton's Bible Dictionary", "reason": "No reachable source during build. ISBE and Hitchcock cover the same ground."},
            {"name": "Greek pronunciation guide", "reason": "The Open Scriptures Greek dictionary does not include Strong's pronunciation field. Transliteration is shown instead."},
            {"name": "Hebrew lexical senses (BDB)", "reason": "The available abridged BDB requires permission from Online Bible. Strong's definitions and STEPBible glosses are shown instead."},
        ],
    }
    with open(os.path.join(DATA, "sources.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("sources.json written")


if __name__ == "__main__":
    build_archaic()
    build_sources()

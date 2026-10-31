"""Build the commentary library from pinned CrossWire OSIS editions (public domain).

Input:  data-src/commentaries/{id}.osis.xml  (see scripts/fetch_sources.sh)
Output: public/data/commentary/index.json                     works, sources, rights, coverage summary
        public/data/commentary/{ID}/{Book}/coverage.json       which chapters/verses each work covers
        public/data/commentary/{ID}/{Book}/{chapter}.json      the commentary text for one chapter
        public/data/commentary/{ID}/{Book}/intro.json          the work's introduction to the book, if any

Faithfulness rules
- Text is the module's own text. Markup is converted to a small, fixed set of HTML tags; nothing is added
  except labels the reader needs (e.g. marking Bible text that a commentary reprints).
- Every entry keeps the exact verses the module assigns it. A note on verses 1-8 is a passage note on 1-8,
  never presented as a note on verse 3.
- Introductions that a module stores inside its first verse or chapter entry (e.g. Clarke's preface in
  Gen 1:1) are separated by explicit, per-work rules and shown as book or chapter introductions, so a preface
  is never labelled as commentary on a verse. Every split is listed in the build report for review.
"""
import hashlib, html, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data-src", "commentaries")
OUT = os.path.join(ROOT, "public", "data", "commentary")
BOOKS = json.load(open(os.path.join(ROOT, "src", "lib", "books.json")))
BOOK_IDS = {b["id"] for b in BOOKS}
KJV_INDEX = {b["id"]: b["chapters"] for b in json.load(open(os.path.join(ROOT, "public", "data", "kjv", "index.json")))}
GL = "https://gitlab.com/crosswire-bible-society"

# Each work: what it is, where the exact file came from, its rights, and how to find its introductions.
WORKS = [
    dict(id="MHCC", file="mhcc", commit="b15ff40aab9556005fd3d38d5388040a90b99145", sha256="b00780749c2d6130f41441db2b5cb16df490231e6a315a7d2d9eabcfb36a9fd7",
         title="Concise Commentary on the Whole Bible", short="Matthew Henry (Concise)", author="Matthew Henry (1662-1714), abridged",
         era="1706-1721 (concise abridgment of the complete work)", edition="Concise edition as printed by Moody Press (28th printing); text via CCEL and The Bible Foundation",
         tradition="English Nonconformist (Presbyterian), Reformed; devotional and practical", level="Beginner-friendly",
         verse_lead=None, intro_in_verse=False),
    dict(id="MHC", file="mhc", commit="537591a94c991941877b47a06666b6a7812e05d8", sha256="3cf367f00c498a3124b339c00896aaef4ef1196a2d5c310ecb20ea42abd130f6",
         title="Commentary on the Whole Bible (Complete)", short="Matthew Henry (Complete)", author="Matthew Henry (1662-1714); Romans-Revelation completed by fellow ministers after his death",
         era="1706-1721", edition="Complete edition; text via CCEL (from Logos Research Systems' text)",
         tradition="English Nonconformist (Presbyterian), Reformed; devotional and practical", level="Detailed",
         verse_lead=None, intro_in_verse=False),
    dict(id="JFB", file="jfb", commit="9f7106f538fe6e154a58fc2689e069dc69cbcaba", sha256="365a2db9b256444b0a781c29a2281432ab2483b901d1c7c2e5235c4c85d0654b",
         title="Commentary Critical and Explanatory on the Whole Bible", short="Jamieson, Fausset & Brown", author="Robert Jamieson, A. R. Fausset, David Brown",
         era="1871", edition="1871 edition; text via CCEL", tradition="Scottish and Anglican evangelical; Reformed; explains words and grammar briefly",
         level="Intermediate", verse_lead=r"^\s*\d+(?:[-,]\s*\d+)*\.\s", intro_in_verse=False),
    dict(id="Clarke", file="clarke", commit="bd94d38ee503ef6759fbdf1ea85ed12f4b5a2d5e", sha256="0b8fe5ada0e86e6c58350368324afa65a69d18308f3e091b39ef718bdb7272b3",
         title="Commentary and Critical Notes on the Holy Bible", short="Adam Clarke", author="Adam Clarke (c. 1760-1832)",
         era="1810-1826", edition="Text via Wikisource and sacred-texts.com", tradition="Wesleyan Methodist (Arminian); notes on Hebrew and Greek, history, and manners",
         level="Detailed", verse_lead=r"^\s*Verses?\s+\d+", intro_in_verse=True),
    dict(id="KD", file="kd", commit="206b2f6b60fec34f68dc537322cffc975756db31", sha256="31a117084869bdc06e3baa37bcd9f1a0ba92b92e5594a443f82f15852681cd17",
         title="Biblical Commentary on the Old Testament", short="Keil & Delitzsch", author="Carl Friedrich Keil (1807-1888) and Franz Delitzsch (1813-1890)",
         era="1861-1875 (German); English translation 1866-1891", edition="English translation (T. & T. Clark); text via Wikisource",
         tradition="German Lutheran, confessional and conservative; grammatical-historical, close attention to Hebrew", level="Scholarly",
         verse_lead=r"^\s*(?:[1-3]\s?)?[A-Z][a-z]+\.?\s+\d+:\d+", intro_in_verse=True, chapter1_is_book=True),
    dict(id="Scofield", file="scofield", commit="e46fa4f9c523dcdfecd62c43fe402aab1cc96f22", sha256="1bd48cfde3a166bde2f22e3e55e460aec401436e684bc8dfb1c219982147df20",
         title="Scofield Reference Bible Notes", short="Scofield (1917)", author="C. I. Scofield (1843-1921)",
         era="1917 edition", edition="1917 edition; text via Wikisource", tradition="Dispensational premillennial; selective notes on key words and themes",
         level="Intermediate", verse_lead=None, intro_in_verse=True),
]
NOT_INCLUDED = [
    dict(id="Gill", title="Exposition of the Bible", author="John Gill (1697-1771)", status="not-verified", reason="No edition with a verifiable source and rights statement was reachable from the build environment."),
    dict(id="Barnes", title="Notes on the Bible", author="Albert Barnes (1798-1870)", status="not-verified", reason="No edition with a verifiable source and rights statement was reachable from the build environment."),
    dict(id="Wesley", title="Explanatory Notes", author="John Wesley (1703-1791)", status="not-verified", reason="No edition with a verifiable source and rights statement was reachable from the build environment."),
    dict(id="TDavid", title="The Treasury of David", author="C. H. Spurgeon (1834-1892)", status="review", reason="The work is public domain, but the module's current transcription does not name its source (CrossWire MOD-109/MOD-404). Held back until the transcription source is confirmed."),
]

TOKEN = re.compile(r"<!--.*?-->|<[^>]+>|[^<]+", re.S)
ATTR = lambda t, a: (re.search(a + r'="([^"]*)"', t) or [None, None])[1]
OSIS_REF = re.compile(r"^([1-3]?[A-Za-z]+)\.(\d+)(?:\.(\d+))?(?:-([1-3]?[A-Za-z]+)\.(\d+)(?:\.(\d+))?)?$")
HI = {"italic": "i", "bold": "b", "super": "sup", "sub": "sub", "underline": "u", "small-caps": "span"}


def _norm(x):
    return re.sub(r"[^a-z0-9]", "", x.lower())


# book names, the app's abbreviations, and the older SWORD codes some modules use ("Exo", "joh", "1ti")
ALIASES = {}
for _b in BOOKS:
    for _a in [_b["id"], _b["name"], *_b["abbr"]]:
        ALIASES.setdefault(_norm(_a), _b["id"])
for _a, _id in {"exo": "Exod", "deu": "Deut", "jdg": "Judg", "rut": "Ruth", "1sa": "1Sam", "2sa": "2Sam", "1ki": "1Kgs", "2ki": "2Kgs",
                "1ch": "1Chr", "2ch": "2Chr", "ezr": "Ezra", "est": "Esth", "psa": "Ps", "pro": "Prov", "ecc": "Eccl", "sol": "Song",
                "sng": "Song", "eze": "Ezek", "joe": "Joel", "amo": "Amos", "oba": "Obad", "jon": "Jonah", "nah": "Nah", "zep": "Zeph",
                "hag": "Hag", "zec": "Zech", "mat": "Matt", "mar": "Mark", "luk": "Luke", "joh": "John", "act": "Acts", "1co": "1Cor",
                "2co": "2Cor", "phi": "Phil", "php": "Phil", "1th": "1Thess", "2th": "2Thess", "1ti": "1Tim", "2ti": "2Tim", "tit": "Titus",
                "phm": "Phlm", "jam": "Jas", "1pe": "1Pet", "2pe": "2Pet", "1jo": "1John", "2jo": "2John", "3jo": "3John", "jud": "Jude",
                "ge": "Gen", "ex": "Exod", "le": "Lev", "nu": "Num", "de": "Deut", "jos": "Josh", "ps": "Ps", "pr": "Prov", "isa": "Isa",
                "jer": "Jer", "la": "Lam", "da": "Dan", "ho": "Hos", "mic": "Mic", "hab": "Hab", "mal": "Mal", "mt": "Matt", "mr": "Mark",
                "lu": "Luke", "ro": "Rom", "zac": "Zech", "jde": "Jude", "plm": "Phlm", "ga": "Gal", "eph": "Eph", "col": "Col", "heb": "Heb", "re": "Rev", "es": "Esth", "ne": "Neh",
                "ru": "Ruth", "jg": "Judg", "ec": "Eccl", "so": "Song", "eze": "Ezek", "joe": "Joel", "zec": "Zech"}.items():
    ALIASES.setdefault(_a, _id)


def normalize_ref(r):
    """Accept OSIS ('Gen.1.1', 'Exo.10.24') and SWORD-style ('ge 3:23', '1ti 3:1-13', 'Scofield:Ge 12:10'). Returns OSIS or None."""
    r = (r or "").strip()
    r = re.sub(r"^[A-Za-z]+:", "", r)  # 'Scofield:Ge 12:10' -> a Bible reference
    pair = re.match(r"^([1-3]?[A-Za-z]+\s+\d+:\d+)\s+[1-3]?[A-Za-z]+\s+\d+:\d+$", r)
    if pair:  # 'mt 1:1 mt 1:5' (a list in one link): link the first
        r = pair.group(1)
    m = re.match(r"^([1-3]?[A-Za-z]+)\.(\d+)(?:\.(\d+))?(?:-(?:([1-3]?[A-Za-z]+)\.)?(\d+)(?:\.(\d+))?)?$", r)
    if m:
        b = ALIASES.get(_norm(m.group(1)))
        if not b:
            return None
        out = f"{b}.{m.group(2)}" + (f".{m.group(3)}" if m.group(3) else "")
        if m.group(5):
            eb = ALIASES.get(_norm(m.group(4))) if m.group(4) else b
            out += f"-{eb}.{m.group(5)}" + (f".{m.group(6)}" if m.group(6) else "")
        return out
    m = re.match(r"^([1-3]?\s?[A-Za-z]+)\.?\s+(\d+)(?::(\d+)(?:\s*-\s*(\d+))?)?$", r)
    if m:
        b = ALIASES.get(_norm(m.group(1)))
        if not b:
            return None
        out = f"{b}.{m.group(2)}" + (f".{m.group(3)}" if m.group(3) else "")
        if m.group(4):
            out += f"-{b}.{m.group(2)}.{m.group(4)}"
        return out
    return None


def valid_ref(r):
    r = normalize_ref(r)
    m = OSIS_REF.match(r or "")
    if not m or m.group(1) not in BOOK_IDS:
        return None
    b, c = m.group(1), int(m.group(2))
    if c < 1 or c > len(KJV_INDEX[b]):
        return None
    if m.group(3) and not (1 <= int(m.group(3)) <= KJV_INDEX[b][c - 1]):
        return None
    return r


def to_html(tokens, stats):
    """OSIS tokens -> limited HTML. Only these tags are ever written: p h4 i b sup sub u span a ul li table tr td br small."""
    out, stack = [], []
    for t in tokens:
        if t.startswith("<!--"):
            continue
        if not t.startswith("<"):
            out.append(t)  # already XML-escaped in the source
            continue
        closing = t.startswith("</")
        name = re.match(r"</?\s*([A-Za-z]+)", t)
        name = name.group(1) if name else ""
        selfclose = t.endswith("/>")
        if name == "p":
            out.append("</p>" if closing else "<p>")
        elif name == "title":
            out.append("</h4>" if closing else "<h4>")
        elif name == "hi":
            if closing:
                out.append(f"</{stack.pop()}>" if stack else "")
            else:
                tag = HI.get(ATTR(t, "type"), "span")
                stack.append(tag)
                out.append('<span class="sc">' if ATTR(t, "type") == "small-caps" else f"<{tag}>")
        elif name == "reference":
            if closing:
                out.append("</a>" if stack and stack[-1] == "a" else "")
                if stack and stack[-1] in ("a", "x"):
                    stack.pop()
            else:
                r = valid_ref(ATTR(t, "osisRef"))
                if r:
                    stack.append("a")
                    out.append(f'<a data-ref="{html.escape(r)}">')
                    stats["links"] += 1
                else:
                    stack.append("x")
                    stats["unlinked_refs"] += 1
        elif name == "note":
            out.append("</small>" if closing else ' <small class="cnote">')
        elif name in ("list",):
            out.append("</ul>" if closing else "<ul>")
        elif name == "item":
            out.append("</li>" if closing else "<li>")
        elif name == "table":
            out.append("</table>" if closing else "<table>")
        elif name == "row":
            out.append("</tr>" if closing else "<tr>")
        elif name == "cell":
            out.append("</td>" if closing else "<td>")
        elif name in ("lb",) or (name == "l" and selfclose):
            out.append("<br>")
        elif name == "l":
            out.append("<br>" if closing else "")
        elif name == "divineName":
            out.append("</span>" if closing else '<span class="sc">')
        # all other markup (div, milestone, w, seg, foreign, q, catchWord ...) is dropped; its text is kept
    h = "".join(out)
    h = re.sub(r"\s+", " ", h)
    h = re.sub(r"<p>\s*</p>|<h4>\s*</h4>", "", h)
    # Bible text a commentary reprints (Matthew Henry starts each section with it): label it, never mix it with comment
    h = re.sub(r"<p>\s*(<sup>\d+</sup>)", r'<p class="bible-text">\1', h)
    return h.strip()


def parse_keys(osis_id):
    """'Gen.1.1 Gen.1.2' or 'Gen.1.1-Gen.1.3' -> (book, chapter, first verse, last verse, last chapter)."""
    pts = []
    for part in osis_id.split():
        for side in part.split("-"):
            m = re.match(r"^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$", side)
            if m:
                pts.append((m.group(1), int(m.group(2)), int(m.group(3))))
    if not pts:
        return None
    b, c, v = pts[0]
    lb, lc, lv = max(pts, key=lambda p: (p[1], p[2]))
    return b, c, v, lc, lv


def segment(path):
    """Split an OSIS commentary into (book, chapter, kind, keys, tokens) entries in document order."""
    s = open(path, encoding="utf-8").read()
    s = s[s.find('<div type="book"'):]
    book = chap = None
    entries, cur = [], None
    for t in TOKEN.findall(s):
        if t.startswith("<div") and 'type="book"' in t:
            book = ATTR(t, "osisID")
            cur = None
            continue
        if t.startswith("<chapter"):
            sid = ATTR(t, "sID")
            if sid:
                chap = int(sid.split(".")[1])
                cur = dict(book=book, chapter=chap, kind="chapter", keys=None, tokens=[])
                entries.append(cur)
            continue
        if t.startswith("<verse"):
            if ATTR(t, "sID"):
                keys = parse_keys(ATTR(t, "osisID") or ATTR(t, "sID"))
                cur = dict(book=book, chapter=chap, kind="verse", keys=keys, tokens=[])
                entries.append(cur)
            else:  # verse end: anything until the next verse belongs to the chapter
                cur = dict(book=book, chapter=chap, kind="chapter", keys=None, tokens=[])
                entries.append(cur)
            continue
        if cur is not None:
            cur["tokens"].append(t)
    return entries


INTRO_TITLE = re.compile(r"preface|introduction|prolegomen|general\s+introduction", re.I)


def split_intro(h, work, chapter):
    """Return (intro_html, intro_level, rest_html). Explicit rules; anything not matched stays where the module put it."""
    blocks = re.findall(r"<(?:p|h4|table|ul)[^>]*>.*?</(?:p|h4|table|ul)>", h)
    if not blocks:
        return None, None, h
    first = re.sub(r"<[^>]+>", "", blocks[0])
    if not (blocks[0].startswith("<h4") and INTRO_TITLE.search(first)):
        return None, None, h
    lead = work["verse_lead"]
    cut = None
    if lead:
        for i, b in enumerate(blocks[1:], 1):
            if re.match(lead, re.sub(r"<[^>]+>", "", b)):
                cut = i
                break
    intro = "".join(blocks[:cut] if cut else blocks)
    rest = "".join(blocks[cut:]) if cut else ""
    if not re.sub(r"<h4>.*?</h4>|<[^>]+>|\s", "", intro):  # a bare heading with no text under it
        return "", None, rest
    level = "book" if chapter == 1 and (work.get("chapter1_is_book") or re.search(r"preface|book|general|prolegomen", first, re.I) or not rest) else "chapter"
    return intro, level, rest


def chapter1_split(h):
    """For chapter-level text in chapter 1: text before a 'Chapter 1' heading is the book introduction."""
    m = re.search(r"<h4>\s*(?:CHAPTER|Chapter)\s+(?:1|I)\b[^<]*</h4>", h)
    if m and m.start() > 0:
        return h[: m.start()], h[m.start():]
    if re.search(r"<h4>[^<]*(?:PREFACE|Preface|INTRODUCTION|Introduction)", h) and "In this chapter" not in h:
        return h, ""
    return None, h


def build(work, report):
    path = os.path.join(SRC, work["file"] + ".osis.xml")
    sha = hashlib.sha256(open(path, "rb").read()).hexdigest()
    if sha != work["sha256"]:
        sys.exit(f"{work['id']}: source checksum {sha} does not match the pinned {work['sha256']}")
    stats = dict(links=0, unlinked_refs=0, verse_entries=0, chapter_entries=0, intros=0, bible_text_blocks=0, cross_chapter=0)
    data = {}  # book -> chapter -> {"c": [...], "e": [...]} ; book -> "intro"
    for e in segment(path):
        b, c = e["book"], e["chapter"]
        if b not in BOOK_IDS or not c:
            continue
        h = to_html(e["tokens"], stats)
        if not re.sub(r"<[^>]+>|\s", "", h):
            continue
        book = data.setdefault(b, {"chapters": {}, "intro": []})
        ch = book["chapters"].setdefault(c, {"c": [], "e": []})
        if e["kind"] == "chapter":
            if c == 1 and not ch["c"] and not ch["e"]:
                intro, h = chapter1_split(h)
                if intro:
                    book["intro"].append(intro)
                    report.append(f"{work['id']} {b} book introduction from chapter-1 text ({len(intro)} chars)")
                    stats["intros"] += 1
            if h:
                ch["c"].append(h)
            continue
        keys = e["keys"]
        if not keys or keys[0] != b:
            continue
        _, kc, v1, lc, lv = keys
        if not ch["e"] and work["intro_in_verse"]:  # an introduction stored inside the first verse entry of a chapter
            intro, level, h = split_intro(h, work, c)
            if intro == "" and not re.sub(r"<[^>]+>|\s", "", h):
                continue  # only an empty heading
            if intro:
                stats["intros"] += 1
                report.append(f"{work['id']} {b} {c}: {level} introduction separated from verse entry {kc}:{v1} ({len(intro)} chars, title: {re.sub('<[^>]+>', '', intro)[:60]!r})")
                target = book["intro"] if level == "book" else ch["c"]
                if intro not in target:  # some modules repeat an introduction
                    target.append(intro)
                if not re.sub(r"<[^>]+>|\s", "", h):
                    continue
        if lc != kc:  # runs into a later chapter: keep it on its first chapter, to that chapter's end
            stats["cross_chapter"] += 1
            lv = KJV_INDEX[b][kc - 1]
        stats["bible_text_blocks"] += h.count('class="bible-text"')
        ch = book["chapters"].setdefault(kc, {"c": [], "e": []})
        mx = KJV_INDEX[b][kc - 1]
        if v1 > mx:  # keyed to a verse the KJV chapter does not have (Hebrew numbering): keep it, labelled, at chapter level
            report.append(f"{work['id']} {b} {kc}:{v1}: verse beyond KJV numbering (max {mx}); shown in the chapter overview with a label")
            ch["c"].append(f'<p class="numbering-note">Note keyed to verse {v1} in a different verse numbering (this chapter has {mx} verses in the KJV):</p>' + h)
            continue
        if lv > mx:  # a range running past the chapter's end (a key error in the source): trim to the last verse
            report.append(f"{work['id']} {b} {kc}:{v1}-{lv}: range trimmed to {kc}:{v1}-{mx} (chapter has {mx} verses)")
            lv = mx
        ch["e"].append([v1, max(v1, lv), h])
        stats["verse_entries"] += 1
    # write
    wdir = os.path.join(OUT, work["id"])
    coverage_summary = {}
    for b, book in data.items():
        os.makedirs(os.path.join(wdir, b), exist_ok=True)
        cov = {"intro": bool(book["intro"]), "chapters": {}}
        for c, ch in sorted(book["chapters"].items()):
            if not ch["c"] and not ch["e"]:
                continue
            ch["e"].sort(key=lambda x: (x[0], x[1]))
            stats["chapter_entries"] += 1 if ch["c"] else 0
            json.dump({"c": ch["c"], "e": ch["e"]}, open(os.path.join(wdir, b, f"{c}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
            cov["chapters"][c] = {"overview": bool(ch["c"]), "ranges": [[x[0], x[1]] for x in ch["e"]]}
        if book["intro"]:
            json.dump({"h": "".join(book["intro"])}, open(os.path.join(wdir, b, "intro.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        json.dump(cov, open(os.path.join(wdir, b, "coverage.json"), "w", encoding="utf-8"), separators=(",", ":"))
        coverage_summary[b] = len(cov["chapters"])
    return sha, stats, coverage_summary


def main():
    import shutil
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    report, works = [], []
    for w in WORKS:
        sha, stats, cov = build(w, report)
        conf = open(os.path.join(SRC, w["file"] + ".conf"), encoding="utf-8", errors="replace").read()
        lic = re.search(r"^DistributionLicense=(.*)$", conf, re.M).group(1).strip()
        text_source = re.search(r"^TextSource=(.*)$", conf, re.M).group(1).strip()
        version = re.search(r"^Version=(.*)$", conf, re.M).group(1).strip()
        if lic.lower() != "public domain":
            sys.exit(f"{w['id']}: license is {lic!r}, not public domain; not building")
        works.append({
            "id": w["id"], "title": w["title"], "short": w["short"], "author": w["author"], "era": w["era"], "edition": w["edition"],
            "tradition": w["tradition"], "level": w["level"], "status": "approved",
            "copyright": "Public domain (author died over 100 years ago; edition published before 1929)",
            "license": "Public domain. CrossWire module DistributionLicense: " + lic,
            "attribution": f"{w['short']}, {w['title']}. Public domain. Text from the CrossWire Bible Society SWORD module {w['file'].upper()} (version {version}).",
            "scope": "Free to read, quote, copy, and redistribute.",
            "source": f"{GL}/{w['file']} (commit {w['commit']}); original text source: {text_source}",
            "version": f"CrossWire module version {version}", "sha256": sha,
            "books": len(cov), "chapters": sum(cov.values()), "stats": stats,
        })
        print(w["id"], stats, "books", len(cov))
    json.dump({"works": works, "notIncluded": NOT_INCLUDED}, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    # every introduction split and numbering fix, for review (not loaded by the app)
    json.dump({"report": report}, open(os.path.join(OUT, "build-report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(report)} introductions separated (listed in public/data/commentary/build-report.json)")


if __name__ == "__main__":
    main()

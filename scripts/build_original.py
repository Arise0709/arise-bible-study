"""Build original-language data: the actual Hebrew and Greek words of each verse, with grammar, plus BDB.

Sources (all CC BY 4.0; the BDB and Strong's texts themselves are public domain):
  STEPBible TAHOT  - Translators Amalgamated Hebrew OT (Leningrad Codex via OSHB/Westminster; ETCBC-based grammar)
  STEPBible TAGNT  - Translators Amalgamated Greek NT (NA28/27, SBL, WH, Tregelles, TR, Byzantine; edition of each word)
  STEPBible TEHMC / TEGMC - official expansions of the Hebrew and Greek grammar codes
  Open Scriptures Hebrew Lexicon - BrownDriverBriggs.xml, LexicalIndex.xml (Strong's -> BDB)

Output (public/data):
  orig/{Book}/{chapter}.json  verse -> words, in original-language order (KJV verse numbering, as the sources give it;
                              Psalm titles are verse 0). Hebrew words keep their prefix/suffix parts separated by "/".
                              Hebrew word: [text, transliteration, gloss, Strong's tags, grammar, STEPBible sense label, "Q" if Qere]
                              Greek word:  [text, transliteration, gloss, Strong's, grammar, lemma, lemma gloss, edition flag]
  orig/morph-H.json, orig/morph-G.json   grammar code -> STEPBible's expansion (only codes that occur)
  orig/forms/{H|G}{n}.json    Strong's number -> the forms it takes in the text, with counts
  bdb/H{n}.json               Strong's number -> BDB entries (headword, definitions as HTML, root and word family, status)

Nothing is inferred from the English text. Words are exactly as the sources give them; changes are format only
(tab-separated text to JSON, Strong's numbers without leading zeros, BDB XML to a small HTML subset).
"""
import collections, hashlib, html, json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data-src", "lang")
OUT = os.path.join(ROOT, "public", "data")
KJV_INDEX = {b["id"]: b["chapters"] for b in json.load(open(os.path.join(OUT, "kjv", "index.json")))}

STEP_COMMIT = "master"  # see fetch_sources.sh for the pinned commit
BOOK = {"Gen": "Gen", "Exo": "Exod", "Lev": "Lev", "Num": "Num", "Deu": "Deut", "Jos": "Josh", "Jdg": "Judg", "Rut": "Ruth", "1Sa": "1Sam", "2Sa": "2Sam",
        "1Ki": "1Kgs", "2Ki": "2Kgs", "1Ch": "1Chr", "2Ch": "2Chr", "Ezr": "Ezra", "Neh": "Neh", "Est": "Esth", "Job": "Job", "Psa": "Ps", "Pro": "Prov",
        "Ecc": "Eccl", "Sng": "Song", "Isa": "Isa", "Jer": "Jer", "Lam": "Lam", "Ezk": "Ezek", "Dan": "Dan", "Hos": "Hos", "Jol": "Joel", "Amo": "Amos",
        "Oba": "Obad", "Jon": "Jonah", "Mic": "Mic", "Nam": "Nah", "Hab": "Hab", "Zep": "Zeph", "Hag": "Hag", "Zec": "Zech", "Mal": "Mal",
        "Mat": "Matt", "Mrk": "Mark", "Luk": "Luke", "Jhn": "John", "Act": "Acts", "Rom": "Rom", "1Co": "1Cor", "2Co": "2Cor", "Gal": "Gal", "Eph": "Eph",
        "Php": "Phil", "Col": "Col", "1Th": "1Thess", "2Th": "2Thess", "1Ti": "1Tim", "2Ti": "2Tim", "Tit": "Titus", "Phm": "Phlm", "Heb": "Heb",
        "Jas": "Jas", "1Pe": "1Pet", "2Pe": "2Pet", "1Jn": "1John", "2Jn": "2John", "3Jn": "3John", "Jud": "Jude", "Rev": "Rev"}
assert len(BOOK) == 66 and set(BOOK.values()) == set(KJV_INDEX)

LINE = re.compile(r"^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)(?:\(([\d.]+)\))?#(\d+)=(\w+)\t")
CANTILLATION = re.compile("[֑-ֽ֯׀׃׆]")


def base_strong(s):
    m = re.match(r"([HG])0*(\d+)", s or "")
    return f"{m.group(1)}{int(m.group(2))}" if m else None


def shard(sid):
    """BDB and forms files hold 100 Strong's numbers each (a word study downloads one small file)."""
    return f"{sid[0]}{int(sid[1:]) // 100}"


def load_morph(path):
    out = {}
    for line in open(path, encoding="utf-8-sig"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 2 and re.fullmatch(r"[A-Za-z0-9\-]+", parts[0]) and "Function=" in parts[1]:
            out.setdefault(parts[0], re.sub(r"\s*;\s*", "; ", parts[1].strip()))
    return out


def hebrew(files, morph, used_morph, forms, report):
    chapters = collections.defaultdict(lambda: collections.defaultdict(list))
    kept = skipped = 0
    for f in files:
        for line in open(os.path.join(SRC, f), encoding="utf-8-sig"):
            m = LINE.match(line)
            if not m:
                continue
            bk, c, v, heb_ref, _, typ = m.groups()
            # L* = Leningrad text; Q = Qere (the marginal "read as"); X/R/V = readings not in the Leningrad text -> left out
            if "L" not in typ and typ != "Q":
                skipped += 1
                continue
            f_ = line.rstrip("\n").split("\t")
            book, ch, vs = BOOK[bk], int(c), int(v)
            if ch > len(KJV_INDEX[book]):
                report.append(f"Hebrew {book} {ch}:{vs} beyond KJV chapters; skipped")
                continue
            text, xlit, gloss, dstr, gram = f_[1].replace("\\", ""), f_[2], f_[3], f_[4], f_[5]  # "\\" only marks punctuation
            parts = gram.split("/")
            lang = parts[0][:1]
            codes = [parts[0]] + [lang + p for p in parts[1:]]
            for code in codes:
                if code in morph:
                    used_morph[code] = morph[code]
                else:
                    report.append(f"Hebrew grammar code {code!r} not in TEHMC ({book} {ch}:{vs})")
            main = re.search(r"\{([HG]\d+[A-Za-z]?)\}", dstr)
            sid = base_strong(main.group(1)) if main else None
            if sid:  # the form of the main word part, without cantillation marks
                segs, strs = text.split("/"), dstr.split("/")
                idx = next((i for i, s in enumerate(strs) if "{" in s), 0)
                if idx < len(segs):
                    forms[sid][CANTILLATION.sub("", segs[idx]).replace("\\", "").strip("־ ")] += 1
            # STEPBible's meaning label for this word's own sense, e.g. {H1254A=בָּרָא=to create}
            sense = re.search(r"\{H\d+[A-Za-z]?=[^=]*=([^}]*)\}", f_[11] if len(f_) > 11 else "")
            label = re.sub(r"^:\s*", "", sense.group(1)).split("»")[0].strip() if sense else ""
            w = [text, xlit, gloss, dstr, "/".join(codes), label, "Q" if typ == "Q" else ""]
            chapters[(book, ch)][vs].append(w)
            kept += 1
    report.append(f"Hebrew: {kept} words kept, {skipped} non-Leningrad readings left out")
    return chapters


def greek(files, morph, used_morph, forms, report):
    chapters = collections.defaultdict(lambda: collections.defaultdict(list))
    kept = 0
    eds = collections.Counter()
    for f in files:
        for line in open(os.path.join(SRC, f), encoding="utf-8-sig"):
            m = LINE.match(line)
            if not m:
                continue
            bk, c, v, _, _, typ = m.groups()
            f_ = line.rstrip("\n").split("\t")
            book, ch, vs = BOOK[bk], int(c), int(v)
            word = re.match(r"^(.*?)\s*\((.*)\)\s*$", f_[1])
            text, xlit = (word.group(1), word.group(2)) if word else (f_[1], "")
            sm = f_[3].split("=")
            dstr, code = sm[0], (sm[1] if len(sm) > 1 else "")
            lemma = f_[4].split("=")
            in_tr = bool(re.search(r"[Kk]", typ))
            in_na = bool(re.search(r"[Nn]", typ))
            ed = "" if in_tr and in_na else ("T" if in_tr else ("N" if in_na else "O"))
            eds[ed or "both"] += 1
            # merged words (crasis) are coded "CONJ + G5101": the first word's grammar plus the second word's Strong's number
            for part in [p.strip() for p in code.split(" + ") if p.strip() and not re.fullmatch(r"G\d+[A-Za-z]?", p.strip())]:
                if part in morph:
                    used_morph[part] = morph[part]
                else:
                    report.append(f"Greek grammar code {part!r} not in TEGMC ({book} {ch}:{vs})")
            sid = base_strong(dstr)
            if sid and in_tr:
                forms[sid][text.strip(".,;:·")] += 1
            chapters[(book, ch)][vs].append([text, xlit, f_[2], dstr, code, lemma[0], lemma[1] if len(lemma) > 1 else "", ed])
            kept += 1
    report.append(f"Greek: {kept} words; editions: {dict(eds)} (T = only in the Textus Receptus/KJV text, N = only in critical editions, O = other editions only)")
    return chapters


def bdb_ref(r):
    """BDB references use OSIS ids, sometimes with short book codes ("Zec.11.4"); return the app's id or None (no link)."""
    m = re.match(r"^([1-3]?[A-Za-z]+)\.(\d+)(?:\.(\d+))?", r or "")
    if not m:
        return None
    b = m.group(1) if m.group(1) in KJV_INDEX else BOOK.get(m.group(1)) or {"Ezek": "Ezek", "Zech": "Zech", "Song": "Song"}.get(m.group(1))
    if not b:
        return None
    c, v = int(m.group(2)), int(m.group(3) or 0)
    if c > len(KJV_INDEX[b]) or v > KJV_INDEX[b][c - 1]:
        return None  # Hebrew verse numbering beyond the KJV chapter: shown as text, not linked
    return f"{b}.{c}" + (f".{v}" if v else "")


def bdb(report):
    ns = "{http://openscriptures.github.com/morphhb/namespace}"
    import xml.etree.ElementTree as ET
    lex = ET.parse(os.path.join(SRC, "BrownDriverBriggs.xml")).getroot()
    entries, section_of, roots = {}, {}, {}

    def to_html(el):
        out = []

        def walk(e):
            tag = e.tag.replace(ns, "")
            open_, close = {"w": ('<span class="heb" lang="he" dir="rtl">', "</span>"), "def": ("<b>", "</b>"), "pos": ('<span class="pos">', "</span>"),
                            "stem": ('<span class="stem">', "</span>"), "em": ("<i>", "</i>"), "sense": ('<span class="sense">', "</span>"),
                            "foreign": ("<i>", "</i>"), "asp": ('<span class="asp">', "</span>"), "ref": ("", "")}.get(tag, ("", ""))
            if tag == "status":
                return
            if tag == "foreign" and (e.text or "").strip() in ("Arabic", "Ethiopic", "Syriac"):
                out.append(f"<i>[{html.escape(e.text.strip())} word not transcribed]</i>")
            else:
                ref = bdb_ref(e.get("r")) if tag == "ref" else None
                if ref:
                    out.append(f'<a data-ref="{html.escape(ref)}">')
                    close = "</a>"
                elif tag == "sense" and e.get("n"):
                    open_ += f"<b>{html.escape(e.get('n'))}.</b> "
                out.append(open_)
                if e.text:
                    out.append(html.escape(e.text))
                for ch in e:
                    walk(ch)
                out.append(close)
            if e.tail:
                out.append(html.escape(e.tail))

        if el.text:
            out.append(html.escape(el.text))
        for ch in el:
            walk(ch)
        return re.sub(r"\s+", " ", "".join(out)).strip()

    for sec in lex.iter(ns + "section"):
        root = None
        for e in sec.findall(ns + "entry"):
            st = e.find(ns + "status")
            status = st.text if st is not None else ""
            w = e.find(ns + "w")
            d = e.find(ns + "def")
            rec = {"id": e.get("id"), "w": (w.text or "") if w is not None else "", "def": (d.text or "") if d is not None else "", "status": status,
                   "root": e.get("type") == "root", "h": to_html(e)}
            entries[e.get("id")] = rec
            section_of[e.get("id")] = sec.get("id")
            if rec["root"] and root is None:
                root = rec["id"]
        roots[sec.get("id")] = root
    family = collections.defaultdict(list)
    for eid, sec in section_of.items():
        family[sec].append(eid)
    # Strong's -> BDB through the lexical index
    idx = ET.parse(os.path.join(SRC, "LexicalIndex.xml")).getroot()
    by_strong = collections.defaultdict(list)
    for e in idx.iter(ns + "entry"):
        x = e.find(ns + "xref")
        num = re.search(r"\d+", x.get("strong") or "") if x is not None else None
        if num and x.get("bdb") in entries:
            by_strong[f"H{int(num.group(0))}"].append(x.get("bdb"))
    out = collections.defaultdict(dict)
    for sid, ids in by_strong.items():
        recs = []
        # Strong's often joins words BDB separates (same spelling, different words); list all, fullest entry first
        ids = sorted(ids, key=lambda b: -len(entries[b]["h"]))
        for bid in ids:
            r = entries[bid]
            sec = section_of[bid]
            root = entries.get(roots.get(sec) or "")
            fam = [{"id": f, "w": entries[f]["w"], "def": entries[f]["def"]} for f in family[sec] if f != bid and entries[f]["status"] != "made" and entries[f]["w"]][:12]
            recs.append({"id": bid, "w": r["w"], "status": r["status"], "h": r["h"],
                         "root": {"w": root["w"], "def": root["def"]} if root and root["id"] != bid else None, "family": fam})
        out[shard(sid)][sid] = recs
    report.append(f"BDB: {len(entries)} entries; {sum(len(v) for v in by_strong.values())} linked to {len(by_strong)} Strong's numbers; statuses {dict(collections.Counter(e['status'] for e in entries.values()))}")
    return out


def main():
    import shutil
    report = []
    for d in ("orig", "bdb"):
        shutil.rmtree(os.path.join(OUT, d), ignore_errors=True)
    hm, gm = load_morph(os.path.join(SRC, "TEHMC.txt")), load_morph(os.path.join(SRC, "TEGMC.txt"))
    used_h, used_g = {}, {}
    forms = collections.defaultdict(collections.Counter)
    heb = hebrew(sorted(f for f in os.listdir(SRC) if f.startswith("TAHOT")), hm, used_h, forms, report)
    grk = greek(sorted(f for f in os.listdir(SRC) if f.startswith("TAGNT")), gm, used_g, forms, report)
    n = 0
    for lang, chs in (("H", heb), ("G", grk)):
        for (book, ch), verses in chs.items():
            os.makedirs(os.path.join(OUT, "orig", book), exist_ok=True)
            json.dump({"l": lang, "v": {str(k): verses[k] for k in sorted(verses)}}, open(os.path.join(OUT, "orig", book, f"{ch}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
            n += 1
    json.dump(used_h, open(os.path.join(OUT, "orig", "morph-H.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(used_g, open(os.path.join(OUT, "orig", "morph-G.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    os.makedirs(os.path.join(OUT, "orig", "forms"))
    sh = collections.defaultdict(dict)
    for sid, c in forms.items():
        sh[shard(sid)][sid] = c.most_common()
    for k, v in sh.items():
        json.dump(v, open(os.path.join(OUT, "orig", "forms", f"{k}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    os.makedirs(os.path.join(OUT, "bdb"))
    for k, v in bdb(report).items():
        json.dump(v, open(os.path.join(OUT, "bdb", f"{k}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    missing = [r for r in report if "not in TE" in r]
    sums = {f: hashlib.sha256(open(os.path.join(SRC, f), "rb").read()).hexdigest() for f in sorted(os.listdir(SRC)) if f.endswith((".txt", ".xml"))}
    json.dump({"chapters": n, "missingGrammarCodes": len(missing), "report": [r for r in report if "not in TE" not in r] + missing[:50], "sha256": sums},
              open(os.path.join(OUT, "orig", "build-report.json"), "w"), indent=1, ensure_ascii=False)
    print(n, "chapters;", len(missing), "grammar codes without an expansion")
    for r in report:
        if "not in TE" not in r:
            print(" ", r)


if __name__ == "__main__":
    main()

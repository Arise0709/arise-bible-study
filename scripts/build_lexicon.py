"""Build Strong's lexicon shards and the KJV concordance.

Inputs (data-src/):
  strongs-hebrew.js, strongs-greek.js   OpenScriptures Strong's dictionaries (CC BY-SA)
  tbesh.txt, tbesg.txt                  STEPBible lexicons (CC BY 4.0)
  public/data/kjv/*.json                output of build_kjv.py

Outputs (public/data/):
  strongs/{H|G}{shard}.json   lexicon entries, 1000 numbers per shard
  concordance/{H|G}{shard}.json   verse refs and KJV renderings computed from the tagged text
  reports/strongs-missing.json    ids used in the KJV tagging that have no lexicon entry

From STEPBible we use only the fields created by Tyndale House (gloss, grammatical code) and,
for Greek, the Abbott-Smith (1922) senses. The Hebrew "Meaning" column is Abridged BDB by
Online Bible and requires separate permission, so it is NOT used.
"""
import json, os, re
from collections import defaultdict, Counter
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data-src")
DATA = os.path.join(ROOT, "public", "data")
BOOKS = json.load(open(os.path.join(ROOT, "scripts", "books.json")))
BOOK_IDX = {b["id"]: i for i, b in enumerate(BOOKS)}

# STEPBible book abbreviations -> OSIS ids used by this app (canonical 66 only)
STEP_BOOKS = {
    "Gen": "Gen", "Exo": "Exod", "Lev": "Lev", "Num": "Num", "Deu": "Deut", "Jos": "Josh", "Jdg": "Judg", "Rut": "Ruth",
    "1Sa": "1Sam", "2Sa": "2Sam", "1Ki": "1Kgs", "2Ki": "2Kgs", "1Ch": "1Chr", "2Ch": "2Chr", "Ezr": "Ezra", "Neh": "Neh",
    "Est": "Esth", "Job": "Job", "Psa": "Ps", "Pro": "Prov", "Ecc": "Eccl", "Sng": "Song", "Isa": "Isa", "Jer": "Jer",
    "Lam": "Lam", "Ezk": "Ezek", "Dan": "Dan", "Hos": "Hos", "Jol": "Joel", "Amo": "Amos", "Oba": "Obad", "Jon": "Jonah",
    "Mic": "Mic", "Nam": "Nah", "Hab": "Hab", "Zep": "Zeph", "Hag": "Hag", "Zec": "Zech", "Mal": "Mal",
    "Mat": "Matt", "Matt": "Matt", "Mrk": "Mark", "Mark": "Mark", "Luk": "Luke", "Luke": "Luke", "Jhn": "John", "John": "John",
    "Act": "Acts", "Acts": "Acts", "Rom": "Rom", "1Co": "1Cor", "1Cor": "1Cor", "2Co": "2Cor", "Gal": "Gal", "Eph": "Eph",
    "Php": "Phil", "Phil": "Phil", "Col": "Col", "1Th": "1Thess", "2Th": "2Thess", "1Ti": "1Tim", "1Tim": "1Tim", "2Ti": "2Tim",
    "Tit": "Titus", "Phm": "Phlm", "Heb": "Heb", "Jas": "Jas", "1Pe": "1Pet", "1Pet": "1Pet", "2Pe": "2Pet", "1Jn": "1John",
    "1Jo": "1John", "2Jn": "2John", "3Jn": "3John", "Jud": "Jude", "Jude": "Jude", "Rev": "Rev",
}

TYPE = {
    "A": "adjective", "Adv": "adverb", "ADV": "adverb", "Art": "article", "Cond": "conditional", "Conj": "conjunction",
    "CONJ": "conjunction", "Cor": "correlative", "DemP": "demonstrative pronoun", "ImpP": "impersonal pronoun",
    "Intg": "interrogative", "Intj": "interjection", "INJ": "interjection", "N": "noun", "Neg": "negative", "Part": "particle",
    "PRT": "particle", "Prep": "preposition", "PREP": "preposition", "PerP": "personal pronoun", "PosP": "possessive pronoun",
    "RefP": "reflexive pronoun", "RelP": "relative pronoun", "V": "verb", "T": "article", "P": "pronoun", "R": "relative pronoun",
    "D": "demonstrative pronoun", "C": "reciprocal pronoun", "X": "indefinite pronoun", "Q": "correlative pronoun",
    "K": "correlative pronoun", "I": "interrogative pronoun", "F": "reflexive pronoun", "S": "possessive pronoun",
    "COND": "conditional", "ARAM": "Aramaic word", "HEB": "Hebrew word", "N-PRI": "proper noun (indeclinable)",
}
GENDER = {"M": "masculine", "F": "feminine", "N": "neuter", "C": "common"}
NAME_KIND = {"P": "person", "L": "place", "LG": "people group", "PG": "people group", "T": "title or name", "G": "people group"}


def decode_pos(code):
    """'H:N-M' -> 'noun, masculine'; 'N:N-M-P' -> 'proper noun (person), masculine'."""
    if not code:
        return ""
    lang, _, rest = code.partition(":")
    parts = rest.split("-")
    t = parts[0]
    if lang == "N":
        kind = NAME_KIND.get(parts[-1], "") if len(parts) >= 3 else ""
        label = "proper noun" + (f" ({kind})" if kind else "")
        g = GENDER.get(parts[1], "") if len(parts) > 1 else ""
        return label + (f", {g}" if g else "")
    if rest in TYPE:
        return TYPE[rest]
    label = TYPE.get(t, t)
    g = GENDER.get(parts[1], "") if len(parts) > 1 and parts[1] else ""
    return label + (f", {g}" if g else "")


def load_js(path):
    s = open(path, encoding="utf-8").read()
    return json.loads(s[s.index("{"): s.rindex("}") + 1])


class Sanitizer(HTMLParser):
    """Keep b, i, br, and convert <ref='Mat.5.43'>text</ref> into app links. Everything else becomes text."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.ref_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("b", "i"):
            self.out.append(f"<{tag}>")
        elif tag == "br":
            self.out.append("<br>")
        elif tag.startswith("ref"):
            pass

    def handle_endtag(self, tag):
        if tag in ("b", "i"):
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        self.out.append(data.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


REF_RE = re.compile(r"<ref='([^']*)'>(.*?)</ref>", re.S)


def sanitize_senses(html):
    # convert refs first into placeholders the sanitizer will not touch
    links = []

    def repl(m):
        target, label = m.group(1), re.sub(r"<[^>]+>", "", m.group(2))
        mm = re.match(r"([0-9]?[A-Za-z]+)\.(\d+)\.(\d+)", target.strip())
        if mm and mm.group(1) in STEP_BOOKS:
            osis = f"{STEP_BOOKS[mm.group(1)]}.{mm.group(2)}.{mm.group(3)}"
            links.append((osis, label))
            return f"\x00{len(links) - 1}\x00"
        return label

    # refs can nest in this data; resolve innermost first
    prev = None
    while prev != html:
        prev = html
        html = REF_RE.sub(repl, html)
    html = re.sub(r"<BR\s*/?>", "<br>", html, flags=re.I)
    html = html.replace("__", "")
    s = Sanitizer()
    s.feed(html)
    out = "".join(s.out)

    def back(m):
        osis, label = links[int(m.group(1))]
        label = label.replace("&", "&amp;").replace("<", "&lt;")
        return f'<a data-ref="{osis}">{label}</a>'

    out = re.sub("\x00(\\d+)\x00", back, out)
    out = re.sub(r"(<br>\s*){2,}", "<br>", out).strip()
    out = re.sub(r"^(<br>\s*)+", "", out)
    return out


def load_step(path, greek):
    """Return {strongId: {gloss, pos, posCode, senses?}} using the first (primary) row per base number."""
    res = {}
    for line in open(path, encoding="utf-8-sig"):
        cols = line.rstrip("\n").split("\t")
        if len(cols) < 8 or not re.match(r"^[HG]\d{4}", cols[0]):
            continue
        m = re.match(r"^([HG])0*(\d+)([A-Za-z]?)$", cols[0].strip())
        if not m:
            continue
        sid = f"{m.group(1)}{int(m.group(2))}{m.group(3)}"
        if sid in res:
            continue
        entry = {"gloss": cols[6].strip(), "posCode": cols[5].strip(), "translit": cols[4].strip()}
        if greek and cols[7].strip():
            entry["senses"] = sanitize_senses(cols[7])
        res[sid] = entry
    return res


def related_ids(*texts):
    ids = []
    for t in texts:
        for m in re.finditer(r"\b([HG])(\d+)\b", t or ""):
            sid = f"{m.group(1)}{int(m.group(2))}"
            if sid not in ids:
                ids.append(sid)
    return ids


def shard_of(sid):
    n = int(re.match(r"[HG](\d+)", sid).group(1))
    return f"{sid[0]}{n // 1000}"


def seg_text(seg):
    t = seg[0]
    return t.upper() if len(seg) > 1 and seg[1] & 4 else t


def main():
    heb = load_js(os.path.join(SRC, "strongs-hebrew.js"))
    grk = load_js(os.path.join(SRC, "strongs-greek.js"))
    step_h = load_step(os.path.join(SRC, "tbesh.txt"), False)
    step_g = load_step(os.path.join(SRC, "tbesg.txt"), True)

    lex = {}
    for sid, e in heb.items():
        st = step_h.get(sid, {})
        aramaic = "(Aramaic)" in (e.get("derivation") or "") or st.get("posCode", "").startswith("A:")
        lex[sid] = {
            "id": sid, "lang": "Aramaic" if aramaic else "Hebrew", "lemma": e.get("lemma", ""),
            "xlit": e.get("xlit", ""), "pron": e.get("pron", ""), "deriv": (e.get("derivation") or "").strip(),
            "def": (e.get("strongs_def") or "").strip(), "kjv": (e.get("kjv_def") or "").strip(),
            "gloss": st.get("gloss", ""), "pos": decode_pos(st.get("posCode", "")), "posCode": st.get("posCode", ""),
            "rel": [r for r in related_ids(e.get("derivation"), e.get("kjv_def")) if r != sid],
        }
    for sid, e in grk.items():
        st = step_g.get(sid, {})
        lex[sid] = {
            "id": sid, "lang": "Greek", "lemma": e.get("lemma", ""), "xlit": e.get("translit", ""), "pron": "",
            "deriv": (e.get("derivation") or "").strip(), "def": (e.get("strongs_def") or "").strip(),
            "kjv": (e.get("kjv_def") or "").strip(), "gloss": st.get("gloss", ""), "pos": decode_pos(st.get("posCode", "")),
            "posCode": st.get("posCode", ""), "senses": st.get("senses", ""),
            "rel": [r for r in related_ids(e.get("derivation"), e.get("kjv_def")) if r != sid],
        }
    for e in lex.values():
        e["rel"] = [r for r in e["rel"] if r in lex]

    # concordance from the tagged KJV text
    occ = defaultdict(list)  # sid -> [verseKey,...]
    renders = defaultdict(Counter)  # sid -> Counter(rendering)
    combined = Counter()  # sid -> occurrences rendered together with another id
    untranslated = Counter()
    used = set()
    for b in BOOKS:
        book = json.load(open(os.path.join(DATA, "kjv", f"{b['id']}.json"), encoding="utf-8"))
        bi = BOOK_IDX[b["id"]]
        for ch in book["chapters"]:
            for v in ch["verses"]:
                key = bi * 1000000 + ch["c"] * 1000 + v["v"]
                words = v.get("w", [])
                texts = defaultdict(list)
                for seg in v["s"]:
                    if len(seg) > 2:
                        texts[seg[2]].append(seg_text(seg))
                # group split words (same split id) into one rendering
                groups = {}
                for wi, w in enumerate(words):
                    f = w.split("|")
                    split = f[2] if len(f) > 2 else ""
                    gk = ("s", f[0], split) if split else ("w", wi)
                    groups.setdefault(gk, {"ids": f[0].split(), "text": []})
                    groups[gk]["text"].append(" ".join(texts.get(wi, [])))
                for g in groups.values():
                    rendering = re.sub(r"[^\w\s'-]", "", " ... ".join(t for t in g["text"] if t).strip()).strip().lower()
                    rendering = re.sub(r"\s+", " ", rendering)
                    for sid in g["ids"]:
                        used.add(sid)
                        if not occ[sid] or occ[sid][-1] != key:
                            occ[sid].append(key)
                        if not rendering:
                            untranslated[sid] += 1
                        elif len(g["ids"]) == 1:
                            renders[sid][rendering] += 1
                        else:
                            combined[sid] += 1

    missing = sorted(sid for sid in used if sid not in lex)
    os.makedirs(os.path.join(DATA, "strongs"), exist_ok=True)
    os.makedirs(os.path.join(DATA, "concordance"), exist_ok=True)
    os.makedirs(os.path.join(DATA, "reports"), exist_ok=True)

    shards = defaultdict(dict)
    for sid, e in lex.items():
        e["count"] = len(occ.get(sid, []))
        shards[shard_of(sid)][sid] = e
    for name, d in shards.items():
        json.dump(d, open(os.path.join(DATA, "strongs", f"{name}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    cshards = defaultdict(dict)
    for sid, refs in occ.items():
        cshards[shard_of(sid)][sid] = {
            "refs": refs,
            "kjv": renders[sid].most_common(),
            "combined": combined[sid],
            "untranslated": untranslated[sid],
        }
    for name, d in cshards.items():
        json.dump(d, open(os.path.join(DATA, "concordance", f"{name}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    json.dump({"missingFromLexicon": missing, "usedIds": len(used), "lexiconEntries": len(lex)},
              open(os.path.join(DATA, "reports", "strongs-missing.json"), "w"), indent=1)
    print("lexicon", len(lex), "used ids", len(used), "missing", len(missing), missing[:20])


if __name__ == "__main__":
    main()

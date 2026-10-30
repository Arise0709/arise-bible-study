"""Build cross-references, dictionaries and the thesaurus.

Outputs (public/data/):
  xrefs/{Book}.json            {"c.v": [["Prov.8.22-Prov.8.30", votes], ...]}  (OpenBible.info, CC BY)
  dict/isbe-{a..z}.json        {headword: html}                                (ISBE 1915, public domain)
  dict/hitchcock.json          {name: meaning}                                 (Hitchcock 1869, public domain)
  dict/webster-{a..z}.json     {headword: [{pos, senses:[...], syn}]}          (Webster 1913, public domain)
  thesaurus/wn-{a..z}.json     {lemma: [{pos, gloss, syn:[...], ant:[...]}]}   (WordNet, Princeton license)
  dict/index.json              [[headword, sourceCode], ...] for search
  kjv/vocab.json               sorted list of distinct KJV word forms (lowercase)

Only entries whose headword appears in (or lemmatises from) the KJV vocabulary are kept for
Webster and WordNet, so the app stays small while covering every word a reader can click.
"""
import json, os, re, html as htmlmod
from collections import defaultdict
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data-src")
DATA = os.path.join(ROOT, "public", "data")
BOOKS = json.load(open(os.path.join(ROOT, "scripts", "books.json")))
BOOK_IDS = {b["id"] for b in BOOKS}

ISBE_BOOKS = {
    "ge": "Gen", "ex": "Exod", "le": "Lev", "nu": "Num", "de": "Deut", "jos": "Josh", "jud": "Judg", "ru": "Ruth",
    "1sa": "1Sam", "2sa": "2Sam", "1ki": "1Kgs", "2ki": "2Kgs", "1ch": "1Chr", "2ch": "2Chr", "ezr": "Ezra", "ne": "Neh",
    "es": "Esth", "job": "Job", "ps": "Ps", "pr": "Prov", "ec": "Eccl", "so": "Song", "isa": "Isa", "jer": "Jer", "la": "Lam",
    "eze": "Ezek", "da": "Dan", "ho": "Hos", "joe": "Joel", "am": "Amos", "ob": "Obad", "jon": "Jonah", "mic": "Mic",
    "na": "Nah", "hab": "Hab", "zep": "Zeph", "hag": "Hag", "zec": "Zech", "mal": "Mal", "mt": "Matt", "mr": "Mark",
    "lu": "Luke", "joh": "John", "ac": "Acts", "ro": "Rom", "1co": "1Cor", "2co": "2Cor", "ga": "Gal", "eph": "Eph",
    "php": "Phil", "col": "Col", "1th": "1Thess", "2th": "2Thess", "1ti": "1Tim", "2ti": "2Tim", "tit": "Titus",
    "phm": "Phlm", "heb": "Heb", "jas": "Jas", "1pe": "1Pet", "2pe": "2Pet", "1jo": "1John", "2jo": "2John", "3jo": "3John",
    "jude": "Jude", "re": "Rev", "1john": "1John", "1kings": "1Kgs", "exodus": "Exod", "judges": "Judg", "leviticus": "Lev",
}


def dump(obj, *path):
    p = os.path.join(DATA, *path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def letter(word):
    c = word[:1].lower()
    return c if "a" <= c <= "z" else "other"


# ---------------- KJV vocabulary ----------------
def kjv_vocab():
    vocab = set()
    for b in BOOKS:
        book = json.load(open(os.path.join(DATA, "kjv", f"{b['id']}.json"), encoding="utf-8"))
        for ch in book["chapters"]:
            for v in ch["verses"]:
                text = "".join(s[0] for s in v["s"])
                for w in re.findall(r"[A-Za-z]+(?:'[a-z]+)?", text):
                    vocab.add(w.lower())
    return vocab


def lemma_candidates(w):
    """Very small, transparent lemmatiser for KJV forms (believeth -> believe, loved -> love, ...)."""
    c = {w}
    for suf, reps in [("eth", ["", "e"]), ("est", ["", "e"]), ("edst", ["", "e"]), ("ed", ["", "e"]), ("ing", ["", "e"]),
                      ("ies", ["y"]), ("es", ["", "e"]), ("s", [""]), ("th", [""]), ("st", [""]), ("ly", [""]),
                      ("er", ["", "e"]), ("ness", [""])]:
        if w.endswith(suf) and len(w) - len(suf) >= 2:
            stem = w[: -len(suf)]
            for r in reps:
                c.add(stem + r)
            if len(stem) > 2 and stem[-1] == stem[-2]:
                c.add(stem[:-1])
            if stem.endswith("i"):
                c.add(stem[:-1] + "y")
    return c


# ---------------- Cross references ----------------
def build_xrefs():
    per_book = defaultdict(lambda: defaultdict(list))
    n = 0
    with open(os.path.join(SRC, "cross_references.txt"), encoding="utf-8") as f:
        next(f)
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            frm, to, votes = parts[0], parts[1], int(parts[2])
            if votes <= 0:
                continue
            b, c, v = frm.split(".")
            if b not in BOOK_IDS or to.split(".")[0] not in BOOK_IDS:
                continue
            per_book[b][f"{c}.{v}"].append([to, votes])
            n += 1
    for b, d in per_book.items():
        for k in d:
            d[k].sort(key=lambda x: -x[1])
        dump(d, "xrefs", f"{b}.json")
    print("xrefs", n)


# ---------------- ISBE ----------------
def isbe_ref(osis):
    m = re.match(r"([0-9]?[a-zA-Z]+)\.(\d+)\.(\d+)", osis)
    if not m:
        return None
    b = ISBE_BOOKS.get(m.group(1).lower())
    return f"{b}.{m.group(2)}.{m.group(3)}" if b else None


def tei_to_html(elem, mode):
    """Convert a TEI <def> subtree to a small, safe HTML subset."""
    out = []

    def esc(t):
        return htmlmod.escape(t or "", quote=False)

    def walk(e):
        tag = e.tag
        if tag == "lb":
            out.append("<br>")
        elif tag == "hi":
            rend = e.get("rend", "")
            t = "b" if "bold" in rend else "i" if "italic" in rend else None
            if t:
                out.append(f"<{t}>")
            out.append(esc(e.text))
            for ch in e:
                walk(ch)
            if t:
                out.append(f"</{t}>")
            out.append(esc(e.tail))
            return
        elif tag == "ref":
            label = "".join(e.itertext())
            if e.get("osisRef"):
                r = isbe_ref(e.get("osisRef"))
                out.append(f'<a data-ref="{r}">{esc(label)}</a>' if r else esc(label))
            elif e.get("target"):
                out.append(f'<a data-entry="{esc(e.get("target"))}">{esc(label)}</a>')
            else:
                out.append(esc(label))
            out.append(esc(e.tail))
            return
        else:
            out.append(esc(e.text))
        for ch in e:
            walk(ch)
        out.append(esc(e.tail))

    walk(elem)
    s = "".join(out)
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"(\s*<br>\s*)+", "<br>", s).strip()
    s = re.sub(r"^(<br>)+|(<br>)+$", "", s)
    return s


def iter_tei(path):
    """iterparse that strips the TEI namespace so tags read as plain names."""
    for _, e in ET.iterparse(path, events=("end",)):
        e.tag = e.tag.rsplit("}", 1)[-1]
        yield e


def parse_tei(path):
    root = None
    for e in iter_tei(path):
        root = e
    return ET.ElementTree(root)


def build_isbe(index):
    tree = parse_tei(os.path.join(SRC, "isbe.tei.xml"))
    shards = defaultdict(dict)
    for e in tree.iter("entryFree"):
        name = e.get("n")
        d = e.find("def")
        if not name or d is None:
            continue
        shards[letter(name)][name] = tei_to_html(d, "isbe")
        index.append([name, "isbe"])
    for k, d in shards.items():
        dump(d, "dict", f"isbe-{k}.json")
    print("isbe", sum(len(d) for d in shards.values()))


def build_hitchcock(index):
    tree = parse_tei(os.path.join(SRC, "hitchcock.tei.xml"))
    out = {}
    for e in tree.iter("entryFree"):
        name, d = e.get("n"), e.find("def")
        if name and d is not None:
            out[name] = re.sub(r"\s+", " ", "".join(d.itertext())).strip()
            index.append([name, "hitchcock"])
    dump(out, "dict", "hitchcock.json")
    print("hitchcock", len(out))


# ---------------- Webster 1913 ----------------
def plain(e):
    return re.sub(r"\s+", " ", "".join(e.itertext())).strip() if e is not None else ""


def build_webster(index, wanted):
    shards = defaultdict(dict)
    count = 0
    for e in iter_tei(os.path.join(SRC, "webster1913.tei.xml")):
        if e.tag != "entryFree":
            continue
        key = re.sub(r"\(\d+\)$", "", e.get("sortKey", "")).strip()
        head = key.lower()
        if head not in wanted or " " in head:
            e.clear()
            continue
        pos = plain(e.find("pos"))
        senses = []
        # senses with KJV citations: keep quotation + Bible ref attached to the preceding sense
        current = None
        for ch in e:
            if ch.tag == "sense":
                d = ch.find(".//def")
                if d is not None:
                    current = {"d": plain(d)}
                    spec = ch.find("seg")
                    if spec is not None and spec.get("type") == "specialization":
                        current["spec"] = plain(spec)
                    senses.append(current)
            elif ch.tag == "def":
                current = {"d": plain(ch)}
                senses.append(current)
            elif ch.tag == "cit" and current is not None:
                q = plain(ch.find("quote")) if ch.find("quote") is not None else plain(ch)
                current.setdefault("q", []).append(q)
            elif ch.tag == "hi" and current is not None and current.get("q"):
                r = ch.find("ref")
                if r is not None and (r.get("osisRef") or "").startswith("Bible:"):
                    osis = r.get("osisRef").split(":", 1)[1]
                    if osis.split(".")[0] in BOOK_IDS:
                        current.setdefault("refs", []).append(osis)
        syn = ""
        for xr in e.iter("xr"):
            if xr.get("type") == "syn":
                syn = re.sub(r"^Syn\.\s*[—-]\s*", "", plain(xr))
                break
        etym = plain(e.find("etym"))
        if senses:
            item = {"pos": pos, "senses": senses[:12]}
            if syn:
                item["syn"] = syn[:600]
            if etym:
                item["etym"] = etym[:300]
            word = key[:1].upper() + key[1:]
            shards[letter(word)].setdefault(word, []).append(item)
            count += 1
        e.clear()
    for k, d in shards.items():
        dump(d, "dict", f"webster-{k}.json")
    for d in shards.values():
        for w in d:
            index.append([w, "webster"])
    print("webster entries", count, "headwords", sum(len(d) for d in shards.values()))


# ---------------- WordNet ----------------
WN_POS = {"n": "noun", "v": "verb", "a": "adjective", "s": "adjective", "r": "adverb"}


def build_wordnet(wanted):
    base = os.path.join(SRC, "wn", "package", "dict")
    synsets = {}
    for pos in ["noun", "verb", "adj", "adv"]:
        with open(os.path.join(base, f"data.{pos}"), encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.startswith("  "):
                    continue
                head, _, gloss = line.partition(" | ")
                p = head.split()
                offset, ss_type = p[0], p[2]
                wcnt = int(p[3], 16)
                words = [p[4 + 2 * i].replace("_", " ") for i in range(wcnt)]
                words = [re.sub(r"\([a-z]+\)$", "", w) for w in words]
                i = 4 + 2 * wcnt
                pcnt = int(p[i]); i += 1
                ants = []
                for _ in range(pcnt):
                    sym, off, ppos, st = p[i:i + 4]
                    i += 4
                    if sym == "!":
                        ants.append((off, ppos, int(st[2:], 16)))
                synsets[(offset, pos)] = {"t": ss_type, "w": words, "g": gloss.strip(), "ant": ants}
    posfile = {"n": "noun", "v": "verb", "a": "adj", "s": "adj", "r": "adv"}
    out = defaultdict(dict)
    n = 0
    for pos in ["noun", "verb", "adj", "adv"]:
        with open(os.path.join(base, f"index.{pos}"), encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.startswith("  "):
                    continue
                p = line.split()
                lemma = p[0].replace("_", " ")
                if lemma not in wanted:
                    continue
                synset_cnt = int(p[2])
                offs = p[-synset_cnt:]
                senses = []
                for off in offs[:8]:
                    s = synsets.get((off, pos))
                    if not s:
                        continue
                    syn = [w for w in s["w"] if w.lower() != lemma][:10]
                    ant = []
                    for aoff, apos, wnum in s["ant"]:
                        a = synsets.get((aoff, posfile[apos]))
                        if a and wnum and wnum <= len(a["w"]):
                            ant.append(a["w"][wnum - 1])
                        elif a:
                            ant.extend(a["w"][:2])
                    gloss = s["g"].split(";")[0].strip()
                    examples = re.findall(r'"([^"]+)"', s["g"])[:1]
                    item = {"pos": WN_POS[s["t"]], "gloss": gloss, "syn": syn}
                    if ant:
                        item["ant"] = sorted(set(ant))
                    if examples:
                        item["ex"] = examples[0]
                    senses.append(item)
                if senses:
                    out[letter(lemma)].setdefault(lemma, []).extend(senses)
                    n += 1
    for k, d in out.items():
        dump(d, "thesaurus", f"wn-{k}.json")
    print("wordnet lemmas", n)


def main():
    vocab = kjv_vocab()
    dump(sorted(vocab), "kjv", "vocab.json")
    wanted = set()
    for w in vocab:
        wanted |= lemma_candidates(w)
    print("kjv vocab", len(vocab), "lemma candidates", len(wanted))
    build_xrefs()
    index = []
    build_isbe(index)
    build_hitchcock(index)
    build_webster(index, wanted)
    build_wordnet(wanted)
    dump(index, "dict", "index.json")


if __name__ == "__main__":
    main()

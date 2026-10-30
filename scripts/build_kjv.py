"""Parse the CrossWire KJV OSIS file into compact per-book JSON.

Output: public/data/kjv/{BookId}.json
  {
    "id": "Gen", "name": "Genesis",
    "chapters": [ { "c": 1, "title": [segments] | absent, "verses": [verse, ...] } ]
  }
  verse = { "v": 1, "p": 1 (paragraph mark, optional), "h": heading (Ps 119 acrostic, optional),
            "s": [[text, flags?, wordIdx?], ...],
            "w": ["strongs|morph|splitId|TR forms", ...], "n": [[catchWord, noteText], ...] }
  flags bits: 1 = added by translators (italic), 2 = words of Jesus, 4 = divine name (LORD/GOD small caps),
              8 = inscription

The verse text is the concatenation of segment texts. Nothing is added or reworded.
Editorial "x-strongsMarkup" notes from module maintainers are dropped (they are not part of the KJV).
"""
import json, os, re, sys, xml.sax

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data-src", "kjvfull.xml")
OUT = os.path.join(ROOT, "public", "data", "kjv")
BOOKS = json.load(open(os.path.join(ROOT, "scripts", "books.json")))
BOOK_NAMES = {b["id"]: b["name"] for b in BOOKS}

ADDED, RED, DIVINE, INSCR = 1, 2, 4, 8


def norm_strongs(lemma):
    ids = []
    for tok in (lemma or "").split():
        m = re.match(r"strong:([HG])0*(\d+)([a-zA-Z]?)$", tok)
        if m:
            ids.append(f"{m.group(1)}{int(m.group(2))}{m.group(3)}")
    return ids


def tr_lemmas(lemma):
    return [t.split(":", 1)[1] for t in (lemma or "").split() if t.startswith("lemma.TR:")]


class H(xml.sax.ContentHandler):
    def __init__(self):
        super().__init__()
        self.books = {}
        self.book = None
        self.chapter = None
        self.verse = None  # current verse dict
        self.stack = []  # element names
        self.flags = 0
        self.flag_stack = []
        self.word = None  # index of current <w>
        self.note = None  # [catch, text] while inside a study note
        self.in_catch = False
        self.skip = 0  # depth inside ignored elements
        self.title = None  # segments of canonical psalm title
        self.pending_p = False

    # target list for text
    def target(self):
        if self.title is not None:
            return self.title
        if self.verse is not None:
            return self.verse["s"]
        return None

    def startElement(self, name, attrs):
        self.stack.append(name)
        self.flag_stack.append(self.flags)
        if self.skip:
            self.skip += 1
            return
        if name == "div" and attrs.get("type") == "book":
            bid = attrs["osisID"]
            self.book = {"id": bid, "name": BOOK_NAMES[bid], "chapters": []}
            self.books[bid] = self.book
        elif name == "chapter" and attrs.get("osisID"):
            c = int(attrs["osisID"].split(".")[1])
            self.chapter = {"c": c, "verses": []}
            self.book["chapters"].append(self.chapter)
        elif name == "title":
            if attrs.get("canonical") == "true" and attrs.get("type") == "psalm":
                self.title = []
            elif attrs.get("canonical") == "true" and attrs.get("type") == "acrostic":
                # Psalm 119 acrostic headings: keep as a heading before the next verse
                self.title = []
                self.acrostic = True
            else:
                self.skip = 1
        elif name == "verse":
            if attrs.get("sID"):
                v = int(attrs["osisID"].split(".")[2])
                self.verse = {"v": v, "s": [], "w": []}
                if getattr(self, "pending_heading", None):
                    self.verse["h"] = self.pending_heading
                    self.pending_heading = None
                self.chapter["verses"].append(self.verse)
            elif attrs.get("eID"):
                self.finish_verse()
                self.verse = None
        elif name == "milestone":
            t = attrs.get("type", "")
            if t == "x-p" and self.verse is not None:
                self.verse["p"] = 1
        elif name == "note":
            if attrs.get("type") == "study" and self.verse is not None:
                self.note = ["", ""]
            else:
                self.skip = 1
        elif name == "catchWord":
            self.in_catch = True
        elif name == "w":
            tgt_verse = self.verse if self.title is None else None
            ids = norm_strongs(attrs.get("lemma"))
            morph = " ".join(m.split(":", 1)[-1] for m in attrs.get("morph", "").split())
            split = attrs.get("type", "").replace("x-split-", "") if "x-split" in attrs.get("type", "") else ""
            # compact form: "strongs|morph|splitId|TR forms" with empty trailing fields dropped
            entry = "|".join([" ".join(ids), morph, split, " ".join(tr_lemmas(attrs.get("lemma")))]).rstrip("|")
            if self.title is not None:
                # titles carry their own word list stored on chapter
                wl = self.chapter.setdefault("tw", [])
                wl.append(entry)
                self.word = ("t", len(wl) - 1)
            elif tgt_verse is not None:
                tgt_verse["w"].append(entry)
                self.word = ("v", len(tgt_verse["w"]) - 1)
        elif name == "transChange":
            self.flags |= ADDED
        elif name == "q" and attrs.get("who") == "Jesus":
            self.flags |= RED
        elif name == "divineName":
            self.flags |= DIVINE
        elif name == "inscription":
            self.flags |= INSCR

    def endElement(self, name):
        self.stack.pop()
        self.flags = self.flag_stack.pop()
        if self.skip:
            self.skip -= 1
            return
        if name == "w":
            self.word = None
        elif name == "catchWord":
            self.in_catch = False
        elif name == "note" and self.note is not None:
            n = [re.sub(r"\s+", " ", self.note[0]).strip(), re.sub(r"^:\s*", "", re.sub(r"\s+", " ", self.note[1]).strip())]
            self.verse.setdefault("n", []).append(n)
            self.note = None
        elif name == "title" and self.title is not None:
            segs = clean_segments(self.title)
            if getattr(self, "acrostic", False):
                self.pending_heading = "".join(s[0] for s in segs)
                self.acrostic = False
            else:
                self.chapter["title"] = segs
            self.title = None

    def characters(self, content):
        if self.skip:
            return
        if self.note is not None:
            if self.in_catch:
                self.note[0] += content
            else:
                self.note[1] += content
            return
        tgt = self.target()
        if tgt is None:
            return
        widx = self.word[1] if self.word else None
        tgt.append([content, self.flags, widx])

    def finish_verse(self):
        self.verse["s"] = clean_segments(self.verse["s"])
        if not self.verse["w"]:
            del self.verse["w"]


def clean_segments(raw):
    # merge adjacent pieces with the same flags and word, then normalise whitespace
    merged = []
    for text, flags, widx in raw:
        if merged and merged[-1][1] == flags and merged[-1][2] == widx:
            merged[-1][0] += text
        else:
            merged.append([text, flags, widx])
    out = []
    for text, flags, widx in merged:
        text = re.sub(r"\s+", " ", text)
        if not text:
            continue
        out.append([text, flags, widx])
    # trim leading/trailing space of whole verse
    while out and not out[0][0].strip():
        out.pop(0)
    while out and not out[-1][0].strip():
        out.pop()
    if out:
        out[0][0] = out[0][0].lstrip()
        out[-1][0] = out[-1][0].rstrip()
    # collapse double spaces across segment boundaries
    for i in range(1, len(out)):
        if out[i - 1][0].endswith(" ") and out[i][0].startswith(" "):
            out[i][0] = out[i][0][1:]
    out = [s for s in out if s[0]]
    # whitespace-only plain segments carry no flags/word: store compactly
    res = []
    for text, flags, widx in out:
        if text.strip() == "" or (flags == 0 and widx is None):
            res.append([text] if flags == 0 else [text, flags])
        elif widx is None:
            res.append([text, flags])
        else:
            res.append([text, flags, widx])
    return res


def main():
    os.makedirs(OUT, exist_ok=True)
    h = H()
    xml.sax.parse(SRC, h)
    index = []
    total = 0
    for b in BOOKS:
        book = h.books[b["id"]]
        for ch in book["chapters"]:
            for v in ch["verses"]:
                total += 1
        with open(os.path.join(OUT, f"{b['id']}.json"), "w", encoding="utf-8") as f:
            json.dump(book, f, ensure_ascii=False, separators=(",", ":"))
        index.append({**b, "chapters": [len(c["verses"]) for c in book["chapters"]]})
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    print("books", len(index), "verses", total)


if __name__ == "__main__":
    main()

"""Build additional (plain-text) Bible translations for reading and comparison.

Source: scrollmapper/bible_databases formats/json (pinned commit), public-domain or CC0 translations only.
Output: public/data/translations/{ID}/{Book}.json  ->  {"c": [[verseText | null, ...], ...]}
        (index = verse number - 1; null where the translation has no such verse)

Text is copied exactly. Books are matched by canonical order and every book's chapter count is checked
against the KJV so a misaligned file can never ship. Strong's tagging exists only for the KJV.
"""
import hashlib, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data-src", "translations")
OUT = os.path.join(ROOT, "public", "data", "translations")
BOOKS = json.load(open(os.path.join(ROOT, "src", "lib", "books.json")))
KJV_INDEX = {b["id"]: b["chapters"] for b in json.load(open(os.path.join(ROOT, "public", "data", "kjv", "index.json")))}

COMMIT = "59b18c5af5845728c275d5b7178ad0d024172b1f"
TRANSLATIONS = [
    # id, file, name, year, license, note
    ("BSB", "BSB", "Berean Standard Bible", "2023", "CC0 1.0 (public domain dedication)", "Modern English translation."),
    ("NHEB", "NHEB", "New Heart English Bible", "2010s", "Public domain", "Modern English, based on the World English Bible."),
    ("ASV", "ASV", "American Standard Version", "1901", "Public domain", "Revision of the KJV tradition; renders the divine name as Jehovah."),
    ("YLT", "YLT", "Young's Literal Translation", "1898", "Public domain", "Very literal; helpful for seeing Hebrew and Greek word order and tense."),
    ("WBS", "Webster", "Webster Bible", "1833", "Public domain", "Noah Webster's light revision of the KJV. Words in [brackets] were supplied by the translator."),
    ("BBE", "BBE", "Bible in Basic English", "1949/1964", "Public domain (United States)", "Uses a limited English vocabulary for clarity."),
    ("GNV", "Geneva1599", "Geneva Bible", "1599", "Public domain", "The Reformation-era English Bible that preceded the KJV. Original spelling."),
]


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def main():
    registry = []
    errors = []
    for tid, fname, name, year, lic, note in TRANSLATIONS:
        path = os.path.join(SRC, f"{fname}.json")
        data = json.load(open(path, encoding="utf-8"))
        books = data["books"]
        if len(books) != 66:
            errors.append(f"{tid}: expected 66 books, found {len(books)}")
            continue
        outdir = os.path.join(OUT, tid)
        os.makedirs(outdir, exist_ok=True)
        verses = 0
        for b, src in zip(BOOKS, books):
            kjv_ch = KJV_INDEX[b["id"]]
            if len(src["chapters"]) != len(kjv_ch):
                errors.append(f"{tid} {b['id']}: {len(src['chapters'])} chapters, KJV has {len(kjv_ch)}")
                continue
            chapters = []
            for ch in src["chapters"]:
                vs = {v["verse"]: v["text"].strip() for v in ch["verses"]}
                n = max(vs) if vs else 0
                chapters.append([vs.get(i) for i in range(1, n + 1)])
                verses += len(vs)
            with open(os.path.join(outdir, f"{b['id']}.json"), "w", encoding="utf-8") as f:
                json.dump({"c": chapters}, f, ensure_ascii=False, separators=(",", ":"))
        registry.append({
            "id": tid, "name": name, "year": year, "license": lic, "note": note, "verses": verses,
            "source": f"scrollmapper/bible_databases formats/json/{fname}.json (git {COMMIT})",
            "url": "https://github.com/scrollmapper/bible_databases", "sha256": sha(path),
        })
        print(tid, verses, "verses")
    if errors:
        print("\n".join(errors))
        sys.exit(1)
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(registry, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()

#!/usr/bin/env bash
# Download the exact source files used to build public/data (pinned to commits where possible).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data-src/wn && cd data-src
GL=https://gitlab.com/crosswire-bible-society
GH=https://raw.githubusercontent.com
curl -fsSL -o kjvfull.xml "$GL/kjv/-/raw/d490be7e34762deb2c76cb2c1306d4808e27890d/kjvfull.xml"
curl -fsSL -o isbe.tei.xml "$GL/isbe/-/raw/ec5b70d0eb87db94b7c117182366028f907f0c17/isbe.tei.xml"
curl -fsSL -o hitchcock.tei.xml "$GL/hitchcock/-/raw/d79b9aae10337d6c0d387da91da3a5f997ee4829/hitchcock.tei.xml"
curl -fsSL -o webster1913.tei.xml "$GL/webster1913/-/raw/72baf03e62b6a0ebc659324b758bcf46a7dbdc8c/webster1913.tei.xml"
curl -fsSL -o strongs-hebrew.js "$GH/openscriptures/strongs/0acd2f251c2d35ff8db2dece4e0593979d3ac223/hebrew/strongs-hebrew-dictionary.js"
curl -fsSL -o strongs-greek.js "$GH/openscriptures/strongs/0acd2f251c2d35ff8db2dece4e0593979d3ac223/greek/strongs-greek-dictionary.js"
STEP="$GH/STEPBible/STEPBible-Data/be4191f0082aeedddb0eff0c02c966292b2bd641/Lexicons"
curl -fsSL -o tbesh.txt "$STEP/TBESH%20-%20Translators%20Brief%20lexicon%20of%20Extended%20Strongs%20for%20Hebrew%20-%20STEPBible.org%20CC%20BY.txt"
curl -fsSL -o tbesg.txt "$STEP/TBESG%20-%20Translators%20Brief%20lexicon%20of%20Extended%20Strongs%20for%20Greek%20-%20STEPBible.org%20CC%20BY.txt"
curl -fsSL -o cross_references.txt "$GH/scrollmapper/bible_databases/59b18c5af5845728c275d5b7178ad0d024172b1f/sources/extras/cross_references.txt"
mkdir -p translations
for t in BSB NHEB ASV YLT Webster BBE Geneva1599; do
  curl -fsSL -o "translations/$t.json" "$GH/scrollmapper/bible_databases/59b18c5af5845728c275d5b7178ad0d024172b1f/formats/json/$t.json"
done
# Commentaries (Cycle 4): CrossWire OSIS editions, public domain; commits pinned, checksums in scripts/build_commentaries.py
mkdir -p commentaries
for rc in mhc:537591a94c991941877b47a06666b6a7812e05d8 mhcc:b15ff40aab9556005fd3d38d5388040a90b99145 jfb:9f7106f538fe6e154a58fc2689e069dc69cbcaba clarke:bd94d38ee503ef6759fbdf1ea85ed12f4b5a2d5e kd:206b2f6b60fec34f68dc537322cffc975756db31 scofield:e46fa4f9c523dcdfecd62c43fe402aab1cc96f22; do
  r=${rc%%:*}; c=${rc##*:}
  curl -fsSL -o "commentaries/$r.osis.xml" "$GL/$r/-/raw/$c/$r.osis.xml"
  curl -fsSL -o "commentaries/$r.conf" "$GL/$r/-/raw/$c/$r.conf"
done
# Original languages (Cycle 4): STEPBible TAHOT/TAGNT + morphology code expansions (CC BY 4.0), Open Scriptures Hebrew Lexicon (CC BY 4.0)
mkdir -p lang
STEPC="$GH/STEPBible/STEPBible-Data/be4191f0082aeedddb0eff0c02c966292b2bd641"
for f in "TAHOT Gen-Deu" "TAHOT Jos-Est" "TAHOT Job-Sng" "TAHOT Isa-Mal"; do
  curl -fsSL -o "lang/${f// /-}.txt" "$STEPC/Translators%20Amalgamated%20OT%2BNT/${f// /%20}%20-%20Translators%20Amalgamated%20Hebrew%20OT%20-%20STEPBible.org%20CC%20BY.txt"
done
for f in "TAGNT Mat-Jhn" "TAGNT Act-Rev"; do
  curl -fsSL -o "lang/${f// /-}.txt" "$STEPC/Translators%20Amalgamated%20OT%2BNT/${f// /%20}%20-%20Translators%20Amalgamated%20Greek%20NT%20-%20STEPBible.org%20CC-BY.txt"
done
curl -fsSL -o lang/TEHMC.txt "$STEPC/Morphology%20codes/TEHMC%20-%20Translators%20Expansion%20of%20Hebrew%20Morphology%20Codes%20-%20STEPBible.org%20CC%20BY.txt"
curl -fsSL -o lang/TEGMC.txt "$STEPC/Morphology%20codes/TEGMC%20-%20Translators%20Expansion%20of%20Greek%20Morphhology%20Codes%20-%20STEPBible.org%20CC%20BY.txt"
for f in BrownDriverBriggs.xml LexicalIndex.xml AugIndex.xml; do
  curl -fsSL -o "lang/$f" "$GH/openscriptures/HebrewLexicon/21c9add13bc727d3a951361778e97e3ff7afd1ce/$f"
done
cd wn && npm pack wordnet-db@3.1.14 --silent && tar xzf wordnet-db-3.1.14.tgz

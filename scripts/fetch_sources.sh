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
cd wn && npm pack wordnet-db@3.1.14 --silent && tar xzf wordnet-db-3.1.14.tgz

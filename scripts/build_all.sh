#!/usr/bin/env bash
# Rebuild all static data in public/data from the pinned sources in data-src/.
# Run scripts/fetch_sources.sh first on a fresh checkout.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/build_kjv.py
python3 scripts/build_lexicon.py
python3 scripts/build_reference.py
python3 scripts/build_translations.py
python3 scripts/build_meta.py

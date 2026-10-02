# DigitLoom contributor guide

DigitLoom is a local-first major-system number encoder. Use its approved
pronunciation data and original interface design; keep the app fully static.

## Repository map

| Path | Purpose |
|---|---|
| `README.md` | Product, serving/deployment, data provenance, mapping, compression, and test instructions. |
| `LICENSE` | MIT license for project-authored code. |
| `NOTICE` | Distinguishes code licensing from the dictionary's source and share-alike terms. |
| `.gitignore` | Excludes dependencies, source caches, bytecode, and generated test output. |
| `.github/workflows/pages.yml` | CI tests and source-reproducibility check; deploys only `web/` from `main`. |
| `package.json`, `package-lock.json` | DigitLoom commands and locked development dependencies. |
| `requirements-data.txt` | Pinned build-only MessagePack dependency. |
| `playwright.config.mjs` | Desktop/mobile Chromium tests using loopback servers on 4173 and 4174. |
| `scripts/dictionary-sources.json` | The three approved upstream revisions, download URLs, SHA-256 hashes, and notice hashes. |
| `scripts/build_dictionary.py` | Phoneme conversion, frequency ranking, POS hints, and deterministic JSON/gzip generation. |
| `scripts/build-db.mjs` | Invokes local-venv or system Python, including Windows venv support. |
| `scripts/compression-formats.mjs` | Experimental lossless representations, used only by the benchmark. |
| `scripts/benchmark-compression.mjs` | Compression sizes, decode costs, sharding estimates, and optional browser/extended measurements. |
| `reports/compression-benchmark.json` | Measured results and input/output hashes for the current dictionary. |
| `web/index.html` | Accessible word builder, memory thread, progress, inline sound key, and suggestions. |
| `web/app.js` | Original UI controller; loads the dictionary and renders selections, validation, and length groups. |
| `web/logic.js` | Generic input normalization, state transitions, lookup, validation, grouping, and plain-text POS labels. |
| `web/dictionary.js` | Strict packed-format decoder and native gzip/JSON transport. |
| `web/styles.css` | DigitLoom's original responsive layout, typography, palette, and interaction styling. |
| `web/icon.svg` | Original woven-line brand mark and favicon. |
| `web/guide.html` | Instructions, sound families, and the moon-cake example. |
| `web/sources.html` | Public source credit, licenses, and descriptions of data transformations. |
| `web/data/db.json` | Canonical, tracked format-3 dictionary: source metadata and `byCode` ranked word/POS lists. |
| `web/data/db.txt.gz` | Equivalent tracked `digitloom-columns` version-1 payload with deterministic gzip headers. |
| `web/licenses/CMUdict.txt` | Upstream Carnegie Mellon dictionary notice. |
| `web/licenses/WordNet.txt` | Upstream Princeton WordNet 3.0 notice. |
| `web/licenses/wordfreq-NOTICE.txt` | Robyn Speer, source corpora, and SUBTLEX attribution. |
| `web/licenses/CC-BY-SA-4.0.txt` | License text for frequency data and the derived combined dictionary. |
| `test/dictionary_test.py` | Python conversion, parsing, metadata, provenance, checksum, and packing tests. |
| `test/logic.test.mjs` | Lookup/grouping, corpus counts, all code reachability, alternate codes, and invalid data. |
| `test/packed-dictionary.test.mjs` | Exact JSON/packed equivalence, size budget, Unicode, leading zeros, and corruption handling. |
| `test/app.spec.mjs` | Browser tests for the real UI, keyboard/touch, root/subpath hosting, notices, and transport behavior. |

## Data invariants

Vocabulary originates only in the pinned CMUdict. wordfreq supplies exact
lowercase frequency bins; WordNet supplies lexical POS hints, including indexed
inflections. No other vocabulary source or manual pronunciation guesses are
build inputs.

Codes are strings: preserve leading zeros. Include every digit-bearing source
pronunciation, without a fixed maximum length. Retain alternate codes and merge
duplicate word/code pairs. Zero-digit pronunciations cannot become choices.
ER maps to 4, TH/DH to 1, NG to 2, and ZH to 6. Repeated sounds remain separate.

Source revisions, license notices, counts, and fingerprints are intentional
release inputs. Source updates require inspection and deliberate regeneration.
Never hand-edit generated assets. `byCode` preserves frequency ranking within
each code, including alphabetical tie-breaking. Longest-first grouping belongs
to the UI, not to a lossy data transformation.

The packed format starts with a JSON header (`format: "digitloom-columns"`,
version 1, dictionaryVersion 3, source, codes, counts), followed by one line of
POS masks (n=1, v=2, a=4) and newline-separated spellings. The decoder restores
the same canonical dictionary. Native gzip is preferred; JSON is a capability
fallback, never a silent retry for a broken compressed download.

## UX and release invariants

Use original DigitLoom copy and styling. The example is `3277` -> `moon cake`.
The inline sound key must be keyboard/touch accessible without obscuring input.
State must remain correct after editing, clearing, selecting, or undoing.
Suggestions cover at least two digits while multiple digits remain, and one
digit when a single digit remains.

No external scripts, fonts, analytics, API requests, or accounts at runtime.
Retain relative asset links for project-site deployment. Keep numbers out of
URLs, storage, and network requests. Maintain responsive word wrapping, focus
indicators, and readable grammatical labels. All word spellings share one
color and weight; POS information appears as plain text, not color or bolding.
Code lengths belong in group headings, not per-word superscripts.

Publish only `web/`, with its data and required license notices. Code is MIT;
the combined dictionary remains CC BY-SA 4.0 with source conditions respected.
Do not drop attribution as part of UI or packaging changes.

## Commands

- Serve: `npm run serve`, or Python HTTP server with `--directory web`.
- Tooling: Node 20+, Python 3.9+; `npm ci`.
- Data setup: `python3 -m venv .venv`, then
  `.venv/bin/python -m pip install -r requirements-data.txt`.
- Initial build: `npm run build:data -- --download`; three pinned files are
  cached under `.cache/word-data/`. Subsequent `npm run build:data` is offline.
- Verify generated bytes: `npm run test:data`.
- Browser setup: `npx playwright install chromium`.
- Tests: `npm test`.
- Benchmark: `npm run benchmark:compression -- --browser --extended`.

Use the smallest relevant tests during development. Before release, run the
whole test suite and reproducibility check. Regenerate the compression report
when dictionary metadata, transport format, or loader changes; do not edit
reported timings or hashes manually.

# DigitLoom contributor guide

DigitLoom is a local-first major-system number encoder. Use its approved
pronunciation data and original interface design; keep the app fully static.

## Repository map

| Path | Purpose |
|---|---|
| `README.md` | Product, serving/deployment, data provenance, mapping, PAO, compression, and test instructions. |
| `LICENSE` | MIT license for project-authored code. |
| `NOTICE` | Distinguishes code licensing from the dictionary's and starter PAO table's sources and share-alike terms. |
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
| `web/index.html` | Accessible word builder, memory thread, progress, sound key, frequency filters, and suggestions. |
| `web/app.js` | Original UI controller; loads the dictionary and renders selections, filters, validation, and length groups. |
| `web/logic.js` | Input normalization, state transitions, frequency predicates, lookup, validation, grouping, and plain-text POS labels. |
| `web/dictionary.js` | Strict packed-format decoder and native gzip/JSON transport. |
| `web/pao.html` | PAO encoder page: number input, scene cards, issues, final-digit ending, table actions, and the collapsible editor. |
| `web/pao.js` | PAO UI controller: starter loading, scenes, warnings, lazy dictionary endings and peg ideas, editing, filters, and table import/export. |
| `web/pao.css` | Styles used only by the PAO page. |
| `web/pao-logic.js` | Pure PAO profile limits, validation, parsing, serialization, duplicate detection, and pair encoding. |
| `web/styles.css` | DigitLoom's original responsive layout, typography, palette, and interaction styling. |
| `web/icon.svg` | Original woven-line brand mark and favicon. |
| `web/guide.html` | Instructions, sound families, the moon-cake example, and PAO scenes. |
| `web/sources.html` | Public source credit, licenses, descriptions of data transformations, and the starter PAO table's terms. |
| `web/data/db.json` | Canonical, tracked format-5 dictionary: source metadata and `byCode` ranked word/POS/Zipf records. |
| `web/data/db.txt.gz` | Equivalent tracked `digitloom-columns` version-2 payload with deterministic gzip headers. |
| `web/data/pao-starter.json` | Original, editable CC BY-SA 4.0 starter PAO table with pegs from the dictionary vocabulary. |
| `web/licenses/CMUdict.txt` | Upstream Carnegie Mellon dictionary notice. |
| `web/licenses/WordNet.txt` | Upstream Princeton WordNet 3.0 notice. |
| `web/licenses/wordfreq-NOTICE.txt` | Robyn Speer, source corpora, and SUBTLEX attribution. |
| `web/licenses/CC-BY-SA-4.0.txt` | License text for frequency data and the derived combined dictionary. |
| `test/dictionary_test.py` | Python conversion, parsing, metadata, provenance, checksum, and packing tests. |
| `test/logic.test.mjs` | Lookup/grouping, corpus counts, all code reachability, alternate codes, and invalid data. |
| `test/packed-dictionary.test.mjs` | Exact JSON/packed equivalence, size budget, Unicode, leading zeros, and corruption handling. |
| `test/pao-logic.test.mjs` | PAO profile limits, normalization, parsing, serialization, duplicates, encoding, and the starter table. |
| `test/app.spec.mjs` | Browser tests for the real UI, keyboard/touch, root/subpath hosting, notices, and transport behavior. |
| `test/pao.spec.mjs` | Browser tests for PAO scenes, endings, editing, warnings, import/export, failures, privacy, and hosting. |

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

Each `byCode` record is `[word, pos, frequency]`; frequency is the exact
wordfreq Zipf score in integer hundredths, with 0 reserved for unranked words.
`getCandidates` returns `[word, code, pos, frequency]`. Highlight eligibility
comes from the score, not a candidate's index after filtering, POS, or list size.
Keep frequency order within each code and retain every word and pronunciation.

The packed format starts with a JSON header (`format: "digitloom-columns"`,
version 2, dictionaryVersion 5, source, codes, counts), followed by a POS-mask
line (n=1, v=2, a=4), a frequency line (two lowercase base36 characters per
integer score), and newline-separated spellings. The decoder restores the
same canonical dictionary, including scores. Native gzip is preferred; JSON
is a capability fallback, never a silent retry for a broken compressed download.
Update fixed asset revisions in HTML, module imports, and dictionary requests
together when a format change would make cached decoders incompatible.

## UX and release invariants

Use original DigitLoom copy and styling. The example is `3277` -> `moon cake`.
The inline sound key must be keyboard/touch accessible without obscuring input.
State must remain correct after editing, clearing, selecting, or undoing.
Suggestions cover at least two digits while multiple digits remain, and one
digit when a single digit remains.
Auto split is opt-in: plan complete 2-4-digit chunks, avoid a final single digit
when possible, and preserve selected words when switching modes. With common-only
filtering, Auto split plans complete chunks using only words at the current cutoff.
Green highlights default to Zipf 3.5, with no quota or reordering. The main-page
Filter panel supports cutoffs 1.0-8.0 in 0.1 steps and can hide uncommon words.
Unranked words never qualify. Filter changes preserve selections; Clear keeps
filter settings. An empty filtered result must explain how to recover.

No external scripts, fonts, analytics, API requests, or accounts at runtime.
Retain relative asset links for project-site deployment. Keep numbers out of
URLs, storage, and network requests. Maintain responsive word wrapping, focus
indicators, and readable grammatical labels. All word spellings share one
color and weight; POS information appears as plain text, not color or bolding.
Code lengths belong in group headings, not per-word superscripts.
Fixed asset-revision query strings are allowed; never derive them from target
numbers, word choices, or cutoff settings.

Publish only `web/`, with its data and required license notices. Code is MIT;
the combined dictionary remains CC BY-SA 4.0 with source conditions respected.
Do not drop attribution as part of UI or packaging changes.

## PAO invariants

The PAO page reads decimal digits in pairs, repeating person, action, object;
three pairs make a scene, and a final scene may have one or two slots. It has
no 2-4-digit Auto split. Associations are personal: never infer roles from POS
hints or pronunciation, never require associations to encode their pair, and
never add them to the dictionary. A final single digit is a separate
major-system ending chosen from the lazily loaded one-digit words. Preserve
leading zeros; never pad, drop, or silently repair input. Editing the number
clears the ending; Clear keeps the table.

Missing associations and duplicates within a role (case-, space-, and
NFC-insensitive) are explicit warnings that focus their table cells. Progress
counts only resolved pairs and a chosen ending; never report a number as
encoded while anything is unresolved. Encode long numbers completely and
paginate their scenes. Green marks belong only to dictionary words (peg ideas
and endings) at the default Zipf 3.5 cutoff, never to associations.

Profiles are `digitloom-pao` version 1 with 100 sorted `00`-`99` rows; imports
may be partial. Keep tables in memory: no automatic storage, and no tables,
numbers, or scenes in URLs, storage, or requests. Only explicit Import and
Export read or write a file; exports use the static name `digitloom-pao.json`
and contain only the table. Ask before replacing unexported changes, reject
invalid imports without changing the current table, and render imported text
as text. Each import, New blank table, Restore starter, or starter retry
supersedes earlier pending ones; work from a superseded choice must not change
the table or its feedback when it settles. Keep the starter's CC BY-SA 4.0
license and attribution, and preserve those of imported tables.

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

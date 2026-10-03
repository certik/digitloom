# DigitLoom

Online: https://certik.github.io/digitloom/

**Give numbers a memorable shape.**

DigitLoom turns digit sequences into words using the mnemonic major system.
Choose a word, imagine a scene, and keep building until the number is encoded.
For example, **3277 becomes moon cake**: m-n gives 32, and k-k gives 77.

The app runs entirely in the browser. It has no account system, ads, analytics,
remote search API, or runtime third-party scripts. Numbers and word choices
stay local.

## Run and deploy

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory web
# Open http://127.0.0.1:8000/
```

`npm run serve` runs the same command. No install or build is needed to serve
the checked-in app. Use HTTP, not a `file://` URL, for browser module loading.

Deploy the **entire `web/` directory**, including `data/`, `licenses/`, and
`icon.svg`. All app links are relative, so root and subdirectory hosting work.
On GitHub, select **Settings > Pages > Source > GitHub Actions**. The included
workflow checks the code and dictionary, then publishes only `web/` when the
`main` branch is updated. Pull requests run checks but cannot deploy.
For a repository named `digitloom` under `certik`, the default project-site URL
would be `https://certik.github.io/digitloom/`; a custom domain is optional.

## Features

- An input-first home page that moves up as you type, with suggestions directly
  beneath the number. Instructions and data details live on separate pages.
- Word groups ordered by encoded length, longest first.
- Common words first within each length, with alphabetical frequency ties.
- The five highest-ranked choices in each group highlighted and labelled
  "Recommended", without changing word typography or popularity order.
- Optional Auto split for mixed 2-4-digit word chunks, with a one-digit ending
  only when no complete split avoids it. All word lengths remain available
  with Auto split off.
- Top-aligned word spellings with plain-text grammatical hints underneath.
- A memory thread, encoded-digit progress, and Undo word shown after a choice,
  plus Clear to start over.
- An inline sound key with keyboard and touch support.
- Consistent compact navigation on every page, with a bold current-page label
  and an external-link indicator for GitHub. The DigitLoom brand returns to the
  word builder; on narrow screens, its icon keeps the menu in one compact row.
- Leading zeros, alternate pronunciations, and arbitrarily long inputs.
- Local gzip decoding and a JSON path for browsers without a native decoder.

Each choice encodes a prefix of the remaining digits. Suggestions cover at least
two digits while two or more remain; one-digit words handle a one-digit
remainder. A selected word always uses the exact code on its button, even if
another pronunciation gives that spelling a different code.

Auto split adds spaces at suggested word boundaries and offers words for the
next chunk only. It prefers longer available chunks while checking that the
rest can also be encoded, avoiding a final single digit when possible.
For example, `952147132` splits into `9521 471 32`, which can become
**planet rocket moon**. Turning Auto split on or off preserves selected words
and replans only the remaining digits. Editing still starts a new thread;
Clear leaves the chosen mode in place. If no complete split exists, the app
explains this instead of silently changing modes.

Recommendations use the existing frequency ranking, not grammatical labels
or a curated memorability score. Even the highest-ranked matches for an
unusual code may be obscure; all other choices remain available below them.

## Dictionary provenance

The complete build input is three openly licensed datasets, pinned by immutable
revision and SHA-256 in `scripts/dictionary-sources.json`:

| Source | Purpose | Terms |
|---|---|---|
| Carnegie Mellon Pronouncing Dictionary | ARPABET word pronunciations | BSD-style notice in `web/licenses/CMUdict.txt` |
| wordfreq v3.2, English large list | Exact-spelling frequency bins | CC BY-SA 4.0 and `web/licenses/wordfreq-NOTICE.txt` |
| Princeton WordNet 3.0, distributed by NLTK | Noun, verb, adjective indexes and inflection exceptions | `web/licenses/WordNet.txt` |

All spellings and pronunciations originate in CMUdict. WordNet and wordfreq
enrich that vocabulary; they do not add spellings. We read exact lowercase
frequency bins, without wordfreq's tokenization or phrase estimation. Words
absent from the frequency list remain available after ranked words.
POS tags describe possible grammatical roles, not sentence context or the
meaning of a particular pronunciation. The UI displays these as text labels;
words without hints are unlabeled. Code lengths appear in group headings, not
as per-word superscripts.

The pinned build contains:

- 135,166 pronunciation entries across 126,052 dictionary spellings.
- 125,854 spellings with usable digit-bearing pronunciations.
- 127,228 distinct word/code pairs, indexed under 31,071 codes.
- Encodings from 1 to 16 digits, with no hardcoded maximum word-code length.

Alternate pronunciations with identical codes are merged, while distinct codes
are retained. Zero-digit pronunciations cannot advance an input and are excluded
from suggestions; the metadata records them. CMUdict mainly represents North
American English and does not include every English word or pronunciation.

The vocabulary/rank/POS fingerprint is SHA-256 of
`json.dumps(db["byCode"], sort_keys=True, separators=(",", ":")).encode()`:

```text
694f98fdda69516e60c36f4f927279cdacff76ac48d01fe5e433d4923cbe3bc5
```

### Sound mapping

| Digit | ARPABET consonant family |
|---|---|
| 0 | S, Z |
| 1 | T, D, TH, DH |
| 2 | N, NG |
| 3 | M |
| 4 | R, ER |
| 5 | L |
| 6 | JH, CH, SH, ZH |
| 7 | K, G |
| 8 | F, V |
| 9 | P, B |

Ignore stress, other vowels, HH, W, and Y. ER retains its r sound and encodes 4.
Repeated sounds remain repeated digits: `S EH1 Z` gives `00`. Unknown phonemes
fail the build instead of being silently discarded.

## Reproduce the data

Development needs Node.js 20+ and Python 3.9+. The data builder's only extra
Python dependency is MessagePack.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-data.txt
npm run build:data -- --download
```

On Windows, install using `.venv\Scripts\python.exe`; the Node wrapper finds
that interpreter. Without a local venv it uses system Python.

The first build downloads about 16 MB from the three pinned upstream URLs.
Inputs are cached under `.cache/word-data/`, with hashes checked on every build.
Incorrect hashes are errors, not a reason to refresh silently. Required license
notices are also verified. After the first download, builds are offline:

```sh
npm run build:data
npm run test:data
```

The second command reconstructs both outputs and checks them byte-for-byte.
Gzip byte streams can differ between zlib versions; CI regenerates the
compressed asset, compares the canonical JSON with the committed file, and
tests complete decoded equivalence.
Do not edit `web/data/db.json` or `web/data/db.txt.gz` manually. Keep source
updates explicit: inspect their changes, regenerate outputs, and update counts,
fingerprints, and tests together.

## Compact browser download

The readable JSON is about 2.37 MB. Modern browsers instead download
`web/data/db.txt.gz`, about **516 KB**, using native `DecompressionStream`.
This is approximately a **78% transfer reduction** on a plain static host.
No external decompression library or server compression setting is required.
Browsers without the native API fetch JSON. Download/decompression errors are
reported explicitly, not hidden by downloading the larger fallback.

The packed format has a JSON header identifying `digitloom-columns` version 1,
the version-3 dictionary metadata, lexical code order, and counts. A second line
contains POS masks (noun=1, verb=2, adjective=4); subsequent lines are words.
Within-code ranked order is preserved exactly. Gzip level 9 omits the filename
and timestamp. Both transport forms restore identical dictionaries.

`reports/compression-benchmark.json` records reproducible format, gzip/Brotli,
sharding, and browser measurements for the current assets. Reproduce them with:

```sh
npm run benchmark:compression
npm run benchmark:compression -- --browser --extended
```

The full run needs Chromium and the data-build venv. Temporary benchmark payloads
stay under ignored `.cache/compression/`. The selected gzip transport balances
size, decoding cost, and ordinary static-host compatibility.

## Tests

```sh
npm ci
npx playwright install chromium
npm test
npm run test:data
```

Unit tests exercise conversion, rankings, POS hints, all exact-code lookups,
packing, malformed inputs, and source fingerprints. Playwright tests exercise
the actual app on desktop and mobile: encoding/undo, validation, long words,
sound-key interaction, local navigation, source notices, compressed/fallback
loading, and absence of remote runtime requests. Tests serve both root and
subdirectory URLs.

## Licenses

Project-authored code is **MIT licensed**; see `LICENSE`.
The combined dictionary is **CC BY-SA 4.0**, with the original source notices
retained. The MIT code license does not relicense the datasets.

Credit includes Carnegie Mellon University, Robyn Speer and wordfreq's source
corpora, the SUBTLEX authors including Marc Brysbaert and colleagues, and
Princeton University. SUBTLEX is freely available data. Keep `NOTICE`,
`web/sources.html`, and `web/licenses/` with redistributed materials as applicable;
identify data modifications and follow its share-alike terms.

## Publishing a fresh repository

Prepare a reviewed source snapshot in a new directory, excluding Git metadata,
local dependencies, caches, and test artifacts. Initialize a new `main` branch
there and commit that snapshot as the initial commit. Do not mirror development
branches or tags into the new repository. Include the source notices, code
license, generated dictionary assets, and workflow when preparing the snapshot.

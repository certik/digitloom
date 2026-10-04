# DigitLoom

Online: https://certik.github.io/digitloom/

**Give numbers a memorable shape.**

DigitLoom turns digit sequences into words using the mnemonic major system.
Choose a word, imagine a scene, and keep building until the number is encoded.
For example, **3277 becomes moon cake**: m-n gives 32, and k-k gives 77.
A separate PAO page turns digit pairs into person, action, and object scenes
from a table you prepare and edit yourself.

The app runs entirely in the browser. It has no account system, ads, analytics,
remote search API, or runtime third-party scripts. Numbers, word choices, and
PAO tables stay local.

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
- Green highlights based on wordfreq frequency, with a default Zipf cutoff
  of 3.5 and no fixed quota. A Filter panel can hide uncommon alternatives
  and adjust the cutoff without changing word typography or popularity order.
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
- A PAO page that reads pairs and a final single digit as person, action,
  and object scenes from an editable 110-code table. Its CC BY-SA starter
  includes contributed single-digit associations. It flags missing and
  duplicate associations and imports or exports tables as JSON without ever
  including your numbers.

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

Green highlights default to a wordfreq Zipf cutoff of 3.5, approximately 3.2
occurrences per million words. Open **Filter** beside the input to adjust the
cutoff from 1.0 to 8.0 in 0.1 steps. Lower values include more green words;
higher values include fewer. **Reset 3.5** restores the default cutoff.
Every qualifying word is highlighted, whether that means dozens, one, or
none in a group. Grammar labels do not affect this rule; usage frequency is
a guide, not a personal familiarity or memorability score.

**Common words only** hides lower-frequency and unranked alternatives, along
with empty length groups. Unranked words never become green, even at the
lowest cutoff. With Auto split enabled, the planner uses only words meeting
the current cutoff, so `3277` can split into `32 77` instead of a rare
four-digit word. If a filter leaves no choices or no complete split, the
builder explains this and offers **Show all words**; it never silently
changes the cutoff or drops digits. Changing filters preserves selected
words and replans only the remaining digits. Clear keeps these controls'
settings. They live only on this page, not in URLs or browser storage.
PAO peg ideas retain the default 3.5 cutoff.

The format-5 dictionary stores each entry as `[word, pos, frequency]`.
`frequency` is the exact wordfreq Zipf score in integer hundredths: for
example, 470 means Zipf 4.70. Zero marks an unranked spelling, not a measured
zero frequency. Retaining the original hundredths makes every supported
cutoff accurate without replacing frequency order with a curated list.

## PAO scenes

`web/pao.html` encodes numbers with a person-action-object (PAO) table, a
technique for fast recall that needs preparation. All 110 codes, `0`-`9` and
`00`-`99`, have three stable associations that you learn ahead of time. A number
is read in pairs, plus one final single-digit code when its length is odd.
Every code continues the repeating person, action, object cycle; three codes
make one scene. There is no 2-4-digit Auto split on this page.
With the starter table, **327753 becomes astronaut / frosts / lime**: the
person for 32, the action for 77, and the object for 53. In a table where 88
has the person musician, 53 the action squeezes, and 66 the object defendant,
885366 becomes musician / squeezes / defendant.

Unlike the word builder, PAO does not look up words that sound like the
digits. Associations are personal and need not encode their code
phonetically. A person can be an animal or a character, such as
Wile E. Coyote for 08, and an object can be a person. Roles are positions in
a scene, not parts of speech: DigitLoom never infers them from POS hints and
never adds them to the dictionary. The optional peg is a major-system word
that anchors each code, such as moon for 32.

- Every number is encoded as you type. Leading zeros are kept, spaces are
  ignored, other characters are rejected, and digits are never padded,
  dropped, or rewritten in the input.
- A final scene with only a person, or a person and an action, is valid.
- A single final digit uses its PAO row in the next role, not an ordinary
  dictionary word and not an invented zero-padded pair. For example, `324`
  uses the action for `4`, `32774` uses its object, and `3277534` starts a new
  scene with its person. `0` and `00` are different codes. Editing recomputes
  the scenes; Clear resets the number and output but keeps the table.
- Blank associations are reported as missing, and a value used for more than
  one code in the same role is reported as ambiguous, ignoring case, spacing,
  and Unicode composition. Each warning focuses the matching table cell.
  Progress adds the actual width of each resolved code: two digits for a pair,
  one for a single. A number is not reported as encoded while anything is
  unresolved.
- Long numbers are encoded completely and displayed 50 scenes at a time.

The collapsible table editor has a name field and single-line peg, person,
action, and object fields for each fixed code, with search and filters for
single-digit codes, two-digit codes, codes in the current number, missing
associations, and duplicates.
**Ideas** loads the dictionary only when asked and suggests words whose
complete code is exactly the selected single digit or pair, with the word
builder's green common-word marks. Encoding itself needs only the PAO table,
even for odd-length numbers. Changing an association changes it for every number.

The single-digit starter rows use associations supplied in contributor
feedback, including their names and context cues as provided. To keep this
110-code starter unambiguous, three generated pair assignments were changed:
person `14` is now **woodpecker**, action `37` is **brews**, and action `99`
is **gnaws**. This avoids collisions with **lumberjack**, **pours**, and
**chews** in the new single-digit rows. These are starter changes only;
imported personal tables are never rewritten to match them.

The table lives only in the open tab. It is not written to local storage,
session storage, IndexedDB, URLs, or a server, and the page warns before you
leave with unexported changes. **Export table** downloads
`digitloom-pao.json` with only the table and its license and attribution;
**Import table** reads such a file. New blank table, Restore starter, and
Import ask before replacing unexported changes. The most recent table choice
wins: when a slower, earlier import or starter request finishes, its table,
errors, and messages are discarded. Malformed, invalid, or
oversized files are rejected without touching the current table, and imported
text is always displayed as plain text. A failed starter download is reported
with Try again, New blank table, and Import table as recovery options.

### PAO table format

```json
{
  "format": "digitloom-pao",
  "version": 2,
  "name": "My PAO table",
  "license": "",
  "attribution": "",
  "entries": [
    { "code": "0", "peg": "", "person": "", "action": "", "object": "" },
    { "code": "00", "peg": "", "person": "", "action": "", "object": "" }
  ]
}
```

Exports always use version 2 and contain 110 entries, `0`-`9` first and then
`00`-`99`, one per line. Version-1 files remain importable: every pair
association, name, license, and attribution is kept, while the ten new
single-digit rows start blank. Fill those rows as needed for odd-length
numbers; they are not silently populated with somebody else's associations.
Imports may omit rows, blank cell fields, license, and attribution; these
become empty strings. Text is trimmed, and the name is required. Codes must be
unique one- or two-digit strings; numeric codes are rejected because `0` and
`00` must stay distinct. Version-1 files may contain only pair codes.
Unknown or repeated keys, wrong types, invalid
Unicode, tabs, line breaks, other control characters, and oversized values are
rejected. Limits are 256 KiB (262,144 bytes) of UTF-8 per file, and 80
characters for names and pegs, 200 for associations, and 1,000 for license
and attribution. Duplicate associations are warnings, not import errors. The
starter table in `web/data/pao-starter.json` uses this format.

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

The vocabulary/rank/POS/frequency fingerprint is SHA-256 of
`json.dumps(db["byCode"], sort_keys=True, separators=(",", ":")).encode()`:

```text
e6d3e151c5894a524e961b780ee9a015a157465e5cd7905c6f135a6c84e386f1
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

The readable JSON is about 2.82 MB. Modern browsers instead download
`web/data/db.txt.gz`, about **641 KB**, using native `DecompressionStream`.
This is approximately a **77% transfer reduction** on a plain static host.
No external decompression library or server compression setting is required.
Browsers without the native API fetch JSON. Download/decompression errors are
reported explicitly, not hidden by downloading the larger fallback.

The packed format has a JSON header identifying `digitloom-columns` version 2,
the version-5 dictionary metadata, lexical code order, and counts. A second line
contains POS masks (noun=1, verb=2, adjective=4). A third line contains two
lowercase base36 characters per frequency value, including `00` for unranked;
subsequent lines are word spellings. Within-code rank, POS hints, and exact
Zipf hundredths are preserved. Gzip level 9 omits the filename and timestamp.
Both transport forms restore identical dictionaries.

Dictionary-related entry scripts, shared modules, styles, and downloads use
a fixed `?v=5` asset revision; the PAO controller, profile logic, styles, and
starter use `?v=2`. Refreshed pages therefore do not mix older cached decoders
with new formats. These revisions are constant: numbers, choices, and cutoff
settings are never included in URLs or requests.

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
packing, malformed inputs, source fingerprints, and PAO table validation and
encoding. Playwright tests exercise the actual app on desktop and mobile:
encoding/undo, validation, long words, sound-key interaction, local
navigation, source notices, compressed/fallback loading, and absence of remote
runtime requests. PAO browser tests cover scenes, single-digit role
continuation, long numbers, editing, missing and duplicate warnings, import/export,
replacement prompts, load failures, and the absence of stored data. Tests
serve both root and subdirectory URLs.

## Licenses

Project-authored code is **MIT licensed**; see `LICENSE`.
The combined dictionary is **CC BY-SA 4.0**, with the original source notices
retained. The MIT code license does not relicense the datasets.

The DigitLoom starter PAO table, `web/data/pao-starter.json`, combines
DigitLoom's assembled paired examples with single-digit associations supplied
in contributor feedback, with pegs from the CMUdict-derived dictionary
vocabulary. It is also distributed under **CC BY-SA 4.0**, not the
MIT license. Its file records the license and an attribution linking to
https://certik.github.io/digitloom/sources.html, and exports of edited
starter tables keep both. Imported personal tables keep their own license and
attribution information.

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

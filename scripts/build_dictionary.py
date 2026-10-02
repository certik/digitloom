import argparse
from collections import Counter, defaultdict
import gzip
from io import BytesIO
from hashlib import sha256
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "word-data"
SOURCES = ROOT / "scripts" / "dictionary-sources.json"
OUTPUT = ROOT / "web" / "data" / "db.json"
PACKED_OUTPUT = ROOT / "web" / "data" / "db.txt.gz"

PHONEMES = {
    phone: str(digit)
    for digit, phones in enumerate([
        "S Z", "T D TH DH", "N NG", "M", "R ER",
        "L", "JH CH SH ZH", "K G", "F V", "P B",
    ])
    for phone in phones.split()
}
IGNORED = set("AA AE AH AO AW AY EH EY IH IY OW OY UH UW HH W Y".split())
SUFFIXES = {
    "n": [("s", ""), ("ses", "s"), ("xes", "x"), ("zes", "z"),
          ("ches", "ch"), ("shes", "sh"), ("men", "man"), ("ies", "y")],
    "v": [("s", ""), ("ies", "y"), ("es", "e"), ("es", ""),
          ("ed", "e"), ("ed", ""), ("ing", "e"), ("ing", "")],
    "a": [("er", ""), ("est", ""), ("er", "e"), ("est", "e")],
}


def encode(phones):
    digits = []
    for token in phones:
        if not re.fullmatch(r"[A-Z]+[012]?", token):
            raise ValueError(f"Invalid phoneme: {token!r}")
        phone = token.rstrip("012")
        if phone in PHONEMES:
            digits.append(PHONEMES[phone])
        elif phone not in IGNORED:
            raise ValueError(f"Unknown phoneme: {token!r}")
    return "".join(digits)


def read_pronunciations(text):
    pronunciations = defaultdict(set)
    count = 0
    for line in text.splitlines():
        fields = line.split("#", 1)[0].split()
        if not fields:
            continue
        if len(fields) < 2:
            raise ValueError(f"Missing pronunciation: {line!r}")
        word = re.sub(r"\(\d+\)$", "", fields[0]).lower()
        if not word:
            raise ValueError(f"Missing word: {line!r}")
        pronunciations[word].add(encode(fields[1:]))
        count += 1
    return dict(pronunciations), count


def frequency_ranks(path):
    import msgpack

    with gzip.open(path, "rb") as stream:
        bins = msgpack.load(stream, raw=False)
    if not bins or bins[0] != {"format": "cB", "version": 1}:
        raise ValueError("Unsupported wordfreq frequency format")
    ranks = {}
    for rank, words in enumerate(bins[1:]):
        if not isinstance(words, list):
            raise ValueError("Invalid wordfreq frequency bin")
        for word in words:
            if not isinstance(word, str) or word in ranks:
                raise ValueError(f"Invalid or duplicate frequency entry: {word!r}")
            ranks[word] = rank
    return ranks


def read_parts_of_speech(path):
    lemmas, exceptions = {}, {}
    with ZipFile(path) as archive:
        for part, name in [("n", "noun"), ("v", "verb"), ("a", "adj")]:
            lines = archive.read(f"wordnet/index.{name}").decode("utf-8").splitlines()
            lemmas[part] = {line.split()[0] for line in lines if line and not line.startswith(" ")}
            lines = archive.read(f"wordnet/{name}.exc").decode("utf-8").splitlines()
            exceptions[part] = {}
            for line in lines:
                word, *bases = line.split()
                exceptions[part].setdefault(word, set()).update(bases)
    return lemmas, exceptions


def part_of_speech(word, lemmas, exceptions):
    flags = ""
    for part in "nva":
        bases = {word}
        if word in exceptions[part]:
            bases.update(exceptions[part][word])
        else:
            # Accept detached inflections only when their lemma is in WordNet.
            bases.update(word[:-len(suffix)] + ending for suffix, ending in SUFFIXES[part]
                         if word.endswith(suffix))
        if bases & lemmas[part]:
            flags += part
    return flags


def build_database(pronunciations, entry_count, ranks, lemmas, exceptions, sources):
    by_code = defaultdict(list)
    words = sorted(pronunciations, key=lambda word: (ranks.get(word, float("inf")), word))
    skipped = []
    for word in words:
        flags = part_of_speech(word, lemmas, exceptions)
        for code in sorted(pronunciations[word]):
            if code:
                by_code[code].append([word, flags])
            else:
                skipped.append(word)
    by_code = dict(sorted(by_code.items(), key=lambda item: (len(item[0]), item[0])))
    pair_count = sum(map(len, by_code.values()))
    encoded_words = {word for entries in by_code.values() for word, _ in entries}
    pairs_by_length = Counter()
    for code, entries in by_code.items():
        pairs_by_length[len(code)] += len(entries)
    return {
        "version": 3,
        "source": {
            "name": "DigitLoom dictionary: CMUdict, wordfreq, and WordNet",
            "datasets": sources,
            "license": "CC-BY-SA-4.0",
            "attribution": "sources.html",
            "pronunciationCount": entry_count,
            "dictionaryWordCount": len(pronunciations),
            "wordCount": len(encoded_words),
            "pairCount": pair_count,
            "codeCount": len(by_code),
            "maxCodeLength": max(map(len, by_code)),
            "pairsByLength": dict(sorted(pairs_by_length.items())),
            "zeroDigitWords": sorted(set(skipped)),
            "phonemeDigits": PHONEMES,
            "ignoredPhonemes": sorted(IGNORED),
            "note": "All digit-bearing pronunciations in the pinned CMUdict, ranked by wordfreq "
                    "and enriched with WordNet part-of-speech hints. Not every English word.",
        },
        "byCode": by_code,
    }


def checked_bytes(path, expected):
    data = path.read_bytes()
    actual = sha256(data).hexdigest()
    if actual != expected:
        raise ValueError(f"SHA-256 mismatch for {path}: expected {expected}, got {actual}")
    return data


def pack_database(db):
    codes = sorted(db["byCode"])
    words, flags, counts = [], [], []
    for code in codes:
        entries = db["byCode"][code]
        counts.append(len(entries))
        for word, pos in entries:
            if not word or "\n" in word or "\r" in word:
                raise ValueError(f"Word cannot be represented in the packed dictionary: {word!r}")
            if not re.fullmatch(r"n?v?a?", pos):
                raise ValueError(f"Invalid part-of-speech flags: {pos!r}")
            words.append(word)
            flags.append(str(int("n" in pos) | (int("v" in pos) << 1) | (int("a" in pos) << 2)))
    header = {
        "format": "digitloom-columns", "version": 1, "dictionaryVersion": db["version"],
        "source": db["source"], "codes": codes, "counts": counts,
    }
    text = json.dumps(header, separators=(",", ":"), ensure_ascii=True) + "\n"
    text += "".join(flags) + "\n" + "\n".join(words)
    output = BytesIO()
    # No filename or timestamp: repeated builds produce the same gzip header.
    with gzip.GzipFile(filename="", mode="wb", fileobj=output, compresslevel=9, mtime=0) as stream:
        stream.write(text.encode("utf-8"))
    return output.getvalue()


def prepare_sources(sources, download):
    for source in sources.values():
        path = CACHE / source["file"]
        if not path.exists():
            if not download:
                raise FileNotFoundError(f"Missing {path}. Run npm run build:data -- --download first.")
            print(f"Downloading {source['name']}...", flush=True)
            request = Request(source["url"], headers={"User-Agent": "DigitLoom-dictionary-builder/1.0"})
            with urlopen(request, timeout=90) as response:
                data = response.read()
            if sha256(data).hexdigest() != source["sha256"]:
                raise ValueError(f"SHA-256 mismatch for download: {source['url']}")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        checked_bytes(path, source["sha256"])
        checked_bytes(ROOT / "web" / source["notice"], source["noticeSha256"])


def save_or_check(path, content, check):
    data = content.encode("utf-8") if isinstance(content, str) else content
    if check:
        if path.read_bytes() != data:
            raise ValueError(f"Stale generated file: {path}. Run npm run build:data.")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_bytes(data)
        temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description="Build the DigitLoom static major-system dictionary.")
    parser.add_argument("--download", action="store_true", help="Download missing, pinned open-source inputs.")
    parser.add_argument("--check", action="store_true", help="Compare outputs without modifying them.")
    args = parser.parse_args()
    sources = json.loads(SOURCES.read_text())
    prepare_sources(sources, args.download)
    pronunciations, count = read_pronunciations((CACHE / sources["cmudict"]["file"]).read_text())
    ranks = frequency_ranks(CACHE / sources["wordfreq"]["file"])
    lemmas, exceptions = read_parts_of_speech(CACHE / sources["wordnet"]["file"])
    db = build_database(pronunciations, count, ranks, lemmas, exceptions, sources)
    save_or_check(OUTPUT, json.dumps(db, separators=(",", ":"), ensure_ascii=True) + "\n", args.check)
    packed = pack_database(db)
    save_or_check(PACKED_OUTPUT, packed, args.check)
    stats = db["source"]
    print(f"{'Verified' if args.check else 'Built'} {stats['wordCount']:,} words, "
          f"{stats['pairCount']:,} word/code pairs, {stats['codeCount']:,} codes, "
          f"up to {stats['maxCodeLength']} digits.")
    print(f"Packed browser download: {len(packed):,} bytes.")


if __name__ == "__main__":
    main()

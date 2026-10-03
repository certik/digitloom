import hashlib
import gzip
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.build_dictionary import (
    PHONEMES, IGNORED, build_database, checked_bytes, encode,
    pack_database, part_of_speech, prepare_sources, read_pronunciations, save_or_check,
)


class DictionaryTests(unittest.TestCase):
    def test_all_arpabet_phones_are_accounted_for(self):
        self.assertEqual(len(PHONEMES) + len(IGNORED), 39)
        self.assertFalse(PHONEMES.keys() & IGNORED)
        for phone, digit in PHONEMES.items():
            self.assertEqual(encode([phone]), digit)
        for phone in IGNORED:
            self.assertEqual(encode([phone + "1"]), "")
        self.assertEqual(encode("M UW1 N K EY1 K".split()), "3277")
        self.assertEqual(encode("B AH1 T ER0".split()), "914")
        self.assertEqual(encode("DH EH1 N".split()), "12")
        self.assertEqual(encode("W IH1 NG".split()), "2")
        self.assertEqual(encode("EY1 ZH AH0".split()), "6")
        self.assertEqual(encode("S T N M R L SH K F P".split()), "0123456789")
        self.assertEqual(encode("Z DH NG M ER0 L JH G V B".split()), "0123456789")

    def test_repeated_sounds_and_leading_zeros_are_not_collapsed(self):
        self.assertEqual(encode("S EH1 Z".split()), "00")
        self.assertEqual(encode("T D TH DH".split()), "1111")
        self.assertEqual(encode("S T R EH1 NG K TH S".split()), "0142710")
        self.assertEqual(encode("S".split() * 20), "0" * 20)

    def test_unknown_or_malformed_phonemes_raise(self):
        for phone in ["AX", "ZZ", "1", "AH3", "AH01", "ah", ""]:
            with self.assertRaises(ValueError):
                encode([phone])
        with self.assertRaises(ValueError):
            read_pronunciations("missing")

    def test_comments_alternate_pronunciations_and_identical_codes(self):
        words, count = read_pronunciations(
            "read R EH1 D\nread(2) R IY1 D # alternate\n"
            "hour AW1 ER0\nhour(2) AW1\n# comment\n\n"
        )
        self.assertEqual(count, 4)
        self.assertEqual(words, {"read": {"41"}, "hour": {"4", ""}})

    def test_wordnet_exact_exception_and_inflection_lookup(self):
        lemmas = {"n": {"mouse", "cat", "box", "run"}, "v": {"run", "walk"}, "a": {"happy"}}
        exceptions = {"n": {"mice": {"mouse"}}, "v": {"ran": {"run"}}, "a": {}}
        for word, expected in [
            ("run", "nv"), ("mice", "n"), ("ran", "v"), ("cats", "n"),
            ("boxes", "n"), ("walked", "v"), ("walking", "v"),
            ("happier", ""), ("happy", "a"), ("unknownword", ""),
        ]:
            self.assertEqual(part_of_speech(word, lemmas, exceptions), expected)

    def test_builder_has_no_length_cutoff_and_uses_frequency_then_spelling(self):
        words = {"z": {"0"}, "a": {"0"}, "common": {"0"}, "variant": {"00", "0"},
                 "silent": {""}, "long": {"12345678901234567"}}
        lemmas = {"n": {"common"}, "v": set(), "a": set()}
        exceptions = {"n": {}, "v": {}, "a": {}}
        db = build_database(words, 8, {"common": 100, "a": 200, "z": 200}, lemmas, exceptions, {})
        self.assertEqual(db["byCode"]["0"], [
            ["common", "n", 800], ["a", "", 700], ["z", "", 700], ["variant", "", 0],
        ])
        self.assertEqual(db["source"]["maxCodeLength"], 17)
        self.assertEqual(db["source"]["pairCount"], 6)
        self.assertEqual(db["source"]["zeroDigitWords"], ["silent"])
        self.assertNotIn("", db["byCode"])

    def test_frequency_scores_preserve_exact_bins_and_distinguish_unranked_words(self):
        words = {
            "frequent": {"0"}, "above": {"0", "00"}, "at": {"0", "00"},
            "below": {"0", "00"}, "missing": {"0", "00"},
            "only-common": {"12"}, "only-rare": {"123"}, "maximum": {"99"}, "silent": {""},
        }
        ranks = {"frequent": 300, "above": 549, "at": 550, "below": 551,
                 "only-common": 550, "only-rare": 551, "maximum": 0, "silent": 100}
        lemmas = {"n": {"below", "missing"}, "v": set(), "a": set()}
        exceptions = {"n": {}, "v": {}, "a": {}}
        db = build_database(words, sum(map(len, words.values())), ranks, lemmas, exceptions, {})
        self.assertEqual(db["version"], 5)
        self.assertEqual(db["byCode"]["00"], [
            ["above", "", 351], ["at", "", 350], ["below", "n", 349], ["missing", "n", 0],
        ])
        self.assertEqual(db["byCode"]["99"], [["maximum", "", 900]])
        self.assertEqual(db["byCode"]["12"], [["only-common", "", 350]])
        self.assertEqual(db["byCode"]["123"], [["only-rare", "", 349]])
        for code in ["0", "00"]:
            self.assertEqual(next(entry[2] for entry in db["byCode"][code] if entry[0] == "above"), 351)

    def test_packed_dictionary_is_deterministic_and_preserves_code_and_word_order(self):
        db = {"version": 5, "source": {"test": True}, "byCode": {
            "12": [["common", "nva", 350], ["rare", "", 0]],
            "00": [["says", "nv", 500]],
            "123": [["longer", "a", 151]],
            "1": [["one", "n", 900], ["two", "v", 773], ["three", "na", 350], ["four", "va", 0]],
        }}
        packed = pack_database(db)
        self.assertEqual(pack_database(db), packed)
        self.assertEqual(packed[4:8], b"\0\0\0\0")
        header, flags, frequencies, words = gzip.decompress(packed).decode().split("\n", 3)
        header = json.loads(header)
        self.assertEqual(header["format"], "digitloom-columns")
        self.assertEqual(header["version"], 2)
        self.assertEqual(header["codes"], ["00", "1", "12", "123"])
        self.assertEqual(header["counts"], [1, 4, 2, 1])
        self.assertEqual(flags, "31256704")
        self.assertEqual([int(frequencies[index:index + 2], 36) for index in range(0, len(frequencies), 2)],
                         [500, 900, 773, 350, 0, 350, 0, 151])
        self.assertEqual(words.split("\n"), ["says", "one", "two", "three", "four", "common", "rare", "longer"])
        self.assertEqual(header["source"], db["source"])
        self.assertEqual(header["dictionaryVersion"], 5)
        db["byCode"]["0"] = [["bad\nword", "", 0]]
        with self.assertRaises(ValueError):
            pack_database(db)
        for frequency in [-1, 901, 0.5, True, "350", None]:
            db["byCode"]["0"] = [["word", "", frequency]]
            with self.assertRaisesRegex(ValueError, "Invalid word frequency"):
                pack_database(db)

    def test_committed_vocabulary_ranking_tags_and_frequencies_have_the_approved_fingerprint(self):
        database = Path(__file__).resolve().parent.parent / "web" / "data" / "db.json"
        by_code = json.loads(database.read_text())["byCode"]
        content = json.dumps(by_code, sort_keys=True, separators=(",", ":")).encode()
        self.assertEqual(hashlib.sha256(content).hexdigest(),
                         "e6d3e151c5894a524e961b780ee9a015a157465e5cd7905c6f135a6c84e386f1")

    def test_source_checksums_and_generated_check_are_strict(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.json"
            content = json.dumps({"hello": "world"}) + "\n"
            save_or_check(path, content, False)
            save_or_check(path, content, True)
            data = content.encode()
            self.assertEqual(checked_bytes(path, hashlib.sha256(data).hexdigest()), data)
            with self.assertRaises(ValueError):
                checked_bytes(path, "0" * 64)
            with self.assertRaises(ValueError):
                save_or_check(path, "different", True)
            self.assertEqual(path.read_bytes(), data)
            with patch("scripts.build_dictionary.CACHE", Path(directory)):
                with patch("scripts.build_dictionary.urlopen") as network:
                    with self.assertRaises(FileNotFoundError):
                        prepare_sources({"test": {"file": "missing"}}, False)
                    network.assert_not_called()


if __name__ == "__main__":
    unittest.main()

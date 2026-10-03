import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { DEFAULT_MINIMUM_ZIPF, DICTIONARY_VERSION, chooseCandidate, formatNumber, getCandidates, groupCandidates, isCommonWord, normalizeInput, partOfSpeechLabel, planChunks, validateDatabase } from '../web/logic.js';

const db = JSON.parse(await readFile(new URL('../web/data/db.json', import.meta.url)));

test('normalizes spaces but rejects non-digits and preserves leading zeroes', () => {
  assert.deepEqual(normalizeInput(' 009 20 '), { ok: true, digits: '00920', error: '' });
  assert.deepEqual(normalizeInput('12\n3'), { ok: false, digits: null, error: 'Use digits and spaces only.' });
  assert.deepEqual(normalizeInput(''), { ok: true, digits: '', error: '' });
  for (const invalid of ['-12', '1.5', '1e3', '1\t2', '１２', null]) {
    assert.equal(normalizeInput(invalid).ok, false);
  }
});

test('ranks common words first and includes WordNet metadata', () => {
  const candidates = getCandidates(db, '1234');
  assert.deepEqual(candidates.slice(0, 3).map((entry) => entry.slice(0, 3)), [
    ["don't", '12', ''],
    ['than', '12', ''],
    ['then', '12', 'na']
  ]);
  assert.equal(candidates.some((entry) => entry[1] === '1234'), true);
  assert.deepEqual(candidates.find(([word]) => word === 'down'), ['down', '12', 'nva', 588]);
});

test('frequency cutoffs are inclusive, adjustable, and never classify unranked words as common', () => {
  assert.equal(DEFAULT_MINIMUM_ZIPF, 3.5);
  for (const [frequency, cutoff, expected] of [
    [349, 3.5, false], [350, 3.5, true], [351, 3.5, true],
    [399, 4, false], [400, 4, true], [470, 4.7, true], [470, 4.71, false],
    [0, 0, false], [0, 3.5, false], [100, 1, true], [773, 8, false], [900, 9, true]
  ]) {
    assert.equal(isCommonWord(frequency, cutoff), expected, `${frequency} at ${cutoff}`);
  }
  assert.equal(isCommonWord(350), true);
  for (const frequency of [undefined, null, false, '350', -1, 0.5, 901, NaN, Infinity]) {
    assert.throws(() => isCommonWord(frequency), RangeError);
  }
  for (const cutoff of [null, false, '3.5', -0.1, 9.1, NaN, Infinity]) {
    assert.throws(() => isCommonWord(350, cutoff), RangeError);
  }
});

test('grammar labels describe all POS combinations without presentation classes', () => {
  for (const [flags, label] of [
    ['', ''], ['n', 'noun'], ['v', 'verb'], ['nv', 'noun, verb'],
    ['a', 'adjective'], ['na', 'noun, adjective'], ['va', 'verb, adjective'],
    ['nva', 'noun, verb, adjective']
  ]) {
    assert.equal(partOfSpeechLabel(flags), label);
  }
  assert.equal(partOfSpeechLabel(), '');
});

test('groups by encoded digit count, longest first, keeping source order and metadata', () => {
  const candidates = Object.freeze([
    Object.freeze(['long-spelling', '00', 'n', 600]),
    Object.freeze(['short', '00123', 'v', 400]),
    Object.freeze(['longest-spelling', '0', '', 0]),
    Object.freeze(['first', '001', 'na', 500]),
    Object.freeze(['a', '00', 'nv', 350]),
    Object.freeze(['second', '001', 'nva', 499])
  ]);
  const groups = groupCandidates(candidates);
  assert.deepEqual(groups.map(({ digitCount }) => digitCount), [5, 3, 2, 1]);
  for (const { digitCount, words } of groups) {
    assert.deepEqual(words, candidates.filter((candidate) => candidate[1].length === digitCount));
  }
  assert.equal(groups.reduce((count, { words }) => count + words.length, 0), candidates.length);
});

test('groups only available lengths, including empty and single-length results', () => {
  assert.deepEqual(groupCandidates([]), []);
  const candidates = getCandidates(db, '0');
  assert.deepEqual(groupCandidates(candidates), [{ digitCount: 1, words: candidates }]);
  const mixed = getCandidates(db, '1234');
  const groups = groupCandidates(mixed);
  assert.deepEqual(groups.map(({ digitCount }) => digitCount), [4, 3, 2]);
  for (const { digitCount, words } of groups) {
    assert.deepEqual(words, mixed.filter((candidate) => candidate[1].length === digitCount));
  }
});

test('choosing a candidate consumes only its code and rejects invalid choices', () => {
  const first = getCandidates(db, '3277').find((entry) => entry[0] === 'moon' && entry[1] === '32');
  const second = getCandidates(db, '77').find((entry) => entry[0] === 'cake' && entry[1] === '77');
  let state = { selected: [], remaining: '3277' };
  state = chooseCandidate(state, first);
  assert.equal(state.remaining, '77');
  state = chooseCandidate(state, second);
  assert.equal(state.remaining, '');
  assert.equal(formatNumber(state.selected, state.remaining), '32 77');
  assert.throws(() => chooseCandidate(state, first), /remaining digits/);
  assert.throws(() => chooseCandidate(state, ['empty', '', '']), /remaining digits/);
  assert.throws(() => chooseCandidate(state, undefined), /remaining digits/);
});

test('automatic chunks prefer longer complete splits without a single-digit tail', () => {
  for (const [digits, codes, expected] of [
    ['', [], []],
    ['0', ['0'], ['0']],
    ['123456', ['12', '123', '1234', '34', '456', '56'], ['1234', '56']],
    ['12345', ['1234', '123', '45', '5'], ['123', '45']],
    ['1234567', ['1234', '56', '7', '123', '45', '67'], ['123', '45', '67']],
    ['123456', ['1234', '123', '456'], ['123', '456']],
    ['12345', ['1234', '5'], ['1234', '5']],
    ['000912', ['0009', '00', '0912', '12'], ['0009', '12']],
    ['123', ['1', '23'], null],
    ['12345', ['12345'], null],
    ['1234', ['12'], null],
    ['99', [], null]
  ]) {
    const database = { byCode: Object.fromEntries(codes.map((code) => [code, [[`word-${code}`, '']]])) };
    assert.deepEqual(planChunks(database, digits), expected, `${digits}: ${codes.join(', ')}`);
  }
});

test('automatic chunks use real dictionary codes and handle long input without recursion', () => {
  assert.deepEqual(planChunks(db, '952147132'), ['9521', '471', '32']);
  const digits = '0'.repeat(10000);
  const chunks = planChunks(db, digits);
  assert.equal(chunks.join(''), digits);
  assert.ok(chunks.every((code) => code.length >= 2 && code.length <= 4 && db.byCode[code].length > 0));
  let state = { selected: [], remaining: '952147132' };
  for (const word of ['planet', 'rocket', 'moon']) {
    const code = planChunks(db, state.remaining)[0];
    const candidate = getCandidates(db, code).find(([spelling, digits]) => spelling === word && digits === code);
    state = chooseCandidate(state, candidate);
  }
  assert.equal(state.remaining, '');
  assert.equal(formatNumber(state.selected, state.remaining), '9521 471 32');
});

test('common-only chunk plans use the current cutoff and preserve full remaining encodability', () => {
  assert.deepEqual(planChunks(db, '3277'), ['3277']);
  assert.deepEqual(planChunks(db, '3277', 3.5), ['32', '77']);
  assert.deepEqual(planChunks(db, '3277', 1.5), ['3277']);
  assert.equal(planChunks(db, '3277', 5), null);
  const filtered = {
    byCode: { '12': [['common', '', 350], ['rare', 'n', 349]], '3': [['unranked', '', 0]] }
  };
  assert.deepEqual(planChunks(filtered, '123'), ['12', '3']);
  assert.deepEqual(planChunks(filtered, '12', 3.5), ['12']);
  assert.equal(planChunks(filtered, '12', 3.6), null);
  assert.equal(planChunks(filtered, '123', 3.5), null);
  for (const cutoff of [null, '3.5', NaN, -1, 10]) {
    assert.throws(() => planChunks(filtered, '', cutoff), RangeError);
    assert.throws(() => planChunks(filtered, '12', cutoff), RangeError);
  }
});

test('long and zero-prefixed remainders use available prefix queries', () => {
  assert.ok(getCandidates(db, '000000000000').length > 0);
  assert.ok(getCandidates(db, '12345678901234567890').length > 0);
  assert.equal(getCandidates(db, '999999999999').every((entry) => '999999999999'.startsWith(entry[1])), true);
  assert.ok(getCandidates(db, '0142710').some(([, code]) => code === '0142710'));
  assert.deepEqual(getCandidates(db, ''), []);
  assert.ok(getCandidates(db, '0').every((entry) => entry[1] === '0'));
  assert.ok(getCandidates(db, '00').every((entry) => entry[1] === '00'));
  const zeros = '0'.repeat(10000);
  const next = chooseCandidate({ selected: [], remaining: zeros }, getCandidates(db, zeros)[0]);
  assert.equal(next.remaining, zeros.slice(2));
});

test('generated independent dictionary has full pinned-source counts and provenance', async () => {
  assert.equal(db.version, DICTIONARY_VERSION);
  assert.equal(db.source.pronunciationCount, 135166);
  assert.equal(db.source.dictionaryWordCount, 126052);
  assert.equal(db.source.wordCount, 125854);
  assert.equal(db.source.pairCount, 127228);
  assert.equal(db.source.codeCount, 31071);
  assert.equal(db.source.maxCodeLength, 16);
  assert.equal(Object.values(db.byCode).reduce((count, entries) => count + entries.length, 0), 127228);
  assert.equal(new Set(Object.values(db.byCode).flat().map(([word]) => word)).size, 125854);
  const sources = JSON.parse(await readFile(new URL('../scripts/dictionary-sources.json', import.meta.url)));
  assert.deepEqual(db.source.datasets, sources);
  assert.equal(db.source.license, 'CC-BY-SA-4.0');
  assert.equal(validateDatabase(db), db);
  assert.ok((await stat(new URL('../web/data/db.json', import.meta.url))).size < 3_000_000);
});

test('word frequencies preserve the default highlights and support other cutoffs without quotas', () => {
  const commonByCode = Object.fromEntries(Object.entries(db.byCode)
    .map(([code, entries]) => [code, entries.filter(([, , frequency]) => isCommonWord(frequency))])
    .filter(([, entries]) => entries.length));
  for (const [code, count] of [['12', 69], ['32', 29], ['77', 14], ['08', 9], ['626', 1], ['3277', 0]]) {
    assert.equal(commonByCode[code]?.length ?? 0, count, code);
  }
  assert.equal(Object.keys(commonByCode).length, 6352);
  assert.equal(Object.values(commonByCode).reduce((sum, entries) => sum + entries.length, 0), 14934);
  const commonWords = new Set(Object.values(commonByCode).flat().map(([word]) => word));
  assert.equal(commonWords.size, 14616);
  for (const word of ['moon', 'cake', 'sofa', 'mango', 'cocoa']) assert.ok(commonWords.has(word), word);
  assert.ok(!commonWords.has('murmur'));
  assert.ok(!commonWords.has('menchaca'));
  for (const [cutoff, count] of [[1, 373], [2, 258], [3.5, 69], [4, 45], [5, 11], [6, 3], [8, 0]]) {
    assert.equal(db.byCode['12'].filter(([, , frequency]) => isCommonWord(frequency, cutoff)).length, count);
  }
});

test('every exact-code word is reachable, with no duplicates or unrelated suggestions', () => {
  for (const [code, entries] of Object.entries(db.byCode)) {
    const candidates = getCandidates(db, code);
    assert.deepEqual(candidates.filter((candidate) => candidate[1] === code),
      entries.map(([word, flags, frequency]) => [word, code, flags, frequency]), code);
    assert.ok(candidates.every((candidate) => code.startsWith(candidate[1])));
  }
});

test('long codes and alternate pronunciations are available without spelling guesses', () => {
  const codes = ['242625062', '2142625062'];
  for (const code of codes) {
    const word = getCandidates(db, code).find(([word, digits]) => word === 'internationalization' && digits === code);
    assert.deepEqual(word.slice(0, 3), ['internationalization', code, 'n']);
    assert.equal(word[3], db.byCode[code].find(([spelling]) => spelling === 'internationalization')[2]);
    assert.equal(chooseCandidate({ selected: [], remaining: code }, word).remaining, '');
    const groups = groupCandidates(getCandidates(db, code));
    assert.equal(groups[0].digitCount, code.length);
  }
  assert.equal(db.byCode['41'].filter(([word]) => word === 'read').length, 1);
  assert.ok(db.byCode['6'].some(([word]) => word === 'asia'));
  assert.ok(!db.byCode['0'].some(([word]) => word === 'asia'));
  assert.ok(db.byCode['1'].some(([word]) => word === 'the'));
  assert.ok(!db.byCode['0'].some(([word]) => word === 'the'));
  assert.ok(db.source.zeroDigitWords.includes('a'));
  assert.equal(db.byCode[''], undefined);
});

test('invalid database shapes fail explicitly instead of enabling a broken app', () => {
  for (const invalid of [null, {}, { ...db, version: 1 }, { ...db, version: 4 },
    { ...db, byCode: { '0': [['word', 'invalid', 0]] } },
    { ...db, byCode: { '0': [['word', 'n', 350], ['word', 'v', 0]] } },
    { ...db, byCode: { '0': [['word', 0, 0]] } },
    { ...db, byCode: { '0': [] } },
    { ...db, byCode: { '': [['word', 'n', 350]] } },
    { ...db, source: { ...db.source, maxCodeLength: 5 } }]) {
    assert.throws(() => validateDatabase(invalid), /Invalid local word database/);
  }
});

test('missing, corrupt, or out-of-order frequencies fail instead of guessing highlights', () => {
  const fixture = {
    version: DICTIONARY_VERSION, source: { maxCodeLength: 2, pairCount: 1, codeCount: 1 },
    byCode: { '00': [['word', 'n', 350]] }
  };
  assert.equal(validateDatabase(fixture), fixture);
  for (const frequency of [undefined, null, -1, 0.5, '350', true, 901, NaN, Infinity]) {
    assert.throws(() => validateDatabase({ ...fixture, byCode: { '00': [['word', 'n', frequency]] } }),
      /Invalid local word database/);
  }
  assert.throws(() => validateDatabase({ ...fixture, byCode: { '00': [['word', 'n']] } }),
    /Invalid local word database/);
  assert.throws(() => validateDatabase({
    ...fixture, source: { ...fixture.source, pairCount: 2 },
    byCode: { '00': [['first', '', 350], ['second', '', 351]] }
  }), /Invalid local word database/);
});

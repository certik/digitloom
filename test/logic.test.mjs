import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { chooseCandidate, formatNumber, getCandidates, groupCandidates, normalizeInput, partOfSpeechLabel, planChunks, validateDatabase } from '../web/logic.js';

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
  assert.deepEqual(candidates.find(([word]) => word === 'down'), ['down', '12', 'nva']);
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
    Object.freeze(['long-spelling', '00', 'n']),
    Object.freeze(['short', '00123', 'v']),
    Object.freeze(['longest-spelling', '0', '']),
    Object.freeze(['first', '001', 'na']),
    Object.freeze(['a', '00', 'nv']),
    Object.freeze(['second', '001', 'nva'])
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
  assert.equal(db.version, 4);
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

test('common-word metadata records every qualifying word without a fixed quota', () => {
  const { minimumZipf, countsByCode } = db.source.commonWords;
  assert.equal(minimumZipf, 3.5);
  for (const [code, count] of [['12', 69], ['32', 29], ['77', 14], ['08', 9], ['626', 1], ['3277', 0]]) {
    assert.equal(countsByCode[code] ?? 0, count, code);
  }
  assert.equal(Object.keys(countsByCode).length, 6352);
  assert.equal(Object.values(countsByCode).reduce((sum, count) => sum + count, 0), 14934);
  const commonWords = new Set(Object.entries(countsByCode)
    .flatMap(([code, count]) => db.byCode[code].slice(0, count).map(([word]) => word)));
  assert.equal(commonWords.size, 14616);
  for (const word of ['moon', 'cake', 'sofa', 'mango', 'cocoa']) assert.ok(commonWords.has(word), word);
  assert.ok(!commonWords.has('murmur'));
  assert.ok(!commonWords.has('menchaca'));
});

test('every exact-code word is reachable, with no duplicates or unrelated suggestions', () => {
  for (const [code, entries] of Object.entries(db.byCode)) {
    const candidates = getCandidates(db, code);
    assert.deepEqual(candidates.filter((candidate) => candidate[1] === code),
      entries.map(([word, flags]) => [word, code, flags]), code);
    assert.ok(candidates.every((candidate) => code.startsWith(candidate[1])));
  }
});

test('long codes and alternate pronunciations are available without spelling guesses', () => {
  const codes = ['242625062', '2142625062'];
  for (const code of codes) {
    const word = getCandidates(db, code).find(([word, digits]) => word === 'internationalization' && digits === code);
    assert.deepEqual(word, ['internationalization', code, 'n']);
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
  for (const invalid of [null, {}, { ...db, version: 1 }, { ...db, version: 3 },
    { ...db, byCode: { '0': [['word', 'invalid']] } },
    { ...db, byCode: { '0': [['word', 'n'], ['word', 'v']] } },
    { ...db, byCode: { '0': [['word', 0]] } },
    { ...db, byCode: { '0': [] } },
    { ...db, byCode: { '': [['word', 'n']] } },
    { ...db, source: { ...db.source, maxCodeLength: 5 } }]) {
    assert.throws(() => validateDatabase(invalid), /Invalid local word database/);
  }
});

test('missing or corrupt common-word metadata fails instead of guessing highlights', () => {
  const commonWords = db.source.commonWords;
  for (const invalid of [
    undefined, null, {}, { ...commonWords, minimumZipf: 4 },
    ...[undefined, null, [], { unknown: 1 }].map((countsByCode) => ({ ...commonWords, countsByCode })),
    ...[0, -1, 0.5, '1', true, db.byCode['00'].length + 1, Number.MAX_SAFE_INTEGER + 1].map((count) => ({
      ...commonWords, countsByCode: { ...commonWords.countsByCode, '00': count }
    }))
  ]) {
    assert.throws(() => validateDatabase({ ...db, source: { ...db.source, commonWords: invalid } }),
      /Invalid local word database/);
  }
});

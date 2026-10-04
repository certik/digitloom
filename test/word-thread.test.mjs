import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addThreadWord, analyzeWordThread, createWordThread, fitWordBetweenNeighbors,
  formatWordThread, orderedWords, removeThreadWord, replaceThreadWord, undoThreadChange, wordEnd
} from '../web/word-thread.js';

const candidate = (word, code) => [word, code, 'n', 400];
const example = () => {
  let thread = createWordThread('4350 29 345 23 405 97');
  let start = 0;
  for (const [word, code] of [
    ['harmless', '4350'], ['unhappy', '29'], ['merely', '345'],
    ['naomi', '23'], ['russel', '405'], ['buck', '97']
  ]) {
    thread = addThreadWord(thread, candidate(word, code), start);
    start += code.length;
  }
  return thread;
};
const named = (thread, name) => thread.words.find(({ candidate }) => candidate[0] === name);
const anchors = (thread) => ['harmless', 'russel', 'buck'].map((word) => named(thread, word));

test('an ordinary thread preserves prefix building, formatting, and undo', () => {
  let thread = createWordThread(' 32 77 ');
  assert.equal(thread.digits, '3277');
  assert.equal(analyzeWordThread(thread).appendStart, 0);
  assert.equal(analyzeWordThread(thread).canAppend, true);
  thread = addThreadWord(thread, candidate('moon', '32'), 0);
  assert.equal(formatWordThread(thread), '32 77');
  assert.equal(analyzeWordThread(thread).appendStart, 2);
  thread = addThreadWord(thread, candidate('cake', '77'), 2);
  assert.equal(analyzeWordThread(thread).complete, true);
  assert.equal(formatWordThread(thread), '32 77');
  thread = undoThreadChange(thread);
  assert.equal(thread.words.length, 1);
  assert.equal(analyzeWordThread(thread).matchedCount, 2);
  thread = undoThreadChange(thread);
  assert.equal(thread.words.length, 0);
  assert.equal(thread.history.length, 0);
  assert.equal(formatWordThread(thread), '3277');
  assert.equal(undoThreadChange(thread), thread);
  assert.equal(analyzeWordThread(createWordThread()).complete, false);
});

test('same-length replacement changes only the selected word and is individually undoable', () => {
  const original = example();
  const unhappy = named(original, 'unhappy');
  const changed = replaceThreadWord(original, unhappy.id, candidate('nap', '29'));
  assert.equal(changed.digits, original.digits);
  assert.deepEqual(anchors(changed), anchors(original));
  assert.equal(named(changed, 'nap').id, unhappy.id);
  assert.equal(named(changed, 'nap').start, unhappy.start);
  assert.deepEqual(changed.words.filter(({ id }) => id !== unhappy.id),
    original.words.filter(({ id }) => id !== unhappy.id));
  assert.equal(analyzeWordThread(changed).complete, true);
  assert.deepEqual(undoThreadChange(changed).words, original.words);
  assert.equal(replaceThreadWord(original, unhappy.id, unhappy.candidate), original);
});

test('a longer replacement keeps all anchors and exposes the exact overlap', () => {
  const original = example();
  const unhappy = named(original, 'unhappy');
  const changed = replaceThreadWord(original, unhappy.id, candidate('niobium', '293'));
  const status = analyzeWordThread(changed);
  assert.deepEqual(anchors(changed), anchors(original));
  assert.deepEqual(named(changed, 'merely'), named(original, 'merely'));
  assert.deepEqual(named(changed, 'naomi'), named(original, 'naomi'));
  assert.deepEqual(status.overlaps, [{ start: 6, end: 7 }]);
  assert.equal(status.overlapCount, 1);
  assert.equal(status.unassignedCount, 0);
  assert.equal(status.matchedCount, 15);
  assert.equal(status.complete, false);
  assert.equal(status.canAppend, false);
  assert.equal(status.coverage[6], 2);
  assert.equal(formatWordThread(changed), '4350 29345 23 405 97');
  assert.equal(formatWordThread(changed).replaceAll(' ', ''), original.digits);

  const merely = named(changed, 'merely');
  const fit = fitWordBetweenNeighbors(changed, merely.id);
  assert.deepEqual(fit, { start: 7, end: 9 });
  assert.equal(changed.digits.slice(fit.start, fit.end), '45');
  const repaired = replaceThreadWord(changed, merely.id, candidate('real', '45'), fit.start);
  assert.equal(analyzeWordThread(repaired).complete, true);
  assert.equal(formatWordThread(repaired), '4350 293 45 23 405 97');
  assert.deepEqual(anchors(repaired), anchors(original));
  assert.deepEqual(named(repaired, 'naomi'), named(original, 'naomi'));
  assert.deepEqual(undoThreadChange(repaired).words, changed.words);
});

test('shorter words leave fillable gaps without shifting or dropping neighbors', () => {
  const original = example();
  let thread = replaceThreadWord(original, named(original, 'unhappy').id, candidate('no', '2'));
  const status = analyzeWordThread(thread);
  assert.deepEqual(status.gaps, [{ start: 5, end: 6 }]);
  assert.equal(status.unassignedCount, 1);
  assert.equal(status.hasInternalGap, true);
  assert.equal(status.canAppend, false);
  assert.equal(formatWordThread(thread), '4350 2 9 345 23 405 97');
  const beforeFill = thread;
  thread = addThreadWord(thread, candidate('bee', '9'), status.gaps[0].start);
  assert.equal(analyzeWordThread(thread).complete, true);
  assert.deepEqual(orderedWords(thread).map(({ candidate }) => candidate[0]),
    ['harmless', 'no', 'bee', 'merely', 'naomi', 'russel', 'buck']);
  assert.deepEqual(anchors(thread), anchors(original));
  assert.deepEqual(undoThreadChange(thread).words, beforeFill.words);
  assert.deepEqual(undoThreadChange(undoThreadChange(thread)).words, original.words);
});

test('removal and undo retain the rest of the selection and restore its original order', () => {
  const original = example();
  const removed = removeThreadWord(original, named(original, 'merely').id);
  assert.deepEqual(anchors(removed), anchors(original));
  assert.deepEqual(analyzeWordThread(removed).gaps, [{ start: 6, end: 9 }]);
  assert.deepEqual(undoThreadChange(removed).words, original.words);
  let only = createWordThread('00');
  only = addThreadWord(only, candidate('says', '00'), 0);
  const empty = removeThreadWord(only, only.words[0].id);
  assert.equal(empty.words.length, 0);
  assert.equal(empty.history.length, 2);
  assert.equal(analyzeWordThread(empty).hasEdits, true);
  assert.deepEqual(undoThreadChange(empty).words, only.words);
});

test('fitting is only a preview and accounts for all preceding overlapping words', () => {
  const original = example();
  assert.deepEqual(fitWordBetweenNeighbors(original, named(original, 'unhappy').id), { start: 4, end: 6 });
  const changed = replaceThreadWord(original, named(original, 'unhappy').id, candidate('long', '29345'));
  assert.deepEqual(fitWordBetweenNeighbors(changed, named(changed, 'merely').id), { start: 9, end: 9 });
  const bigger = replaceThreadWord(changed, named(original, 'unhappy').id, candidate('longer', '293452'));
  assert.deepEqual(fitWordBetweenNeighbors(bigger, named(bigger, 'naomi').id), { start: 10, end: 11 });
  assert.deepEqual(original.words, example().words);
});

test('leading zeros and repeated digits are tracked by position, not spelling or concatenation', () => {
  let thread = createWordThread('00000');
  thread = addThreadWord(thread, candidate('first', '00'), 0);
  thread = addThreadWord(thread, candidate('second', '00'), 2);
  thread = addThreadWord(thread, candidate('last', '0'), 4);
  thread = replaceThreadWord(thread, thread.words[0].id, candidate('longer', '000'));
  assert.equal(formatWordThread(thread), '0000 0');
  assert.equal(formatWordThread(thread).replaceAll(' ', ''), '00000');
  assert.deepEqual(analyzeWordThread(thread).overlaps, [{ start: 2, end: 3 }]);
  assert.equal(wordEnd(thread.words[0]), 3);
});

test('nested and multiple overlaps count each problem digit once', () => {
  let thread = createWordThread('1234567890');
  thread = addThreadWord(thread, candidate('wide', '123456'), 0);
  thread = addThreadWord(thread, candidate('inside', '234'), 1);
  thread = addThreadWord(thread, candidate('another', '34567'), 2);
  thread = addThreadWord(thread, candidate('end', '0'), 9);
  const status = analyzeWordThread(thread);
  assert.deepEqual(status.overlaps, [{ start: 1, end: 6 }]);
  assert.deepEqual(status.gaps, [{ start: 7, end: 9 }]);
  assert.equal(status.overlapCount, 5);
  assert.equal(status.unassignedCount, 2);
  assert.equal(status.matchedCount, 3);
  assert.equal(formatWordThread(thread), '1234567 89 0');
});

test('invalid placements fail explicitly and never alter the target or existing words', () => {
  const thread = example();
  for (const value of ['12x', null, '1\n2']) assert.throws(() => createWordThread(value), TypeError);
  for (const [choice, start] of [[candidate('wrong', '99'), 4], [candidate('outside', '7'), 16],
    [candidate('before', '4'), -1], [candidate('fraction', '4'), 0.5]]) {
    assert.throws(() => addThreadWord(thread, choice, start), RangeError);
  }
  for (const choice of [undefined, [], ['', '29'], ['empty', ''], ['bad', 29]]) {
    assert.throws(() => addThreadWord(thread, choice, 4), TypeError);
  }
  assert.throws(() => replaceThreadWord(thread, 999, candidate('nap', '29')), RangeError);
  assert.throws(() => removeThreadWord(thread, 999), RangeError);
  assert.throws(() => fitWordBetweenNeighbors(thread, 999), RangeError);
  assert.equal(thread.digits, '4350293452340597');
  assert.deepEqual(thread.words, example().words);
});

test('formatting suggested tail chunks cannot duplicate or discard target digits', () => {
  let thread = createWordThread('952147132');
  assert.equal(formatWordThread(thread, ['9521', '471', '32']), '9521 471 32');
  thread = addThreadWord(thread, candidate('planet', '9521'), 0);
  assert.equal(formatWordThread(thread, ['471', '32']), '9521 471 32');
  for (const chunks of [['471'], ['47', '1320'], ['', '47132'], null]) {
    assert.throws(() => formatWordThread(thread, chunks), RangeError);
  }
});

test('long inputs use bounded coverage work and small undo records', () => {
  const digits = '00'.repeat(5000);
  let thread = createWordThread(digits);
  for (let index = 0; index < 1000; index += 1) {
    thread = addThreadWord(thread, candidate(`word ${index}`, '00'), index * 2);
  }
  const status = analyzeWordThread(thread);
  assert.equal(status.matchedCount, 2000);
  assert.deepEqual(status.gaps, [{ start: 2000, end: 10000 }]);
  assert.equal(thread.history.length, 1000);
  assert.ok(thread.history.every((change) => Object.keys(change).sort().join(',') === 'after,before,index'));
  assert.equal(formatWordThread(thread).replaceAll(' ', ''), digits);
});

test('operations do not mutate caller state or candidate arrays', () => {
  const initial = createWordThread('3277');
  Object.freeze(initial.words);
  Object.freeze(initial.history);
  Object.freeze(initial);
  const choice = candidate('moon', '32');
  const next = addThreadWord(initial, choice, 0);
  choice[0] = 'changed externally';
  assert.equal(next.words[0].candidate[0], 'moon');
  assert.equal(initial.words.length, 0);
  assert.equal(initial.history.length, 0);
  assert.ok(Object.isFrozen(next.words[0]));
  assert.ok(Object.isFrozen(next.words[0].candidate));
});

test('mixed edits and undo agree with direct per-position coverage', () => {
  const digits = '001234567890'.repeat(6);
  let thread = createWordThread(digits);
  let seed = 12345;
  const random = (limit) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor(seed / 2 ** 32 * limit);
  };
  const operations = new Set();
  const snapshots = [];
  for (let step = 0; step < 300; step += 1) {
    const operation = random(4);
    if (operation === 3 && snapshots.length) {
      operations.add('undo');
      thread = undoThreadChange(thread);
      assert.deepEqual(thread.words, snapshots.pop());
    } else {
      snapshots.push(thread.words);
      const word = thread.words[random(thread.words.length || 1)];
      const start = random(digits.length);
      const length = 1 + random(Math.min(12, digits.length - start));
      const choice = candidate(`choice ${step}`, digits.slice(start, start + length));
      if (operation === 1 && word) {
        operations.add('replace');
        thread = replaceThreadWord(thread, word.id, choice, start);
      } else if (operation === 2 && word) {
        operations.add('remove');
        thread = removeThreadWord(thread, word.id);
      } else {
        operations.add('add');
        thread = addThreadWord(thread, choice, start);
      }
    }
    const expected = Array(digits.length).fill(0);
    for (const word of thread.words) {
      assert.equal(word.candidate[1], digits.slice(word.start, wordEnd(word)));
      for (let offset = word.start; offset < wordEnd(word); offset += 1) expected[offset] += 1;
    }
    const status = analyzeWordThread(thread);
    assert.deepEqual([...status.coverage], expected);
    assert.equal(status.matchedCount, expected.filter((count) => count === 1).length);
    assert.equal(status.unassignedCount, expected.filter((count) => count === 0).length);
    assert.equal(status.overlapCount, expected.filter((count) => count > 1).length);
    assert.equal(status.complete, expected.every((count) => count === 1));
    assert.equal(thread.history.length, snapshots.length);
    assert.equal(formatWordThread(thread).replaceAll(' ', ''), digits);
  }
  assert.deepEqual([...operations].sort(), ['add', 'remove', 'replace', 'undo']);
});

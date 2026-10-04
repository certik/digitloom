import { normalizeInput } from './logic.js?v=5';

export function createWordThread(value = '') {
  const parsed = normalizeInput(value);
  if (!parsed.ok) throw new TypeError(parsed.error);
  return { digits: parsed.digits, words: [], history: [], nextId: 1 };
}

export function orderedWords(thread) {
  return [...thread.words].sort((left, right) => left.start - right.start || left.id - right.id);
}

export function wordEnd(word) {
  return word.start + word.candidate[1].length;
}

function placedWord(thread, candidate, start, id) {
  if (!Array.isArray(candidate) || typeof candidate[0] !== 'string' || !candidate[0] ||
      typeof candidate[1] !== 'string' || !/^[0-9]+$/.test(candidate[1])) {
    throw new TypeError('A word choice must include a spelling and a nonempty digit code.');
  }
  const end = start + candidate[1].length;
  if (!Number.isSafeInteger(start) || start < 0 || end > thread.digits.length ||
      thread.digits.slice(start, end) !== candidate[1]) {
    throw new RangeError('The selected word does not encode the digits at this position.');
  }
  return Object.freeze({ id, start, candidate: Object.freeze([...candidate]) });
}

function wordIndex(thread, id) {
  const index = thread.words.findIndex((word) => word.id === id);
  if (index < 0) throw new RangeError('The selected word is no longer in this thread.');
  return index;
}

function recordChange(thread, index, after) {
  const before = thread.words[index] ?? null;
  const words = [...thread.words];
  words.splice(index, before ? 1 : 0, ...(after ? [after] : []));
  // Store only the changed placement, not a copy of the entire thread per edit.
  const history = [...thread.history, { index, before, after }];
  return { ...thread, words, history };
}

export function addThreadWord(thread, candidate, start) {
  const word = placedWord(thread, candidate, start, thread.nextId);
  return { ...recordChange(thread, thread.words.length, word), nextId: thread.nextId + 1 };
}

export function replaceThreadWord(thread, id, candidate, start) {
  const index = wordIndex(thread, id);
  const before = thread.words[index];
  const after = placedWord(thread, candidate, start ?? before.start, id);
  if (before.start === after.start && before.candidate.length === after.candidate.length &&
      before.candidate.every((value, offset) => value === after.candidate[offset])) return thread;
  return recordChange(thread, index, after);
}

export function removeThreadWord(thread, id) {
  return recordChange(thread, wordIndex(thread, id), null);
}

export function undoThreadChange(thread) {
  const change = thread.history.at(-1);
  if (!change) return thread;
  const words = [...thread.words];
  words.splice(change.index, change.after ? 1 : 0, ...(change.before ? [change.before] : []));
  return { ...thread, words, history: thread.history.slice(0, -1) };
}

function coverageRanges(coverage, matches) {
  const ranges = [];
  let start = -1;
  for (let offset = 0; offset <= coverage.length; offset += 1) {
    if (offset < coverage.length && matches(coverage[offset])) {
      if (start < 0) start = offset;
    } else if (start >= 0) {
      ranges.push({ start, end: offset });
      start = -1;
    }
  }
  return ranges;
}

export function analyzeWordThread(thread) {
  const changes = new Int32Array(thread.digits.length + 1);
  const words = orderedWords(thread);
  for (const word of words) {
    const end = wordEnd(word);
    if (!Number.isSafeInteger(word.start) || word.start < 0 || end <= word.start || end > thread.digits.length) {
      throw new RangeError('A word placement lies outside the number.');
    }
    changes[word.start] += 1;
    changes[end] -= 1;
  }
  const coverage = new Uint32Array(thread.digits.length);
  let count = 0;
  let matchedCount = 0;
  let unassignedCount = 0;
  let overlapCount = 0;
  for (let offset = 0; offset < coverage.length; offset += 1) {
    count += changes[offset];
    coverage[offset] = count;
    if (count === 0) unassignedCount += 1;
    else if (count === 1) matchedCount += 1;
    else overlapCount += 1;
  }
  const gaps = coverageRanges(coverage, (value) => value === 0);
  const overlaps = coverageRanges(coverage, (value) => value > 1);
  const hasInternalGap = gaps.some(({ end }) => end < thread.digits.length);
  return {
    words, coverage, gaps, overlaps, matchedCount, unassignedCount, overlapCount, hasInternalGap,
    complete: thread.digits.length > 0 && matchedCount === thread.digits.length,
    canAppend: !hasInternalGap && overlapCount === 0,
    appendStart: gaps[0]?.start ?? thread.digits.length,
    hasEdits: thread.history.some(({ before }) => before !== null)
  };
}

export function fitWordBetweenNeighbors(thread, id) {
  const words = orderedWords(thread);
  const index = words.findIndex((word) => word.id === id);
  if (index < 0) throw new RangeError('The selected word is no longer in this thread.');
  let start = 0;
  for (let offset = 0; offset < index; offset += 1) start = Math.max(start, wordEnd(words[offset]));
  return { start, end: words[index + 1]?.start ?? thread.digits.length };
}

export function formatWordThread(thread, trailingChunks) {
  const ranges = [];
  for (const word of orderedWords(thread)) {
    const last = ranges.at(-1);
    const end = wordEnd(word);
    if (last && word.start < last.end) last.end = Math.max(last.end, end);
    else ranges.push({ start: word.start, end });
  }
  const parts = [];
  let cursor = 0;
  for (const { start, end } of ranges) {
    if (cursor < start) parts.push(thread.digits.slice(cursor, start));
    parts.push(thread.digits.slice(start, end));
    cursor = end;
  }
  const remaining = thread.digits.slice(cursor);
  if (trailingChunks !== undefined && (!Array.isArray(trailingChunks) ||
      trailingChunks.some((code) => typeof code !== 'string' || !/^[0-9]+$/.test(code)) ||
      trailingChunks.join('') !== remaining)) {
    throw new RangeError('The suggested chunks must preserve the remaining digits.');
  }
  if (remaining) parts.push(trailingChunks ? trailingChunks.join(' ') : remaining);
  return parts.join(' ');
}

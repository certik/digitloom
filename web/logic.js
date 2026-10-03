export function normalizeInput(value) {
  if (typeof value !== 'string' || /[^0-9 ]/.test(value)) {
    return { ok: false, digits: null, error: 'Use digits and spaces only.' };
  }
  return { ok: true, digits: value.replaceAll(' ', ''), error: '' };
}

export function chooseCandidate(state, candidate) {
  const code = candidate?.[1];
  if (typeof code !== 'string' || !code || !state.remaining.startsWith(code)) {
    throw new RangeError('The selected word does not encode the remaining digits.');
  }
  return {
    selected: [...state.selected, candidate],
    remaining: state.remaining.slice(code.length)
  };
}

export function formatNumber(selected, remaining) {
  const chunks = selected.map((entry) => entry[1]);
  if (remaining) chunks.push(remaining);
  return chunks.join(' ');
}

export function planChunks(db, digits) {
  const lengths = new Uint8Array(digits.length);
  const singleDigitTails = new Uint8Array(digits.length + 1).fill(2);
  singleDigitTails[digits.length] = 0;
  for (let offset = digits.length - 1; offset >= 0; offset -= 1) {
    const minimum = offset === digits.length - 1 ? 1 : 2;
    for (let length = Math.min(4, digits.length - offset); length >= minimum; length -= 1) {
      if (!db.byCode[digits.slice(offset, offset + length)]?.length) continue;
      const tails = singleDigitTails[offset + length] + Number(length === 1);
      // Prefer a complete split without a single-digit tail, then longer chunks.
      if (tails < singleDigitTails[offset]) {
        singleDigitTails[offset] = tails;
        lengths[offset] = length;
      }
    }
  }
  if (singleDigitTails[0] === 2) return null;
  const chunks = [];
  for (let offset = 0; offset < digits.length; offset += lengths[offset]) {
    chunks.push(digits.slice(offset, offset + lengths[offset]));
  }
  return chunks;
}

export function validateDatabase(db) {
  const invalid = () => { throw new Error('Invalid local word database; rebuild it with npm run build:data.'); };
  if (db?.version !== 3 || !db.byCode ||
      typeof db.byCode !== 'object' || Array.isArray(db.byCode) ||
      !Number.isSafeInteger(db.source?.maxCodeLength) || db.source.maxCodeLength < 0 ||
      !Number.isSafeInteger(db.source.pairCount) || db.source.pairCount < 0 ||
      !Number.isSafeInteger(db.source.codeCount) || db.source.codeCount < 0) invalid();
  let pairCount = 0;
  let maxCodeLength = 0;
  for (const [code, entries] of Object.entries(db.byCode)) {
    if (!/^[0-9]+$/.test(code) || !Array.isArray(entries) || !entries.length) invalid();
    const seen = new Set();
    maxCodeLength = Math.max(maxCodeLength, code.length);
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 ||
          typeof entry[0] !== 'string' || !entry[0] || seen.has(entry[0]) ||
          typeof entry[1] !== 'string' || !/^n?v?a?$/.test(entry[1])) invalid();
      seen.add(entry[0]);
      pairCount += 1;
    }
  }
  if (pairCount !== db.source.pairCount || maxCodeLength !== db.source.maxCodeLength ||
      Object.keys(db.byCode).length !== db.source.codeCount) invalid();
  return db;
}

export function getCandidates(db, digits) {
  const candidates = [];
  const firstLength = digits.length === 1 ? 1 : 2;
  for (let length = firstLength; length <= Math.min(db.source.maxCodeLength, digits.length); length += 1) {
    const code = digits.slice(0, length);
    for (const [word, pos] of db.byCode[code] ?? []) {
      candidates.push([word, code, pos]);
    }
  }
  return candidates;
}

export function groupCandidates(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const digitCount = candidate[1].length;
    if (!groups.has(digitCount)) groups.set(digitCount, []);
    groups.get(digitCount).push(candidate);
  }
  return [...groups]
    .sort(([left], [right]) => right - left)
    .map(([digitCount, words]) => ({ digitCount, words }));
}

export function partOfSpeechLabel(pos = '') {
  return [['n', 'noun'], ['v', 'verb'], ['a', 'adjective']]
    .filter(([flag]) => pos.includes(flag))
    .map(([, label]) => label)
    .join(', ');
}

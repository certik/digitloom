export const PAO_ROLES = Object.freeze(['person', 'action', 'object']);

// `bytes` caps an imported or exported file's UTF-8 size; the others count code points after trimming.
export const PROFILE_LIMITS = Object.freeze({
  bytes: 262144,
  name: 80,
  peg: 80,
  association: 200,
  metadata: 1000
});

const FORMAT = 'digitloom-pao';
const VERSION = 1;
const CODES = Array.from({ length: 100 }, (_, index) => String(index).padStart(2, '0'));
const CODE_PATTERN = /^[0-9]{2}$/;
const DIGITS_PATTERN = /^[0-9]*$/;
const CELLS = ['peg', ...PAO_ROLES];
const METADATA = ['name', 'license', 'attribution'];
const PROFILE_FIELDS = new Set(['format', 'version', ...METADATA, 'entries']);
const ENTRY_FIELDS = new Set(['code', ...CELLS]);
const ARTICLES = { person: 'a person', action: 'an action', object: 'an object' };
// Tabs, line breaks, and other controls cannot be shown or edited in a single-line cell.
const CONTROL_TEXT = /[\p{Cc}\p{Zl}\p{Zp}]/u;
// In Unicode mode this matches only unpaired surrogates, which are not valid text.
const BROKEN_TEXT = /\p{Cs}/u;

class PaoProfileError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'PaoProfileError';
  }
}

function fail(message, options) {
  throw new PaoProfileError(message, options);
}

function own(object, key) {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function quote(text) {
  const characters = Array.from(text);
  return JSON.stringify(characters.length > 40 ? `${characters.slice(0, 39).join('')}…` : text);
}

function describe(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'string') return `the text ${quote(value)}`;
  if (typeof value === 'number') return `the number ${value}`;
  return `${/^[aeiou]/.test(typeof value) ? 'an' : 'a'} ${typeof value}`;
}

function utf8Length(text) {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0);
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function readText(raw, label, limit, required = false) {
  if (raw === undefined) {
    if (required) fail(`${label} is required.`);
    return '';
  }
  if (typeof raw !== 'string') fail(`${label} must be text, not ${describe(raw)}.`);
  const text = raw.trim();
  if (BROKEN_TEXT.test(text)) fail(`${label} contains invalid Unicode text.`);
  if (CONTROL_TEXT.test(text)) {
    fail(`${label} must be a single line without tabs, line breaks, or other control characters.`);
  }
  if (required && !text) fail(`${label} cannot be blank.`);
  const length = Array.from(text).length;
  if (length > limit) fail(`${label} has ${length} characters; the limit is ${limit}.`);
  return text;
}

function readCode(code, position) {
  if (typeof code === 'string' && CODE_PATTERN.test(code)) return code;
  const entry = `Entry ${position}`;
  if (code === undefined) fail(`${entry} needs a "code" such as "07".`);
  if (typeof code === 'number') {
    fail(`${entry} uses the number ${code} as its code; write codes as two-digit text such as "07" so leading zeros survive.`);
  }
  fail(`${entry} has an invalid code (${describe(code)}); codes are two digits from "00" to "99" written as text.`);
}

function rejectUnknownFields(object, allowed, label) {
  const unknown = Object.keys(object).filter((key) => !allowed.has(key));
  if (unknown.length) {
    const [noun, pronoun] = unknown.length === 1 ? ['field', 'it'] : ['fields', 'them'];
    fail(`${label} has unsupported ${noun} ${unknown.map(quote).join(', ')}; ` +
      `remove ${pronoun} so no data is silently dropped.`);
  }
}

function blankEntry(code) {
  return { code, peg: '', person: '', action: '', object: '' };
}

export function createBlankProfile(name = 'My PAO table') {
  return {
    format: FORMAT,
    version: VERSION,
    name: readText(name, 'The table name', PROFILE_LIMITS.name, true),
    license: '',
    attribution: '',
    entries: CODES.map((code) => blankEntry(code))
  };
}

export function normalizeProfile(value) {
  if (!isRecord(value)) fail(`A PAO table must be a JSON object, not ${describe(value)}.`);
  const format = own(value, 'format');
  if (format !== FORMAT) {
    fail(format === undefined
      ? 'This is not a DigitLoom PAO table: its "format" field is missing.'
      : `This is not a DigitLoom PAO table: its "format" is ${describe(format)}, not "${FORMAT}".`);
  }
  const version = own(value, 'version');
  if (version !== VERSION) {
    fail(version === undefined
      ? `This PAO table has no "version"; DigitLoom reads version ${VERSION}.`
      : `Unsupported PAO table version (${describe(version)}); DigitLoom reads version ${VERSION}.`);
  }
  rejectUnknownFields(value, PROFILE_FIELDS, 'The PAO table');
  const name = readText(own(value, 'name'), 'The table name', PROFILE_LIMITS.name, true);
  const license = readText(own(value, 'license'), 'The license', PROFILE_LIMITS.metadata);
  const attribution = readText(own(value, 'attribution'), 'The attribution', PROFILE_LIMITS.metadata);
  const entries = own(value, 'entries');
  if (!Array.isArray(entries)) {
    fail(entries === undefined
      ? 'The PAO table needs an "entries" list.'
      : `The PAO table's "entries" must be a list, not ${describe(entries)}.`);
  }
  if (entries.length > CODES.length) {
    fail(`A PAO table has at most ${CODES.length} rows, one per code from 00 to 99; this one has ${entries.length}.`);
  }
  const rows = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!isRecord(entry)) fail(`Entry ${index + 1} must be an object, not ${describe(entry)}.`);
    const code = readCode(own(entry, 'code'), index + 1);
    if (rows.has(code)) fail(`Code ${code} appears in more than one row.`);
    rejectUnknownFields(entry, ENTRY_FIELDS, `The row for code ${code}`);
    const row = { code };
    for (const cell of CELLS) {
      const limit = cell === 'peg' ? PROFILE_LIMITS.peg : PROFILE_LIMITS.association;
      row[cell] = readText(own(entry, cell), `The ${cell} for code ${code}`, limit);
    }
    rows.set(code, row);
  }
  return {
    format: FORMAT,
    version: VERSION,
    name,
    license,
    attribution,
    entries: CODES.map((code) => rows.get(code) ?? blankEntry(code))
  };
}

// JSON.parse keeps only the last copy of a repeated key, so find repeats in already-valid JSON.
function findRepeatedKey(source) {
  const containers = [];
  let expectingKey = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      let end = index + 1;
      while (source[end] !== '"') end += source[end] === '\\' ? 2 : 1;
      if (expectingKey) {
        const key = JSON.parse(source.slice(index, end + 1));
        const keys = containers.at(-1);
        if (keys.has(key)) return key;
        keys.add(key);
        expectingKey = false;
      }
      index = end;
    } else if (character === '{') {
      containers.push(new Set());
      expectingKey = true;
    } else if (character === '[') {
      containers.push(null);
      expectingKey = false;
    } else if (character === '}' || character === ']') {
      containers.pop();
      expectingKey = false;
    } else if (character === ',') {
      expectingKey = containers.at(-1) instanceof Set;
    }
  }
  return undefined;
}

export function parseProfile(text) {
  if (typeof text !== 'string') throw new TypeError('PAO table text must be a string.');
  if (text.length > PROFILE_LIMITS.bytes || utf8Length(text) > PROFILE_LIMITS.bytes) {
    fail(`This file is larger than ${PROFILE_LIMITS.bytes / 1024} KiB (${PROFILE_LIMITS.bytes} bytes), the limit for a PAO table.`);
  }
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
  if (!source.trim()) fail('This file is empty.');
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    fail(`This file is not valid JSON: ${error.message}`, { cause: error });
  }
  const repeated = findRepeatedKey(source);
  if (repeated !== undefined) {
    fail(`The field ${quote(repeated)} appears twice in the same object; ` +
      'remove one copy so no data is silently dropped.');
  }
  return normalizeProfile(value);
}

function jsonFields(object, keys) {
  return keys.map((key) => `${JSON.stringify(key)}: ${JSON.stringify(object[key])}`);
}

export function serializeProfile(profile) {
  const canonical = normalizeProfile(profile);
  const last = canonical.entries.length - 1;
  const text = [
    '{',
    ...jsonFields(canonical, ['format', 'version', ...METADATA]).map((field) => `  ${field},`),
    '  "entries": [',
    ...canonical.entries.map((entry, index) =>
      `    { ${jsonFields(entry, ['code', ...CELLS]).join(', ')} }${index < last ? ',' : ''}`),
    '  ]',
    '}',
    ''
  ].join('\n');
  const bytes = utf8Length(text);
  if (bytes > PROFILE_LIMITS.bytes) {
    fail(`This PAO table needs ${bytes} bytes as JSON, more than the ${PROFILE_LIMITS.bytes}-byte ` +
      'import limit; shorten some cells before exporting.');
  }
  return text;
}

function indexRows(profile) {
  const entries = profile !== null && typeof profile === 'object' ? profile.entries : undefined;
  if (!Array.isArray(entries)) throw new TypeError('Expected a PAO table with an entries list.');
  const rows = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const code = entry !== null && typeof entry === 'object' ? entry.code : undefined;
    if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
      throw new TypeError(`PAO entry ${index + 1} needs a two-digit text code such as "07".`);
    }
    if (rows.has(code)) throw new TypeError(`PAO code ${code} appears in more than one row.`);
    const row = {};
    for (const cell of CELLS) {
      const value = entry[cell];
      if (value !== undefined && typeof value !== 'string') {
        throw new TypeError(`The ${cell} for PAO code ${code} must be text, not ${describe(value)}.`);
      }
      row[cell] = value === undefined ? '' : value.trim();
    }
    rows.set(code, row);
  }
  return rows;
}

function comparisonKey(value) {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase().normalize('NFC');
}

function duplicateGroups(rows) {
  const groups = [];
  for (const role of PAO_ROLES) {
    const byKey = new Map();
    for (const code of CODES) {
      const value = rows.get(code)?.[role];
      if (!value) continue;
      const key = comparisonKey(value);
      if (byKey.has(key)) byKey.get(key).codes.push(code);
      else byKey.set(key, { role, value, codes: [code] });
    }
    for (const group of byKey.values()) {
      if (group.codes.length > 1) groups.push(group);
    }
  }
  return groups;
}

export function findDuplicates(profile) {
  return duplicateGroups(indexRows(profile));
}

function listCodes(codes) {
  return codes.length === 2 ? codes.join(' and ') : `${codes.slice(0, -1).join(', ')}, and ${codes.at(-1)}`;
}

export function encodePao(profile, digits) {
  if (typeof digits !== 'string' || !DIGITS_PATTERN.test(digits)) {
    throw new TypeError('PAO input must be a string containing only the digits 0-9.');
  }
  const rows = indexRows(profile);
  const conflicts = new Map();
  for (const { role, codes } of duplicateGroups(rows)) {
    for (const code of codes) conflicts.set(`${role} ${code}`, codes);
  }
  const pairCount = Math.floor(digits.length / 2);
  const scenes = [];
  const issues = [];
  const reported = new Set();
  let resolvedPairCount = 0;
  const report = (kind, role, code, message) => {
    const key = `${kind} ${role} ${code}`;
    if (reported.has(key)) return;
    reported.add(key);
    issues.push({ kind, role, code, message });
  };
  for (let pair = 0; pair < pairCount; pair += 1) {
    const code = digits.slice(pair * 2, pair * 2 + 2);
    const role = PAO_ROLES[pair % PAO_ROLES.length];
    const row = rows.get(code);
    const value = row?.[role] ?? '';
    const shared = value ? conflicts.get(`${role} ${code}`) : undefined;
    if (pair % PAO_ROLES.length === 0) scenes.push({ number: scenes.length + 1, slots: [] });
    scenes.at(-1).slots.push({ role, code, value, peg: row?.peg ?? '', duplicateCodes: shared ? [...shared] : [] });
    if (!value) {
      report('missing', role, code, `Add ${ARTICLES[role]} for ${code}.`);
    } else if (shared) {
      report('duplicate', role, code,
        `The ${role} ${quote(value)} is shared by ${listCodes(shared)}, so ${code} is ambiguous.`);
    } else {
      resolvedPairCount += 1;
    }
  }
  return {
    scenes,
    trailingDigit: digits.length % 2 ? digits.at(-1) : '',
    pairCount,
    resolvedPairCount,
    issues
  };
}

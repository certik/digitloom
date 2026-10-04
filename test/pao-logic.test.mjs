import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PAO_CODES, PAO_ROLES, PAO_VERSION, PROFILE_LIMITS, createBlankProfile, encodePao, findDuplicates,
  normalizeProfile, parseProfile, serializeProfile
} from '../web/pao-logic.js';

const starterText = await readFile(new URL('../web/data/pao-starter.json', import.meta.url), 'utf8');
const db = JSON.parse(await readFile(new URL('../web/data/db.json', import.meta.url), 'utf8'));
const starter = parseProfile(starterText);
const CODES = [...PAO_CODES];
const PAIR_CODES = CODES.filter((code) => code.length === 2);
const CELLS = ['peg', ...PAO_ROLES];
const invalid = (message) => ({ name: 'PaoProfileError', message });
const table = (entries = [], fields = {}) => ({ format: 'digitloom-pao', version: PAO_VERSION, name: 'Test table', entries, ...fields });
const entry = (profile, code) => profile.entries.find((row) => row.code === code);
const row = (code) => entry(starter, code);
const slotValues = (result) => result.scenes.map(({ slots }) => slots.map(({ value }) => value));
const comparable = (value) => value.normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase();

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

test('shares the fixed role order and profile limits', () => {
  assert.deepEqual(PAO_ROLES, ['person', 'action', 'object']);
  assert.ok(Object.isFrozen(PAO_ROLES));
  assert.throws(() => PAO_ROLES.push('scene'), TypeError);
  assert.equal(PAO_VERSION, 2);
  assert.equal(PAO_CODES.length, 110);
  assert.ok(Object.isFrozen(PAO_CODES));
  assert.deepEqual(PAO_CODES, [
    ...Array.from({ length: 10 }, (_, index) => String(index)),
    ...Array.from({ length: 100 }, (_, index) => String(index).padStart(2, '0'))
  ]);
  assert.deepEqual(PROFILE_LIMITS, { bytes: 262144, name: 80, peg: 80, association: 200, metadata: 1000 });
  assert.ok(Object.isFrozen(PROFILE_LIMITS));
});

test('blank profiles are fresh 110-row tables without starter provenance', () => {
  const blank = createBlankProfile();
  assert.deepEqual(blank, {
    format: 'digitloom-pao', version: 2, name: 'My PAO table', license: '', attribution: '',
    entries: CODES.map((code) => ({ code, peg: '', person: '', action: '', object: '' }))
  });
  assert.deepEqual(Object.keys(blank.entries[0]), ['code', ...CELLS]);
  blank.name = 'Changed';
  entry(blank, '32').person = 'astronaut';
  assert.equal(createBlankProfile().name, 'My PAO table');
  assert.equal(entry(createBlankProfile(), '32').person, '');
  const normalized = normalizeProfile(blank);
  assert.notEqual(normalized, blank);
  assert.notEqual(entry(normalized, '32'), entry(blank, '32'));
  assert.equal(createBlankProfile('  Phone numbers  ').name, 'Phone numbers');
  assert.equal(createBlankProfile('\u{1F9E0}'.repeat(80)).name, '\u{1F9E0}'.repeat(80));
  for (const name of ['', '   ', 'x'.repeat(81), 'two\nlines', 42, null]) {
    assert.throws(() => createBlankProfile(name), { name: 'PaoProfileError' }, String(name));
  }
});

test('starter fills all 110 codes with complete rows and provenance', () => {
  const file = JSON.parse(starterText);
  assert.deepEqual(Object.keys(file), ['format', 'version', 'name', 'license', 'attribution', 'entries']);
  assert.equal(file.name, 'DigitLoom starter PAO');
  assert.equal(file.license, 'CC-BY-SA-4.0');
  assert.match(file.attribution, /DigitLoom contributors/);
  assert.match(file.attribution, /DigitLoom CMUdict-derived dictionary/);
  assert.match(file.attribution, /https:\/\/certik\.github\.io\/digitloom\/sources\.html/);
  assert.deepEqual(file.entries.map(({ code }) => code), CODES);
  for (const entry of file.entries) {
    assert.deepEqual(Object.keys(entry), ['code', ...CELLS], entry.code);
    for (const cell of CELLS) {
      assert.ok(typeof entry[cell] === 'string' && entry[cell] && entry[cell] === entry[cell].trim(),
        `${entry.code} ${cell}`);
    }
  }
  assert.deepEqual(starter, file);
  assert.equal(serializeProfile(starter), starterText, 'the starter is stored in canonical export form');
  assert.ok(Buffer.byteLength(starterText) < PROFILE_LIMITS.bytes / 10);
});

test('every starter peg is an approved dictionary word for its own code', () => {
  let checked = 0;
  for (const { code, peg } of starter.entries) {
    assert.ok(db.byCode[code]?.some(([word]) => word === peg), `${code}: ${peg}`);
    checked += 1;
  }
  assert.equal(checked, 110);
});

test('starter columns are unambiguous short associations', () => {
  assert.deepEqual(findDuplicates(starter), []);
  for (const role of PAO_ROLES) {
    assert.equal(new Set(starter.entries.map((entry) => comparable(entry[role]))).size, 110, role);
  }
  assert.equal(new Set(starter.entries.map(({ peg }) => peg)).size, 110);
  for (const { code, action } of starter.entries) {
    assert.ok(action.split(' ').length <= 3, `${code}: ${action}`);
  }
});

test('starter keeps the documented anchors and requested associations', () => {
  assert.deepEqual(row('32'), { code: '32', peg: 'moon', person: 'astronaut', action: 'bounces', object: 'moon rock' });
  assert.deepEqual(row('77'), { code: '77', peg: 'cake', person: 'baker', action: 'frosts', object: 'cake' });
  assert.deepEqual(row('53'), { code: '53', peg: 'lime', person: 'bartender', action: 'squeezes', object: 'lime' });
  assert.deepEqual([row('88').peg, row('88').person], ['fife', 'musician']);
  assert.deepEqual([row('66').peg, row('66').object], ['judge', 'defendant']);
  assert.deepEqual([row('08').peg, row('08').person], ['safe', 'Wile E. Coyote']);
});

test('the supplied single-digit PAOs are preserved and work in every role', () => {
  const supplied = [
    ['0', 'saw', 'lumberjack', 'saws', 'log'],
    ['1', 'tea', 'Miss Marple', 'pours', 'tea'],
    ['2', 'noah', 'Noah', 'counts', 'animals'],
    ['3', 'me', 'I', 'tie', 'a bow-tie (in a mirror)'],
    ['4', 'ray', 'Luke Skywalks', 'flails', 'his light saber'],
    ['5', 'law', 'Cop', 'stops', 'a Toyota'],
    ['6', 'jaw', 'Lurch', 'chews', 'rose stems'],
    ['7', 'key', 'Alladin', 'turns', 'a key (in a rusty lock to the treasure-room door)'],
    ['8', 'fee', 'My lawyer', 'hoards', 'his fee'],
    ['9', 'pea', 'A Pea', 'bruises', 'the Princess (through nine matresses)']
  ];
  for (const [code, peg, person, action, object] of supplied) {
    const expected = { code, peg, person, action, object };
    assert.deepEqual(row(code), expected);
    for (const [index, prefix] of ['', '32', '3277'].entries()) {
      const result = encodePao(starter, prefix + code);
      const slot = result.scenes.at(-1).slots.at(-1);
      assert.equal(slot.code, code);
      assert.equal(slot.role, PAO_ROLES[index]);
      assert.equal(slot.value, expected[slot.role]);
      assert.equal(result.encodedDigits, prefix.length + 1);
      assert.deepEqual(result.issues, []);
    }
  }
  assert.equal(row('14').person, 'woodpecker');
  assert.equal(row('37').action, 'brews');
  assert.equal(row('99').action, 'gnaws');
});

test('version-1 imports preserve all pair associations and add blank single-digit rows', () => {
  const legacy = {
    ...structuredClone(starter), version: 1, name: 'My original table',
    license: 'CC0-1.0', attribution: 'Original attribution',
    entries: structuredClone(starter.entries.filter(({ code }) => code.length === 2))
  };
  entry(legacy, '14').person = 'lumberjack';
  entry(legacy, '37').action = 'pours';
  entry(legacy, '99').action = 'chews';
  const before = structuredClone(legacy);
  const imported = parseProfile(JSON.stringify(legacy));
  assert.deepEqual(legacy, before);
  assert.equal(imported.version, 2);
  assert.equal(imported.entries.length, 110);
  assert.deepEqual(imported.entries.filter(({ code }) => code.length === 2), legacy.entries);
  assert.deepEqual(imported.entries.slice(0, 10), Array.from({ length: 10 }, (_, index) => ({
    code: String(index), peg: '', person: '', action: '', object: ''
  })));
  assert.deepEqual([imported.name, imported.license, imported.attribution],
    [legacy.name, legacy.license, legacy.attribution]);
  assert.deepEqual(slotValues(encodePao(imported, '143799')), [['lumberjack', 'pours', 'slipper']]);
  const odd = encodePao(imported, '14370');
  assert.equal(odd.encodedDigits, 4);
  assert.deepEqual(odd.issues, [{ kind: 'missing', role: 'object', code: '0', message: 'Add an object for 0.' }]);
  assert.deepEqual(parseProfile(serializeProfile(imported)), imported);
  assert.throws(() => normalizeProfile(table([{ code: '0', person: 'lumberjack' }], { version: 1 })),
    invalid(/Single-digit code "0" requires PAO table version 2/));
});

test('encodes the PAO demo 327753 as astronaut frosts lime', () => {
  assert.deepEqual(encodePao(starter, '327753'), {
    scenes: [{
      number: 1,
      slots: [
        { role: 'person', code: '32', value: 'astronaut', peg: 'moon', duplicateCodes: [] },
        { role: 'action', code: '77', value: 'frosts', peg: 'cake', duplicateCodes: [] },
        { role: 'object', code: '53', value: 'lime', peg: 'lime', duplicateCodes: [] }
      ]
    }],
    codeCount: 3,
    resolvedCodeCount: 3,
    encodedDigits: 6,
    issues: []
  });
});

test('the moon-cake number 3277 becomes a partial person-action scene', () => {
  const result = encodePao(starter, '3277');
  assert.deepEqual(result, {
    scenes: [{
      number: 1,
      slots: [
        { role: 'person', code: '32', value: 'astronaut', peg: 'moon', duplicateCodes: [] },
        { role: 'action', code: '77', value: 'frosts', peg: 'cake', duplicateCodes: [] }
      ]
    }],
    codeCount: 2,
    resolvedCodeCount: 2,
    encodedDigits: 4,
    issues: []
  });
  assert.equal(result.scenes[0].slots.map(({ peg }) => peg).join(' '), 'moon cake');
});

test('pairs cycle person, action, object and every three pairs form a numbered scene', () => {
  const result = encodePao(starter, '0001020304050607');
  assert.equal(result.codeCount, 8);
  assert.equal(result.encodedDigits, 16);
  assert.deepEqual(result.scenes.map(({ number }) => number), [1, 2, 3]);
  assert.deepEqual(result.scenes.map(({ slots }) => slots.map(({ role }) => role)), [
    ['person', 'action', 'object'], ['person', 'action', 'object'], ['person', 'action']
  ]);
  assert.deepEqual(result.scenes.flatMap(({ slots }) => slots.map(({ code }) => code)),
    ['00', '01', '02', '03', '04', '05', '06', '07']);
  assert.deepEqual(slotValues(result), [
    ['Zeus', 'irons', 'gift'], ['sumo wrestler', 'unclogs', 'beach ball'], ['sushi chef', 'hauls']
  ]);
  assert.deepEqual(slotValues(encodePao(starter, '32775308')), [['astronaut', 'frosts', 'lime'], ['Wile E. Coyote']]);
  assert.deepEqual(slotValues(encodePao(starter, '323232')), [['astronaut', 'bounces', 'moon rock']]);
});

test('single digits and zero-prefixed pairs stay distinct', () => {
  assert.deepEqual(encodePao(starter, '000800').scenes[0].slots.map(({ code, value, peg }) => [code, value, peg]), [
    ['00', 'Zeus', 'zeus'], ['08', 'drops', 'safe'], ['00', 'lightning bolt', 'zeus']
  ]);
  const zeros = encodePao(starter, '0000000');
  assert.equal(zeros.codeCount, 4);
  assert.equal(zeros.encodedDigits, 7);
  assert.deepEqual(slotValues(zeros), [['Zeus', 'hurls', 'lightning bolt'], ['lumberjack']]);
  assert.deepEqual(slotValues(encodePao(starter, '0')), [['lumberjack']]);
  assert.deepEqual(slotValues(encodePao(starter, '00')), [['Zeus']]);
  assert.deepEqual(slotValues(encodePao(starter, '004')), [['Zeus', 'flails']]);
  assert.deepEqual(slotValues(encodePao(starter, '0004')), [['Zeus', 'unclogs']]);
  assert.deepEqual(encodePao(starter, '08').scenes[0].slots,
    [{ role: 'person', code: '08', value: 'Wile E. Coyote', peg: 'safe', duplicateCodes: [] }]);
});

test('empty and odd-length input never invents pairs or padding', () => {
  const empty = { scenes: [], codeCount: 0, resolvedCodeCount: 0, encodedDigits: 0, issues: [] };
  assert.deepEqual(encodePao(starter, ''), empty);
  assert.deepEqual(encodePao(createBlankProfile(), ''), empty);
  for (const digit of '0123456789') {
    const result = encodePao(starter, digit);
    assert.equal(result.codeCount, 1);
    assert.equal(result.encodedDigits, 1);
    assert.equal(result.scenes[0].slots[0].code, digit);
    const blank = encodePao(createBlankProfile(), digit);
    assert.equal(blank.encodedDigits, 0);
    assert.equal(blank.issues[0].code, digit);
    assert.equal(blank.issues[0].role, 'person');
  }
  const odd = encodePao(starter, '32775');
  assert.equal(odd.codeCount, 3);
  assert.equal(odd.encodedDigits, 5);
  assert.deepEqual(odd.scenes.flatMap(({ slots }) => slots.map(({ code }) => code)), ['32', '77', '5']);
  assert.deepEqual(slotValues(odd), [['astronaut', 'frosts', 'a Toyota']]);
  const seven = encodePao(starter, '3277530');
  assert.equal(seven.encodedDigits, 7);
  assert.deepEqual(slotValues(seven), [['astronaut', 'frosts', 'lime'], ['lumberjack']]);
});

test('long numbers encode every pair in order and keep a partial final scene', () => {
  const digits = `${'0123456789'.repeat(1000)}4`;
  const result = encodePao(starter, digits);
  assert.equal(result.codeCount, 5001);
  assert.equal(result.resolvedCodeCount, 5001);
  assert.equal(result.encodedDigits, digits.length);
  assert.deepEqual(result.issues, []);
  assert.equal(result.scenes.length, 1667);
  assert.deepEqual(result.scenes.map(({ number }) => number), Array.from({ length: 1667 }, (_, index) => index + 1));
  assert.equal(result.scenes.at(-1).slots.length, 3);
  const slots = result.scenes.flatMap((scene) => scene.slots);
  assert.equal(slots.map(({ code }) => code).join(''), digits);
  slots.forEach((slot, index) => {
    const role = PAO_ROLES[index % 3];
    assert.equal(slot.role, role);
    assert.equal(slot.value, row(slot.code)[role]);
    assert.equal(slot.peg, row(slot.code).peg);
  });
});

test('repeated problems in long input are reported once per kind, role, and code', () => {
  const blank = createBlankProfile();
  const zeros = encodePao(blank, '00'.repeat(30000));
  assert.equal(zeros.codeCount, 30000);
  assert.equal(zeros.resolvedCodeCount, 0);
  assert.equal(zeros.encodedDigits, 0);
  assert.deepEqual(zeros.issues, [
    { kind: 'missing', role: 'person', code: '00', message: 'Add a person for 00.' },
    { kind: 'missing', role: 'action', code: '00', message: 'Add an action for 00.' },
    { kind: 'missing', role: 'object', code: '00', message: 'Add an object for 00.' }
  ]);
  const everyCodeInEveryRole = encodePao(blank, PAIR_CODES.join('').repeat(30));
  assert.equal(everyCodeInEveryRole.codeCount, 3000);
  assert.equal(everyCodeInEveryRole.issues.length, 300);
  assert.equal(new Set(everyCodeInEveryRole.issues.map(({ role, code }) => `${role} ${code}`)).size, 300);
  const withSingle = encodePao(blank, `${PAIR_CODES.join('').repeat(30)}0`);
  assert.equal(withSingle.codeCount, 3001);
  assert.equal(withSingle.issues.length, 301);
});

test('missing cells become visible blank slots without hiding other pairs', () => {
  const profile = normalizeProfile(table([
    { code: '32', peg: 'moon', person: 'astronaut' },
    { code: '77', peg: 'cake' },
    { code: '53', object: 'lime' }
  ]));
  assert.deepEqual(encodePao(profile, '32775399'), {
    scenes: [
      {
        number: 1,
        slots: [
          { role: 'person', code: '32', value: 'astronaut', peg: 'moon', duplicateCodes: [] },
          { role: 'action', code: '77', value: '', peg: 'cake', duplicateCodes: [] },
          { role: 'object', code: '53', value: 'lime', peg: '', duplicateCodes: [] }
        ]
      },
      { number: 2, slots: [{ role: 'person', code: '99', value: '', peg: '', duplicateCodes: [] }] }
    ],
    codeCount: 4,
    resolvedCodeCount: 2,
    encodedDigits: 4,
    issues: [
      { kind: 'missing', role: 'action', code: '77', message: 'Add an action for 77.' },
      { kind: 'missing', role: 'person', code: '99', message: 'Add a person for 99.' }
    ]
  });
});

test('duplicates compare within one role using NFC, case, and collapsed whitespace', () => {
  const profile = normalizeProfile(table([
    { code: '10', person: 'Astronaut', action: 'sits   on', object: 'astronaut' },
    { code: '11', person: 'Caf\u00e9 owner' },
    { code: '12', person: 'cafe\u0301 OWNER' },
    { code: '20', person: 'astronaut', action: 'Sits on' },
    { code: '30', person: '  ASTRONAUT  ', action: 'sits\u00a0on' },
    { code: '40', person: 'astro naut', action: 'sits on it' },
    { code: '50', object: 'Lime' },
    { code: '51', object: 'lime' },
    { code: '52', object: 'limes' }
  ]));
  const expected = [
    { role: 'person', value: 'Astronaut', codes: ['10', '20', '30'] },
    { role: 'person', value: 'Caf\u00e9 owner', codes: ['11', '12'] },
    { role: 'action', value: 'sits   on', codes: ['10', '20', '30'] },
    { role: 'object', value: 'Lime', codes: ['50', '51'] }
  ];
  assert.deepEqual(findDuplicates(profile), expected);
  assert.deepEqual(findDuplicates({ entries: [...profile.entries].reverse() }), expected);
  const reimported = parseProfile(serializeProfile(profile));
  assert.deepEqual(reimported, profile);
  assert.deepEqual(findDuplicates(reimported), expected);
  assert.equal(entry(reimported, '12').person, 'cafe\u0301 OWNER');
});

test('ambiguous pairs list every conflicting code and do not count as resolved', () => {
  const profile = structuredClone(starter);
  entry(profile, '45').person = 'Astronaut';
  entry(profile, '77').action = '';
  const result = encodePao(profile, '3277533245');
  assert.equal(result.codeCount, 5);
  assert.equal(result.resolvedCodeCount, 2);
  assert.equal(result.encodedDigits, 4);
  assert.deepEqual(result.scenes[0].slots[0],
    { role: 'person', code: '32', value: 'astronaut', peg: 'moon', duplicateCodes: ['32', '45'] });
  assert.deepEqual(result.scenes[1].slots[0].duplicateCodes, ['32', '45']);
  assert.deepEqual(result.scenes[1].slots[1],
    { role: 'action', code: '45', value: 'reels in', peg: 'reel', duplicateCodes: [] });
  assert.deepEqual(result.issues.map(({ kind, role, code }) => [kind, role, code]),
    [['duplicate', 'person', '32'], ['missing', 'action', '77']]);
  assert.match(result.issues[0].message, /person "astronaut" is shared by 32 and 45, so 32 is ambiguous/);
  const other = encodePao(profile, '45');
  assert.deepEqual(other.scenes[0].slots[0],
    { role: 'person', code: '45', value: 'Astronaut', peg: 'reel', duplicateCodes: ['32', '45'] });
  assert.equal(other.resolvedCodeCount, 0);
});

test('resolved progress counts occurrences and the actual width of each code', () => {
  assert.equal(encodePao(starter, '32'.repeat(7)).resolvedCodeCount, 7);
  const result = encodePao(normalizeProfile(table([{ code: '32', person: 'astronaut' }])), '32'.repeat(7));
  assert.equal(result.codeCount, 7);
  assert.equal(result.resolvedCodeCount, 3);
  assert.equal(result.encodedDigits, 6);
  assert.deepEqual(result.issues.map(({ kind, role }) => `${kind} ${role}`), ['missing action', 'missing object']);
  const mixed = normalizeProfile(table([{ code: '32', person: 'astronaut' }, { code: '0', action: 'saws' }]));
  assert.equal(encodePao(mixed, '320').encodedDigits, 3);
  assert.equal(encodePao(mixed, '770').encodedDigits, 1);
});

test('duplicate detection includes single-digit and two-digit codes without conflating them', () => {
  const profile = normalizeProfile(table([
    { code: '0', person: 'lumberjack', object: 'log' },
    { code: '14', person: 'LUMBERJACK' },
    { code: '00', object: 'log' }
  ]));
  assert.deepEqual(findDuplicates(profile), [
    { role: 'person', value: 'lumberjack', codes: ['0', '14'] },
    { role: 'object', value: 'log', codes: ['0', '00'] }
  ]);
  assert.deepEqual(encodePao(profile, '0').scenes[0].slots[0].duplicateCodes, ['0', '14']);
  assert.equal(encodePao(profile, '0').encodedDigits, 0);
  assert.equal(encodePao(profile, '14').encodedDigits, 0);
});

test('encoding reads in-progress edits: trimmed cells, blank text as missing', () => {
  const draft = { entries: [{ code: '32', peg: ' moon ', person: '  astronaut  ', action: '   ' }] };
  const result = encodePao(draft, '3232');
  assert.deepEqual(result.scenes[0].slots, [
    { role: 'person', code: '32', value: 'astronaut', peg: 'moon', duplicateCodes: [] },
    { role: 'action', code: '32', value: '', peg: 'moon', duplicateCodes: [] }
  ]);
  assert.equal(result.resolvedCodeCount, 1);
  assert.equal(result.encodedDigits, 2);
  assert.deepEqual(findDuplicates({ entries: [{ code: '01', object: ' Lime ' }, { code: '02', object: 'lime' }] }),
    [{ role: 'object', value: 'Lime', codes: ['01', '02'] }]);
});

test('encoding rejects non-digit input and malformed tables with clear errors', () => {
  for (const digits of ['32 77', '3277\n', '-32', '3.2', '1e3', '\uff13\uff12', '\u0663\u0662', 3277, null, undefined, ['3', '2']]) {
    assert.throws(() => encodePao(starter, digits), { name: 'TypeError', message: /only the digits 0-9/ }, String(digits));
  }
  for (const [profile, message] of [
    [null, /entries list/], [undefined, /entries list/], [{}, /entries list/], [{ entries: {} }, /entries list/],
    [{ entries: [null] }, /entry 1 needs a one- or two-digit text code/],
    [{ entries: [{ code: 32 }] }, /entry 1 needs a one- or two-digit text code/],
    [{ entries: [{ code: '032' }] }, /entry 1 needs a one- or two-digit text code/],
    [{ entries: [{ code: '32' }, { code: '32' }] }, /code 32 appears in more than one row/],
    [{ entries: [{ code: '32', person: 5 }] }, /person for PAO code 32 must be text/],
    [{ entries: [{ code: '32', peg: null }] }, /peg for PAO code 32 must be text/]
  ]) {
    assert.throws(() => encodePao(profile, '32'), { name: 'TypeError', message });
    assert.throws(() => findDuplicates(profile), { name: 'TypeError', message });
  }
});

test('normalization fills omitted rows and cells, trims text, and preserves Unicode exactly', () => {
  const crew = '\u{1F469}\u200D\u{1F680}';
  const input = table([
    { code: '99', person: `  ${crew} astronaut  `, object: 'cafe\u0301' },
    { code: '05', peg: 'seal', action: 'balances' },
    { code: '00' },
    { code: '42', person: '\u0645\u0631\u062d\u0628\u0627', action: '\u00dcn\u00efc\u00f6d\u00e9  spacing', object: '\u5b87\u822a\u5458' }
  ], { name: '  Unicode   test  ', license: ' CC0-1.0 ', attribution: '  Ada Lovelace  ' });
  const before = structuredClone(input);
  const result = normalizeProfile(input);
  assert.deepEqual(input, before);
  assert.notEqual(result, input);
  assert.equal(result.name, 'Unicode   test');
  assert.equal(result.license, 'CC0-1.0');
  assert.equal(result.attribution, 'Ada Lovelace');
  assert.deepEqual(result.entries.map(({ code }) => code), CODES);
  assert.deepEqual(entry(result, '00'), { code: '00', peg: '', person: '', action: '', object: '' });
  assert.deepEqual(entry(result, '05'), { code: '05', peg: 'seal', person: '', action: 'balances', object: '' });
  assert.deepEqual(entry(result, '42'), {
    code: '42', peg: '', person: '\u0645\u0631\u062d\u0628\u0627',
    action: '\u00dcn\u00efc\u00f6d\u00e9  spacing', object: '\u5b87\u822a\u5458'
  });
  assert.deepEqual(entry(result, '99'), { code: '99', peg: '', person: `${crew} astronaut`, action: '', object: 'cafe\u0301' });
  assert.deepEqual(normalizeProfile(table()), createBlankProfile('Test table'));
});

test('rejects values that are not supported DigitLoom PAO tables', () => {
  const inherited = Object.create({ format: 'digitloom-pao', version: 1, name: 'x', entries: [] });
  for (const value of [null, undefined, [], 'table', 42, true, new Date(), new Map(), inherited]) {
    assert.throws(() => normalizeProfile(value), invalid(/must be a JSON object/), String(value));
  }
  assert.throws(() => normalizeProfile(db), invalid(/not a DigitLoom PAO table: its "format" field is missing/));
  for (const format of ['digitloom-columns', 'DigitLoom-PAO', '', 1, null]) {
    assert.throws(() => normalizeProfile(table([], { format })), invalid(/not a DigitLoom PAO table/), String(format));
  }
  assert.throws(() => normalizeProfile({ format: 'digitloom-pao', name: 'x', entries: [] }), invalid(/no "version"/));
  for (const version of [0, 3, 1.5, '1', '2', null, [1]]) {
    assert.throws(() => normalizeProfile(table([], { version })), invalid(/Unsupported PAO table version/), String(version));
  }
});

test('rejects unknown fields instead of silently discarding data', () => {
  assert.throws(() => normalizeProfile(table([], { digits: '327753' })),
    invalid(/The PAO table has unsupported field "digits"/));
  assert.throws(() => normalizeProfile(table([], { scenes: [], notes: 'x' })),
    invalid(/unsupported fields "scenes", "notes"/));
  assert.throws(() => normalizeProfile(table([{ code: '32', person: 'astronaut', color: 'red' }])),
    invalid(/The row for code 32 has unsupported field "color"/));
  assert.throws(() => normalizeProfile(table([{ code: '32', Person: 'astronaut' }])), invalid(/"Person"/));
  assert.throws(() => parseProfile('{"format":"digitloom-pao","version":1,"name":"x","entries":[],"__proto__":{"polluted":true}}'),
    invalid(/unsupported field "__proto__"/));
  assert.equal({}.polluted, undefined);
});

test('rejects malformed rows, invalid string codes, duplicate codes, and extra rows', () => {
  for (const entries of [undefined, null, {}, 'rows', 100]) {
    assert.throws(() => normalizeProfile({ ...table(), entries }), invalid(/"entries"/), String(entries));
  }
  for (const entry of [null, 'row', 32, [], undefined]) {
    assert.throws(() => normalizeProfile({ ...table(), entries: [entry] }), invalid(/Entry 1 must be an object/));
  }
  assert.throws(() => normalizeProfile(table([{ person: 'astronaut' }])), invalid(/Entry 1 needs a "code"/));
  for (const code of [5, 32, 0]) {
    assert.throws(() => normalizeProfile(table([{ code }])), invalid(new RegExp(`uses the number ${code} as its code`)));
  }
  assert.throws(() => parseProfile('{"format":"digitloom-pao","version":1,"name":"x","entries":[{"code":7}]}'),
    invalid(/Entry 1 uses the number 7 as its code; write codes as text/));
  for (const code of ['100', ' 05', '05 ', '0a', '', '-1', '\u0660\u0665', '\uff13\uff12', null, true, ['05'], { code: '05' }]) {
    assert.throws(() => normalizeProfile(table([{ code: '00' }, { code }])),
      invalid(/Entry 2 has an invalid code/), JSON.stringify(code));
  }
  assert.throws(() => normalizeProfile(table([{ code: '32', person: 'astronaut' }, { code: '32', action: 'bounces' }])),
    invalid(/Code 32 appears in more than one row/));
  assert.throws(() => normalizeProfile(table([...CODES, '00'].map((code) => ({ code })))),
    invalid(/at most 110 rows.*this one has 111/));
  assert.throws(() => normalizeProfile(table([...PAIR_CODES, '00'].map((code) => ({ code })), { version: 1 })),
    invalid(/at most 100 rows.*this one has 101/));
  assert.deepEqual(normalizeProfile(table([...starter.entries].reverse())).entries, starter.entries);
  for (const [cell, value] of [['person', 5], ['action', null], ['object', true], ['peg', ['moon']], ['person', { text: 'x' }]]) {
    assert.throws(() => normalizeProfile(table([{ code: '32', [cell]: value }])),
      invalid(new RegExp(`The ${cell} for code 32 must be text`)));
  }
  for (const [field, value] of [['name', 5], ['license', null], ['attribution', ['x']]]) {
    assert.throws(() => normalizeProfile(table([], { [field]: value })), invalid(/must be text/), field);
  }
  assert.throws(() => normalizeProfile({ format: 'digitloom-pao', version: 1, entries: [] }), invalid(/table name is required/));
});

test('enforces single-line text and per-field limits counted in characters', () => {
  const metadata = new Set(['name', 'license', 'attribution']);
  const fields = [
    ['name', PROFILE_LIMITS.name], ['license', PROFILE_LIMITS.metadata], ['attribution', PROFILE_LIMITS.metadata],
    ['peg', PROFILE_LIMITS.peg], ...PAO_ROLES.map((role) => [role, PROFILE_LIMITS.association])
  ];
  for (const [field, limit] of fields) {
    const build = (text) => (metadata.has(field) ? table([], { [field]: text }) : table([{ code: '07', [field]: text }]));
    const read = (profile) => (metadata.has(field) ? profile[field] : entry(profile, '07')[field]);
    for (const text of ['x'.repeat(limit), '\u{1F600}'.repeat(limit), `  ${'\u00e9'.repeat(limit)}\n`]) {
      assert.equal(read(normalizeProfile(build(text))), text.trim(), `${field} accepts ${limit} characters`);
    }
    for (const text of ['x'.repeat(limit + 1), '\u{1F600}'.repeat(limit + 1)]) {
      assert.throws(() => normalizeProfile(build(text)),
        invalid(new RegExp(`has ${limit + 1} characters; the limit is ${limit}`)), field);
    }
    for (const text of ['two\nlines', 'carriage\rreturn', 'tab\tinside', 'nul\u0000', 'delete\u007f',
      'next\u0085line', 'line\u2028separator', 'paragraph\u2029separator', 'escape\u001b[31m']) {
      assert.throws(() => normalizeProfile(build(text)),
        invalid(/single line without tabs, line breaks, or other control characters/), `${field} ${JSON.stringify(text)}`);
    }
    for (const text of ['\ud83d', 'x\udc00y', '\ud800\ud800']) {
      assert.throws(() => normalizeProfile(build(text)), invalid(/invalid Unicode/), field);
    }
  }
  assert.throws(() => normalizeProfile(table([], { name: ' \t ' })), invalid(/table name cannot be blank/));
  assert.equal(entry(normalizeProfile(table([{ code: '07', person: 'astronaut\n' }])), '07').person, 'astronaut');
  const marks = '\u200fRTL\u200d mark \u{1F469}\u200D\u{1F680}';
  assert.equal(entry(normalizeProfile(table([{ code: '07', person: marks }])), '07').person, marks);
});

test('parses JSON text with an optional BOM and useful errors', () => {
  assert.deepEqual(parseProfile(`\uFEFF${starterText}`), starter);
  for (const value of [undefined, null, 42, Buffer.from(starterText), { text: starterText }]) {
    assert.throws(() => parseProfile(value), { name: 'TypeError', message: /must be a string/ });
  }
  for (const text of ['', '  \n\t', '\uFEFF', '\uFEFF  ']) {
    assert.throws(() => parseProfile(text), invalid(/This file is empty/), JSON.stringify(text));
  }
  for (const text of ['{', '{"format": "digitloom-pao",}', "{'format': 'digitloom-pao'}", 'format=digitloom-pao', '\uFEFF\uFEFF{}']) {
    assert.throws(() => parseProfile(text), (error) => {
      assert.equal(error.name, 'PaoProfileError');
      assert.match(error.message, /^This file is not valid JSON: ./);
      assert.ok(error.cause instanceof SyntaxError);
      return true;
    }, text);
  }
  for (const text of ['null', '[]', '"table"', '42', 'true']) {
    assert.throws(() => parseProfile(text), invalid(/must be a JSON object/), text);
  }
  assert.throws(() => parseProfile('{"format": "digitloom-columns", "version": 1}'), invalid(/not a DigitLoom PAO table/));
});

test('rejects repeated JSON keys that JSON.parse would silently collapse', () => {
  const header = '"format": "digitloom-pao", "version": 1';
  for (const [text, key] of [
    [`{${header}, "name": "A", "name": "B", "entries": []}`, 'name'],
    [`{${header}, "name": "A", "entries": [{"code": "32", "person": "astronaut", "person": "baker"}]}`, 'person'],
    [`{${header}, "name": "A", "entries": [{"code": "32", "\\u0070erson": "astronaut", "person": "baker"}]}`, 'person'],
    [`{${header}, "name": "A", "entries": [], "entries": []}`, 'entries']
  ]) {
    assert.throws(() => parseProfile(text), invalid(new RegExp(`"${key}" appears twice in the same object`)), text);
  }
  const tricky = `{${header}, "name": "Brace {\\"name\\": [1, 2]}, comma", "entries": [` +
    '{"code": "32", "person": "\\"code\\": \\"00\\", }"}, {"code": "33", "person": "back\\\\slash"}]}';
  const parsed = parseProfile(tricky);
  assert.equal(parsed.name, 'Brace {"name": [1, 2]}, comma');
  assert.equal(entry(parsed, '32').person, '"code": "00", }');
  assert.equal(entry(parsed, '33').person, 'back\\slash');
});

test('measures the import limit in UTF-8 bytes before parsing', () => {
  const compact = JSON.stringify(table([{ code: '32', person: 'astronaut' }]));
  const atLimit = compact + ' '.repeat(PROFILE_LIMITS.bytes - Buffer.byteLength(compact));
  assert.equal(Buffer.byteLength(atLimit), PROFILE_LIMITS.bytes);
  assert.equal(entry(parseProfile(atLimit), '32').person, 'astronaut');
  assert.throws(() => parseProfile(`${atLimit} `), invalid(/larger than 256 KiB/));
  assert.throws(() => parseProfile(`\uFEFF${atLimit}`), invalid(/larger than 256 KiB/));
  const multibyte = JSON.stringify(table([], { name: '\u00e9'.repeat(140000) }));
  assert.ok(multibyte.length < PROFILE_LIMITS.bytes && Buffer.byteLength(multibyte) > PROFILE_LIMITS.bytes);
  assert.throws(() => parseProfile(multibyte), invalid(/larger than 256 KiB/));
  assert.throws(() => parseProfile(' '.repeat(10_000_000)), invalid(/larger than 256 KiB/));
});

test('serializes only canonical table data as stable, readable JSON', () => {
  const partial = table([{ code: '32', peg: ' moon ', person: 'astronaut', action: 'bounces', object: 'moon rock' }],
    { license: 'CC0-1.0' });
  const text = serializeProfile(partial);
  const lines = text.split('\n');
  assert.deepEqual(lines.slice(0, 7), [
    '{', '  "format": "digitloom-pao",', '  "version": 2,', '  "name": "Test table",',
    '  "license": "CC0-1.0",', '  "attribution": "",', '  "entries": ['
  ]);
  assert.equal(lines[7], '    { "code": "0", "peg": "", "person": "", "action": "", "object": "" },');
  assert.equal(lines[17], '    { "code": "00", "peg": "", "person": "", "action": "", "object": "" },');
  assert.equal(lines[49], '    { "code": "32", "peg": "moon", "person": "astronaut", "action": "bounces", "object": "moon rock" },');
  assert.equal(lines[116], '    { "code": "99", "peg": "", "person": "", "action": "", "object": "" }');
  assert.deepEqual(lines.slice(117), ['  ]', '}', '']);
  const json = JSON.parse(text);
  assert.deepEqual(Object.keys(json), ['format', 'version', 'name', 'license', 'attribution', 'entries']);
  assert.deepEqual(json, normalizeProfile(partial));
  assert.equal(serializeProfile(normalizeProfile(partial)), text);
  assert.equal(serializeProfile(json), text);
  const session = { ...normalizeProfile(partial), digits: '327753', scenes: encodePao(partial, '327753').scenes };
  assert.throws(() => serializeProfile(session), invalid(/unsupported fields "digits", "scenes"/));
  assert.doesNotMatch(text, /327753|scenes|digits|trailingDigit|issues/);
});

test('import and export round trips preserve every association and provenance field', () => {
  const crew = '\u{1F469}\u200D\u{1F680} crew';
  const custom = table([
    { code: '00', peg: 'zoo', person: 'Zo\u00eb "the" keeper', action: 'back\\slashes', object: crew },
    { code: '07', person: 'astronaut' },
    { code: '08', person: 'astronaut' },
    { code: '99', object: '\u05de\u05d9\u05dd' }
  ], { name: 'Ada\u2019s table', license: 'CC0-1.0', attribution: 'Ada Lovelace, 1843' });
  const text = serializeProfile(custom);
  assert.ok(text.includes(crew) && text.includes('Zo\u00eb \\"the\\" keeper') && text.includes('back\\\\slashes'));
  const imported = parseProfile(text);
  assert.deepEqual(imported, normalizeProfile(custom));
  assert.equal(serializeProfile(imported), text);
  assert.deepEqual(findDuplicates(imported), [{ role: 'person', value: 'astronaut', codes: ['07', '08'] }]);

  assert.deepEqual(parseProfile(serializeProfile(starter)), starter);
  const edited = structuredClone(starter);
  entry(edited, '32').person = 'moonwalker';
  const editedImport = parseProfile(serializeProfile(edited));
  assert.equal(entry(editedImport, '32').person, 'moonwalker');
  assert.equal(editedImport.license, starter.license);
  assert.equal(editedImport.attribution, starter.attribution);

  const blank = parseProfile(serializeProfile(createBlankProfile('Mine')));
  assert.deepEqual([blank.name, blank.license, blank.attribution], ['Mine', '', '']);
  const bare = parseProfile('{"format":"digitloom-pao","version":1,"name":"Bare","entries":[{"code":"07","person":"astronaut"}]}');
  assert.deepEqual([bare.license, bare.attribution, entry(bare, '07').person], ['', '', 'astronaut']);
});

test('exports stay within the import size contract', () => {
  const rows = (peg, cell) => CODES.map((code) => ({ code, peg, person: cell, action: cell, object: cell }));
  const ascii = normalizeProfile(table(rows('p'.repeat(80), 'x'.repeat(200)),
    { name: 'n'.repeat(80), license: 'l'.repeat(1000), attribution: 'a'.repeat(1000) }));
  const asciiText = serializeProfile(ascii);
  assert.ok(Buffer.byteLength(asciiText) <= PROFILE_LIMITS.bytes);
  assert.deepEqual(parseProfile(asciiText), ascii);
  const emoji = normalizeProfile(table(rows('\u{1F600}'.repeat(80), '\u{1F600}'.repeat(200))));
  assert.throws(() => serializeProfile(emoji), invalid(/needs \d+ bytes as JSON, more than the 262144-byte import limit/));
});

test('engine functions never mutate inputs and return fresh results', () => {
  const frozenStarter = deepFreeze(structuredClone(starter));
  assert.deepEqual(normalizeProfile(frozenStarter), starter);
  assert.equal(serializeProfile(frozenStarter), starterText);
  assert.deepEqual(findDuplicates(frozenStarter), []);
  assert.equal(encodePao(frozenStarter, '327753').resolvedCodeCount, 3);

  const partial = deepFreeze(table([{ code: '32', person: ' astronaut ' }, { code: '45', person: 'Astronaut' }]));
  const copy = structuredClone(partial);
  normalizeProfile(partial);
  serializeProfile(partial);
  findDuplicates(partial);
  encodePao(partial, '3245');
  assert.deepEqual(partial, copy);

  const first = encodePao(partial, '32');
  first.scenes[0].slots[0].duplicateCodes.push('99');
  first.issues.length = 0;
  const second = encodePao(partial, '32');
  assert.deepEqual(second.scenes[0].slots[0].duplicateCodes, ['32', '45']);
  assert.equal(second.issues.length, 1);
  const groups = findDuplicates(partial);
  groups[0].codes.push('99');
  assert.deepEqual(findDuplicates(partial)[0].codes, ['32', '45']);
  const repeated = encodePao(partial, '32'.repeat(4));
  assert.notEqual(repeated.scenes[0].slots[0].duplicateCodes, repeated.scenes[1].slots[0].duplicateCodes);
  const normalized = normalizeProfile(partial);
  assert.ok(!Object.isFrozen(normalized) && !Object.isFrozen(entry(normalized, '32')));
  entry(normalized, '32').person = 'changed';
  assert.equal(entry(normalizeProfile(partial), '32').person, 'astronaut');
});

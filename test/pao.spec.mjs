import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PROFILE_LIMITS, encodePao, findDuplicates, parseProfile } from '../web/pao-logic.js';

const problems = new WeakMap();
const allowedOrigins = new Set(['http://127.0.0.1:4173', 'http://127.0.0.1:4174']);
const starter = parseProfile(await readFile(new URL('../web/data/pao-starter.json', import.meta.url), 'utf8'));
const dictionary = JSON.parse(await readFile(new URL('../web/data/db.json', import.meta.url)));
const codes = Array.from({ length: 100 }, (_, index) => String(index).padStart(2, '0'));
const roles = ['person', 'action', 'object'];
const complete = (profile) => profile.entries.filter((entry) => roles.every((role) => entry[role].trim())).length;

const numberInput = (page) => page.getByLabel('Your number', { exact: true });
const button = (page, name) => page.getByRole('button', { name, exact: true });
const cell = (page, field, code) => page.getByLabel(`${field} for ${code}`, { exact: true });
const replaceDialog = (page) => page.getByRole('dialog', { name: 'Replace this table?', exact: true });
const profileFile = (name, content) => ({
  name, mimeType: 'application/json',
  buffer: Buffer.isBuffer(content) ? content : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content))
});
const pageStorage = (page) => page.evaluate(async () => ({
  local: localStorage.length,
  session: sessionStorage.length,
  cookie: document.cookie,
  databases: (await indexedDB.databases()).length,
  caches: (await caches.keys()).length
}));
const leaveGuarded = (page) => page.evaluate(() => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
});
const domProblems = (page) => page.evaluate(() => {
  const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
  const references = [...document.querySelectorAll('[aria-describedby], [aria-labelledby], [aria-controls], label[for]')]
    .flatMap((element) => ['aria-describedby', 'aria-labelledby', 'aria-controls', 'for']
      .flatMap((name) => (element.getAttribute(name) ?? '').split(/\s+/).filter(Boolean)));
  return {
    duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
    missingReferences: references.filter((id) => !document.getElementById(id))
  };
});

// Init script: reads of files named "slow*" wait until the test releases them, then settle all follow-up work.
function holdSlowReads() {
  const read = File.prototype.arrayBuffer;
  const held = new Map();
  window.releaseRead = async (name) => {
    const release = held.get(name);
    if (!release) throw new Error(`No held read for ${name}`);
    held.delete(name);
    await release();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  File.prototype.arrayBuffer = function arrayBuffer() {
    if (!this.name.startsWith('slow')) return read.call(this);
    return new Promise((resolve, reject) => {
      held.set(this.name, () => read.call(this).then(resolve, reject));
    });
  };
}

// Init script: counts starter downloads whose follow-up work has had a chance to run.
function countStarterBodies() {
  const read = Response.prototype.arrayBuffer;
  window.starterBodies = 0;
  Response.prototype.arrayBuffer = function arrayBuffer() {
    return read.call(this).then((buffer) => {
      if (this.url.endsWith('/data/pao-starter.json')) setTimeout(() => { window.starterBodies += 1; }, 0);
      return buffer;
    });
  };
}

const releaseRead = (page, name) => page.evaluate((file) => window.releaseRead(file), name);
const chooseImport = (page, name, content) => page.locator('#import-file').setInputFiles(profileFile(name, content));
const namedTable = (name) => ({
  format: 'digitloom-pao', version: 1, name, entries: [{ code: '32', person: `${name} person`, action: 'waves', object: 'flag' }]
});
const importedMessage = (name) => `Imported \u201c${name}\u201d: 1 of 100 codes complete.`;
const usingTable = (name) => `Using table \u201c${name}\u201d.`;
const blankMessage = 'Started a new blank table. Name it, fill in the codes you need, and export it to keep it.';

async function expandWords(page, list, total) {
  const showAll = list.getByRole('button', { name: `Show all ${total} words`, exact: true });
  await expect(showAll).toHaveAttribute('aria-expanded', 'false');
  await showAll.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await showAll.click();
  await expect(list.locator('.word-choice')).toHaveCount(total);
  const firstRevealed = list.locator('.word-choice').nth(24);
  await expect(firstRevealed).toBeFocused();
  await expect(firstRevealed).toBeInViewport({ ratio: 1 });
  expect(Math.abs(await page.evaluate(() => window.scrollY) - before)).toBeLessThan(page.viewportSize().height / 2);
  await expect(list.getByRole('button', { name: 'Show fewer words', exact: true })).toHaveAttribute('aria-expanded', 'true');
}

async function collapseWords(page, list, total) {
  await list.getByRole('button', { name: 'Show fewer words', exact: true }).click();
  await expect(list.locator('.word-choice')).toHaveCount(24);
  const showAll = list.getByRole('button', { name: `Show all ${total} words`, exact: true });
  await expect(showAll).toBeFocused();
  await expect(showAll).toBeInViewport({ ratio: 1 });
  await expect(showAll).toHaveAttribute('aria-expanded', 'false');
}

function sceneSlots(page) {
  return page.locator('#pao-scenes > li').evaluateAll((scenes) => scenes.map((scene) => [...scene.querySelectorAll('.slot')]
    .map((slot) => [
      slot.querySelector('.slot-role').textContent,
      slot.querySelector('.slot-code').textContent,
      (slot.querySelector('.slot-value') ?? slot.querySelector('.slot-missing')).textContent
    ])));
}

function expectedSlots(profile, digits) {
  return encodePao(profile, digits).scenes.map((scene) => scene.slots.map((slot) => [
    slot.role[0].toUpperCase() + slot.role.slice(1), slot.code, slot.value.trim() || `Missing ${slot.role}`
  ]));
}

async function openPao(page, url = '/web/pao.html') {
  await page.goto(url);
  await expect(numberInput(page)).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
  const failures = [];
  problems.set(page, failures);
  page.on('pageerror', (failure) => failures.push(failure.message));
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'beforeunload') return dialog.accept();
    failures.push(`Unexpected ${dialog.type()} dialog: ${dialog.message()}`);
    return dialog.dismiss();
  });
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' || url.search) failures.push(`Unexpected ${request.method()} request: ${request.url()}`);
    if (allowedOrigins.has(url.origin)) return route.continue();
    failures.push(`Unexpected remote request: ${request.url()}`);
    return route.abort();
  });
});

test.afterEach(async ({ page }) => {
  expect(problems.get(page)).toEqual([]);
  expect(page.url()).not.toMatch(/[?#].*[0-9]/);
  expect(await pageStorage(page)).toEqual({ local: 0, session: 0, cookie: '', databases: 0, caches: 0 });
});

test('the starter table turns 327753 into astronaut / frosts / lime with labelled roles and exact pairs', async ({ page }) => {
  await openPao(page);
  await expect(page).toHaveTitle('PAO scenes - DigitLoom');
  await expect(page.locator('#table-in-use')).toHaveText('Using table \u201cDigitLoom starter PAO\u201d.');
  await expect(page.locator('#pao-step-title')).toHaveText('Type digits to begin');
  await expect(page.locator('#pao-empty')).toHaveText('Try 327753: astronaut / frosts / lime.');
  await expect(page.locator('#table-editor')).not.toHaveAttribute('open', '');
  const input = numberInput(page);
  await input.pressSequentially('327753');
  await expect(input).toHaveValue('327753');
  await expect.poll(() => sceneSlots(page)).toEqual([[['Person', '32', 'astronaut'], ['Action', '77', 'frosts'], ['Object', '53', 'lime']]]);
  const scene = page.locator('#pao-scenes > li').first();
  await expect(scene.getByRole('heading', { level: 3 })).toHaveText('Scene 1 pairs 32 77 53');
  await expect(scene.locator('.slot-peg')).toHaveText(['Peg: moon', 'Peg: cake', 'Peg: lime']);
  await expect(scene.getByRole('term')).toHaveText(['Person 32', 'Action 77', 'Object 53']);
  await expect(page.locator('#pao-step-title')).toHaveText('Your number is encoded.');
  await expect(page.locator('#pao-progress-label')).toHaveText('6 of 6 digits encoded');
  await expect(page.locator('#pao-progress-bar')).toHaveAttribute('value', '6');
  await expect(page.locator('#scene-count')).toHaveText('1 scene from 3 pairs.');
  await expect(page.locator('#pao-issues')).toBeHidden();
  await expect(page.locator('#pao-tail')).toBeHidden();
  await expect(page.locator('#pao-empty')).toBeHidden();

  await input.pressSequentially(' 885366');
  await expect(input).toHaveValue('327753 885366');
  await expect.poll(() => sceneSlots(page)).toEqual([
    [['Person', '32', 'astronaut'], ['Action', '77', 'frosts'], ['Object', '53', 'lime']],
    [['Person', '88', 'musician'], ['Action', '53', 'squeezes'], ['Object', '66', 'defendant']]
  ]);
  await expect(page.locator('#scene-count')).toHaveText('2 scenes from 6 pairs.');
  const typography = await page.locator('.slot-value').evaluateAll((values) => values.map((value) => {
    const style = getComputedStyle(value);
    return `${style.color} ${style.fontWeight} ${style.fontSize}`;
  }));
  expect(new Set(typography).size).toBe(1);
  await expect(page.locator('#pao-output sup, #pao-output .recommended')).toHaveCount(0);

  await input.fill('08');
  await expect.poll(() => sceneSlots(page)).toEqual([[['Person', '08', 'Wile E. Coyote']]]);
  await expect(page.locator('.scene-note')).toHaveText('The number ends here, so this scene has no action or object.');
  await expect(page.locator('#pao-step-title')).toHaveText('Your number is encoded.');
  await expect(page.locator('#pao-progress-label')).toHaveText('2 of 2 digits encoded');
  expect(new URL(page.url()).pathname).toBe('/web/pao.html');
  expect(new URL(page.url()).search + new URL(page.url()).hash).toBe('');
});

test('partial scenes, leading zeros, invalid input, and a separate one-digit ending keep progress honest', async ({ page }) => {
  const dictionaryRequests = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes('/data/db')) dictionaryRequests.push(path);
  });
  await openPao(page);
  const input = numberInput(page);
  await input.fill('0877');
  await expect.poll(() => sceneSlots(page)).toEqual([[['Person', '08', 'Wile E. Coyote'], ['Action', '77', 'frosts']]]);
  await expect(page.locator('.scene-note')).toHaveText('The number ends here, so this scene has no object.');
  await expect(page.locator('#pao-progress-label')).toHaveText('4 of 4 digits encoded');
  await expect(page.locator('#pao-step-title')).toHaveText('Your number is encoded.');
  await input.fill(' 00 53 ');
  await expect(input).toHaveValue(' 00 53 ');
  await expect.poll(() => sceneSlots(page)).toEqual(expectedSlots(starter, '0053'));
  expect(dictionaryRequests).toEqual([]);

  await input.fill('32775');
  const tail = page.getByRole('region', { name: 'Final digit 5', exact: true });
  await expect(tail).toBeVisible();
  await expect(tail).toContainText('PAO works in pairs');
  await expect.poll(() => sceneSlots(page)).toEqual([[['Person', '32', 'astronaut'], ['Action', '77', 'frosts']]]);
  await expect(page.locator('.scene-note'))
    .toHaveText('One digit remains after this pair, so this scene has no object. That digit gets its own ending below.');
  await expect(page.locator('#pao-step-title')).toHaveText('Choose a word for the final digit');
  await expect(page.locator('#pao-progress-label')).toHaveText('4 of 5 digits encoded');
  const words = dictionary.byCode['5'];
  const [first] = words[0];
  const firstChoice = tail.getByRole('button', { name: `Choose ${first} (5)`, exact: true });
  await expect(firstChoice).toBeVisible();
  await expect(tail.getByRole('heading', { name: '1-digit words', exact: true })).toBeVisible();
  const commonEndings = dictionary.source.commonWords.countsByCode['5'] ?? 0;
  await expect(tail.locator('.word-spelling')).toHaveText(words.slice(0, 24).map(([word]) => word));
  await expect(tail.locator('.recommended')).toHaveCount(Math.min(24, commonEndings));
  await expandWords(page, tail, words.length);
  await expect(tail.locator('.word-spelling')).toHaveText(words.map(([word]) => word));
  await expect(tail.locator('.recommended .word-spelling')).toHaveText(words.slice(0, commonEndings).map(([word]) => word));
  await collapseWords(page, tail, words.length);
  await expect(tail.locator('.word-spelling')).toHaveText(words.slice(0, 24).map(([word]) => word));
  await expect(tail.locator('.recommended')).toHaveCount(Math.min(24, commonEndings));
  expect(dictionaryRequests).toEqual(['/web/data/db.txt.gz']);
  await firstChoice.click();
  await expect(page.locator('#tail-word')).toHaveText(first);
  await expect(page.locator('#tail-code')).toHaveText('5');
  await expect(page.locator('#pao-progress-label')).toHaveText('5 of 5 digits encoded');
  await expect(page.locator('#pao-step-title')).toHaveText('Your number is encoded.');
  await expect(button(page, 'Undo ending')).toBeFocused();
  await expect(tail.locator('.word-choice')).toHaveCount(0);
  await button(page, 'Undo ending').click();
  await expect(page.locator('#tail-chosen')).toBeHidden();
  await expect(page.locator('#pao-progress-label')).toHaveText('4 of 5 digits encoded');
  await expect(tail.locator('.word-choice').first()).toBeFocused();

  await firstChoice.click();
  await input.focus();
  await input.press('End');
  await input.pressSequentially('3');
  await expect(input).toHaveValue('327753');
  await expect(tail).toBeHidden();
  await input.press('Backspace');
  await expect(tail).toBeVisible();
  await expect(page.locator('#tail-chosen')).toBeHidden();
  await expect(firstChoice).toBeVisible();
  await expect(page.locator('#pao-progress-label')).toHaveText('4 of 5 digits encoded');

  await firstChoice.click();
  await button(page, 'Clear').click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(tail).toBeHidden();
  await expect(page.locator('#pao-scenes > li')).toHaveCount(0);
  await expect(page.locator('#pao-progress')).toBeHidden();
  await expect(page.locator('#pao-step-title')).toHaveText('Type digits to begin');
  await expect(button(page, 'Clear')).toBeDisabled();
  await expect(page.locator('#table-in-use')).toHaveText('Using table \u201cDigitLoom starter PAO\u201d.');
  await expect(cell(page, 'Person', '32')).toHaveValue('astronaut');
  await input.fill('5');
  await expect(tail).toBeVisible();
  await expect(page.locator('#tail-chosen')).toBeHidden();
  await expect(page.locator('#pao-scenes > li')).toHaveCount(0);
  await expect(page.locator('#pao-progress-label')).toHaveText('0 of 1 digits encoded');

  await input.fill('12a');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#pao-input-error')).toHaveText('Use digits and spaces only.');
  await expect(page.locator('#pao-step-title')).toHaveText('Check your number');
  await expect(page.locator('#pao-empty')).toHaveText('Replace letters or punctuation with digits to see your scenes.');
  await expect(page.locator('#pao-scenes > li')).toHaveCount(0);
  await expect(page.locator('#pao-progress')).toBeHidden();
  await expect(tail).toBeHidden();
  await expect(input).toHaveValue('12a');
  expect(dictionaryRequests).toEqual(['/web/data/db.txt.gz']);
});

test('long numbers are encoded completely and shown in pages of scenes', async ({ page }) => {
  await openPao(page);
  const digits = '00920'.repeat(2000);
  const expected = encodePao(starter, digits);
  expect(expected.pairCount).toBe(5000);
  const input = numberInput(page);
  await input.fill(digits);
  await expect(page.locator('#scene-count')).toHaveText(
    `Showing scenes 1\u201350 of ${expected.scenes.length.toLocaleString('en-US')}, from 5,000 pairs.`);
  await expect(page.locator('#pao-scenes > li')).toHaveCount(50);
  await expect(page.locator('#pao-progress-label'))
    .toHaveText(`${(expected.resolvedPairCount * 2).toLocaleString('en-US')} of 10,000 digits encoded`);
  expect(await input.inputValue()).toBe(digits);
  await button(page, 'Show 50 more scenes').click();
  const scenes = page.locator('#pao-scenes > li');
  await expect(scenes).toHaveCount(100);
  await expect(scenes.nth(50)).toBeFocused();
  await expect(scenes.nth(50).locator('h3'))
    .toHaveText(`Scene 51 pairs ${expected.scenes[50].slots.map((slot) => slot.code).join(' ')}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);

  await input.fill(`${digits}7`);
  await expect(page.locator('#pao-scenes > li')).toHaveCount(50);
  await expect(page.getByRole('region', { name: 'Final digit 7', exact: true })).toBeVisible();
  await expect(page.locator('#pao-progress-label'))
    .toHaveText(`${(expected.resolvedPairCount * 2).toLocaleString('en-US')} of 10,001 digits encoded`);
  expect((await input.inputValue()).length).toBe(10_001);
});

test('editing associations and the table name changes every number that uses them', async ({ page }) => {
  await openPao(page);
  const input = numberInput(page);
  await input.fill('327753');
  await button(page, 'Edit table').click();
  await expect(page.locator('#table-editor')).toHaveAttribute('open', '');
  await expect(page.locator('#table-editor > summary')).toBeFocused();
  await expect(page.locator('.pao-row')).toHaveCount(100);
  expect(await page.locator('.row-code').allTextContents()).toEqual(codes);
  await expect(page.locator('#filter-count')).toHaveText('Showing all 100 codes');
  const name = page.getByLabel('Table name', { exact: true });
  await expect(name).toHaveValue('DigitLoom starter PAO');
  await expect(name).toHaveAttribute('maxlength', String(PROFILE_LIMITS.name));
  await expect(cell(page, 'Peg', '32')).toHaveAttribute('maxlength', String(PROFILE_LIMITS.peg));
  await expect(cell(page, 'Object', '99')).toHaveAttribute('maxlength', String(PROFILE_LIMITS.association));
  await expect(page.locator('#table-license')).toHaveText(starter.license);
  await expect(page.locator('#table-attribution')).toHaveText(starter.attribution);
  expect(await leaveGuarded(page)).toBe(false);

  await name.fill('Morning table');
  await expect(page.locator('#table-in-use')).toHaveText('Using table \u201cMorning table\u201d.');
  await expect(page.locator('#table-summary')).toContainText('not exported');
  await cell(page, 'Person', '32').fill('Ada Lovelace');
  await expect.poll(() => sceneSlots(page)).toEqual([[['Person', '32', 'Ada Lovelace'], ['Action', '77', 'frosts'], ['Object', '53', 'lime']]]);
  await input.fill('773232');
  await expect.poll(() => sceneSlots(page)).toEqual([[['Person', '77', 'baker'], ['Action', '32', 'bounces'], ['Object', '32', 'moon rock']]]);
  await cell(page, 'Action', '32').fill('debugs');
  await expect.poll(() => sceneSlots(page)).toEqual([[['Person', '77', 'baker'], ['Action', '32', 'debugs'], ['Object', '32', 'moon rock']]]);
  await input.fill('3232');
  await expect.poll(() => sceneSlots(page)).toEqual([[['Person', '32', 'Ada Lovelace'], ['Action', '32', 'debugs']]]);
  await expect(page.locator('#pao-step-title')).toHaveText('Your number is encoded.');
  expect(await leaveGuarded(page)).toBe(true);

  await name.fill(' ');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#table-name-error')).toBeVisible();
  await expect(page.locator('#table-in-use')).toHaveText('Using table \u201cUntitled table\u201d.');
  await button(page, 'Export table').click();
  await expect(page.locator('#table-error')).toContainText('Could not export this table.');
  await expect(name).toBeFocused();
  await name.fill('Morning table');
  await expect(name).toHaveAttribute('aria-invalid', 'false');
  await expect(page.locator('#table-name-error')).toBeHidden();
});

test('missing and duplicate associations are explicit and focus the right table cell', async ({ page }) => {
  await openPao(page);
  await button(page, 'New blank table').click();
  await expect(replaceDialog(page)).toBeHidden();
  await expect(page.locator('#table-in-use')).toHaveText('Using table \u201cMy PAO table\u201d.');
  await expect(page.locator('#table-message')).toContainText('Started a new blank table.');
  await expect(page.locator('#table-license')).toHaveText('None recorded');
  const input = numberInput(page);
  await input.fill('327753');
  await expect(page.locator('#pao-step-title')).toHaveText('3 associations need attention');
  await expect(page.locator('#pao-progress-label')).toHaveText('0 of 6 digits encoded');
  await expect(page.locator('#pao-issue-list li')).toHaveText([
    'No person for 32 yet. Edit person for 32',
    'No action for 77 yet. Edit action for 77',
    'No object for 53 yet. Edit object for 53'
  ]);
  await expect.poll(() => sceneSlots(page)).toEqual([[['Person', '32', 'Missing person'], ['Action', '77', 'Missing action'], ['Object', '53', 'Missing object']]]);
  await button(page, 'Edit person for 32').click();
  await expect(page.locator('#table-editor')).toHaveAttribute('open', '');
  await expect(cell(page, 'Person', '32')).toBeFocused();
  await expect(cell(page, 'Person', '32')).toBeInViewport();
  await page.keyboard.type('astronaut');
  await expect(page.locator('#pao-progress-label')).toHaveText('2 of 6 digits encoded');
  await expect(page.locator('#pao-step-title')).toHaveText('2 associations need attention');
  await cell(page, 'Action', '77').fill('frosts');
  await cell(page, 'Object', '53').fill('lime');
  await expect(page.locator('#pao-step-title')).toHaveText('Your number is encoded.');
  await expect(page.locator('#pao-issues')).toBeHidden();

  await cell(page, 'Person', '77').fill('  ASTRONAUT ');
  await expect(page.locator('#pao-step-title')).toHaveText('1 association needs attention');
  await expect(page.locator('#pao-progress-label')).toHaveText('4 of 6 digits encoded');
  await expect(page.locator('#pao-issue-list li')).toHaveText([
    'Person \u201castronaut\u201d is also the person for 77, so 32 is ambiguous. Edit person for 32'
  ]);
  const person = page.locator('#pao-scenes .slot[data-role="person"]');
  await expect(person.locator('.slot-value')).toHaveText('astronaut');
  await expect(person.locator('.slot-warning')).toHaveText('Ambiguous: also the person for 77');
  await expect(cell(page, 'Person', '32')).toHaveAccessibleDescription('Duplicate: also the person for 77');
  await expect(cell(page, 'Person', '77')).toHaveAccessibleDescription('Duplicate: also the person for 32');
  const summary = page.locator('#duplicate-summary');
  const [group] = findDuplicates({ ...starter, entries: starter.entries.map((entry) => ({ ...entry,
    person: { '32': 'astronaut', '77': '  ASTRONAUT ' }[entry.code] ?? '', action: '', object: '' })) });
  await expect(summary.locator('li')).toHaveText([`Person \u201c${group.value}\u201d: 32 77`]);
  await expect(page.locator('#table-summary')).toContainText('1 duplicate');
  expect(await domProblems(page)).toEqual({ duplicateIds: [], missingReferences: [] });

  const find = page.getByLabel('Find', { exact: true });
  const show = page.getByLabel('Show', { exact: true });
  await show.selectOption('duplicates');
  await expect(page.locator('#filter-count')).toHaveText('Showing 2 of 100 codes');
  await expect(page.locator('.pao-row:visible .row-code')).toHaveText(['32', '77']);
  await find.fill('nothing matches this');
  await expect(page.locator('#no-rows')).toBeVisible();
  await button(page, 'Edit person for 32').click();
  await expect(find).toHaveValue('');
  await expect(show).toHaveValue('all');
  await expect(page.locator('#filter-count')).toHaveText('Showing all 100 codes');
  await expect(cell(page, 'Person', '32')).toBeFocused();
  await summary.getByRole('button', { name: 'Go to person for 77', exact: true }).click();
  await expect(cell(page, 'Person', '77')).toBeFocused();
  await cell(page, 'Person', '77').fill('baker');
  await expect(summary).toBeHidden();
  await expect(cell(page, 'Person', '32')).not.toHaveAttribute('aria-describedby');
  await expect(page.locator('#pao-step-title')).toHaveText('Your number is encoded.');

  await find.fill('5');
  await expect(page.locator('.pao-row:visible .row-code')).toHaveText(codes.slice(50, 60));
  await find.fill('LIME');
  await expect(page.locator('.pao-row:visible .row-code')).toHaveText(['53']);
  await find.fill('');
  await show.selectOption('number');
  await expect(page.locator('.pao-row:visible .row-code')).toHaveText(['32', '53', '77']);
  await input.fill('0877');
  await expect(page.locator('.pao-row:visible .row-code')).toHaveText(['08', '77']);
  await show.selectOption('missing');
  await expect(page.locator('#filter-count')).toHaveText('Showing all 100 codes');

  await input.fill('00010203040506070809');
  await expect(page.locator('#pao-step-title')).toHaveText('10 associations need attention');
  await expect(page.locator('#pao-issue-list li')).toHaveCount(8);
  await button(page, 'Show all 10').click();
  await expect(page.locator('#pao-issue-list li')).toHaveCount(10);
  await expect(button(page, 'Show fewer')).toHaveAttribute('aria-expanded', 'true');
});

test('export and import round-trip the table and its metadata, never the numbers or scenes', async ({ page }) => {
  await page.addInitScript(() => {
    window.blobLinks = { created: [], revoked: [] };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      const url = create(object);
      window.blobLinks.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.blobLinks.revoked.push(url);
      revoke(url);
    };
  });
  await openPao(page);
  const input = numberInput(page);
  await input.fill('3277538853660');
  await page.locator('#pao-tail .word-choice').first().click();
  await button(page, 'Edit table').click();
  const name = page.getByLabel('Table name', { exact: true });
  await name.fill('Travel table');
  await cell(page, 'Person', '32').fill('Grace Hopper');
  await cell(page, 'Peg', '32').fill('mama');
  const downloading = page.waitForEvent('download');
  await button(page, 'Export table').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('digitloom-pao.json');
  const text = await readFile(await download.path(), 'utf8');
  expect(text.endsWith('\n')).toBe(true);
  const exported = JSON.parse(text);
  expect(Object.keys(exported).sort()).toEqual(['attribution', 'entries', 'format', 'license', 'name', 'version']);
  expect(exported).toMatchObject({
    format: 'digitloom-pao', version: 1, name: 'Travel table', license: starter.license, attribution: starter.attribution
  });
  expect(starter.license).toBe('CC-BY-SA-4.0');
  expect(starter.attribution).toContain('https://certik.github.io/digitloom/sources.html');
  expect(exported.entries.map((entry) => entry.code)).toEqual(codes);
  expect(exported.entries[32]).toEqual({ ...starter.entries[32], peg: 'mama', person: 'Grace Hopper' });
  expect(exported.entries.filter((entry) => entry.code !== '32')).toEqual(starter.entries.filter((entry) => entry.code !== '32'));
  for (const secret of ['3277538853660', '327753', '885366']) expect(text).not.toContain(secret);
  await expect(page.locator('#table-message')).toHaveText('Exported digitloom-pao.json. Import it later to continue with this table.');
  await expect(page.locator('#table-summary')).toContainText('no unexported changes');
  await expect.poll(() => page.evaluate(() => window.blobLinks.created.length === 1 &&
    window.blobLinks.revoked.includes(window.blobLinks.created[0]))).toBe(true);
  expect(await leaveGuarded(page)).toBe(false);

  await cell(page, 'Person', '32').fill('changed');
  await name.fill('Other table');
  const file = profileFile('digitloom-pao.json', text);
  await page.locator('#import-file').setInputFiles(file);
  const dialog = replaceDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('\u201cOther table\u201d has changes that are not exported.');
  await expect(dialog).toContainText('the imported table \u201cTravel table\u201d');
  await expect(dialog.getByRole('button', { name: 'Keep current table' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Keep current table' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#table-message')).toHaveText('Import canceled. Your current table is unchanged.');
  await expect(cell(page, 'Person', '32')).toHaveValue('changed');
  await expect(name).toHaveValue('Other table');
  await page.locator('#import-file').setInputFiles(file);
  await dialog.getByRole('button', { name: 'Replace table' }).click();
  await expect(cell(page, 'Person', '32')).toHaveValue('Grace Hopper');
  await expect(cell(page, 'Peg', '32')).toHaveValue('mama');
  await expect(name).toHaveValue('Travel table');
  await expect(page.locator('#table-license')).toHaveText(starter.license);
  await expect(page.locator('#table-attribution')).toHaveText(starter.attribution);
  await expect(page.locator('#table-message')).toHaveText(`Imported \u201cTravel table\u201d: ${complete(starter)} of 100 codes complete.`);
  await expect(input).toHaveValue('3277538853660');
  await expect(page.locator('#tail-chosen')).toBeVisible();
  await expect.poll(() => sceneSlots(page)).toEqual(expectedSlots(parseProfile(text), '327753885366'));
  await expect(page.locator('#pao-scenes .slot-value').first()).toHaveText('Grace Hopper');
  expect(await leaveGuarded(page)).toBe(false);
  expect(await pageStorage(page)).toEqual({ local: 0, session: 0, cookie: '', databases: 0, caches: 0 });
  expect(page.url()).toBe('http://127.0.0.1:4173/web/pao.html');
});

test('malformed, oversized, and unsafe-looking imports never replace the table or inject markup', async ({ page }) => {
  await openPao(page);
  const input = numberInput(page);
  await input.fill('327753');
  const starterScene = [[['Person', '32', 'astronaut'], ['Action', '77', 'frosts'], ['Object', '53', 'lime']]];
  const base = { format: 'digitloom-pao', version: 1, name: 'Bad' };
  for (const [name, content, reason] of [
    ['broken.json', '{"format": "digitloom-pao",', ''],
    ['format.json', { ...base, format: 'other', entries: [] }, ''],
    ['version.json', { ...base, version: 2, entries: [] }, ''],
    ['numeric-code.json', { ...base, entries: [{ code: 7, person: 'x' }] }, ''],
    ['short-code.json', { ...base, entries: [{ code: '7', person: 'x' }] }, ''],
    ['repeated-code.json', { ...base, entries: [{ code: '12', person: 'x' }, { code: '12', action: 'y' }] }, ''],
    ['unknown-key.json', { ...base, entries: [], notes: 'x' }, ''],
    ['nameless.json', { ...base, name: '', entries: [] }, ''],
    ['control.json', { ...base, entries: [{ code: '01', person: 'bell\u0007' }] }, ''],
    ['long-cell.json', { ...base, entries: [{ code: '01', person: 'x'.repeat(PROFILE_LIMITS.association + 1) }] }, ''],
    ['too-many.json', { ...base, entries: [...codes, '00'].map((code) => ({ code })) }, ''],
    ['huge.json', Buffer.alloc(PROFILE_LIMITS.bytes + 1, 0x20), '256 KiB'],
    ['utf16.json', Buffer.from([0xff, 0xfe, 0x7b, 0x00]), 'not UTF-8 text']
  ]) {
    await page.locator('#import-file').setInputFiles(profileFile(name, content));
    const error = page.locator('#table-error');
    await expect(error).toContainText(`Could not import \u201c${name}\u201d.`);
    await expect(error).toContainText('Your current table is unchanged.');
    if (reason) await expect(error).toContainText(reason);
    await expect(replaceDialog(page)).toBeHidden();
    await expect(page.locator('#table-in-use')).toHaveText('Using table \u201cDigitLoom starter PAO\u201d.');
    await expect.poll(() => sceneSlots(page)).toEqual(starterScene);
  }

  const unsafe = {
    format: 'digitloom-pao', version: 1, name: '<img src=x onerror="window.injected = 1">',
    license: '<b>CC0</b>', attribution: 'javascript:window.injected=2 https://example.com/<i>credit</i>',
    entries: [
      { code: '32', peg: '<svg onload="window.injected = 3">', person: '<script>window.injected = 4</script>',
        action: 'javascript:alert(1)', object: '<a href="https://example.com">link</a>' },
      { code: '77', person: '<SCRIPT>window.injected = 4</SCRIPT>' }
    ]
  };
  await page.locator('#import-file').setInputFiles(profileFile('unsafe.json', unsafe));
  await expect(page.locator('#table-in-use')).toHaveText(`Using table \u201c${unsafe.name}\u201d.`);
  await expect(page.locator('#table-message'))
    .toHaveText(`Imported \u201c${unsafe.name}\u201d: 1 of 100 codes complete. 1 duplicate value to review in the editor.`);
  await expect.poll(() => sceneSlots(page)).toEqual([[
    ['Person', '32', unsafe.entries[0].person], ['Action', '77', 'Missing action'], ['Object', '53', 'Missing object']
  ]]);
  await expect(page.locator('#pao-scenes .slot-peg')).toHaveText([`Peg: ${unsafe.entries[0].peg}`]);
  await expect(page.locator('#pao-issue-list li')).toHaveCount(3);
  await input.fill('333232');
  await expect(page.locator('#pao-scenes .slot-value')).toHaveText([unsafe.entries[0].action, unsafe.entries[0].object]);
  await button(page, 'Edit table').click();
  await expect(page.locator('#table-license')).toHaveText(unsafe.license);
  await expect(page.locator('#table-attribution')).toHaveText(unsafe.attribution);
  await expect(page.locator('#duplicate-summary li')).toHaveCount(1);
  await expect(cell(page, 'Object', '32')).toHaveValue(unsafe.entries[0].object);
  expect(await page.evaluate(() => ({
    injected: window.injected,
    elements: document.querySelectorAll('main img, main script, main svg, main b, main i, main iframe').length,
    links: [...document.querySelectorAll('main a')].map((link) => link.getAttribute('href'))
  }))).toEqual({ injected: undefined, elements: 0, links: ['guide.html#pao'] });

  await page.locator('#import-file').setInputFiles(profileFile('partial.json', {
    format: 'digitloom-pao', version: 1, name: 'Partial',
    entries: [{ code: '05', person: 'Ada Lovelace', action: 'knits', object: 'kettle' }, { code: '06', action: 'juggles' }]
  }));
  await expect(page.locator('#table-message')).toHaveText('Imported \u201cPartial\u201d: 1 of 100 codes complete.');
  await expect(page.locator('#table-license')).toHaveText('None recorded');
  await expect(page.locator('#table-attribution')).toHaveText('None recorded');
  await expect(page.locator('.pao-row')).toHaveCount(100);
  await input.fill('050605');
  await expect.poll(() => sceneSlots(page)).toEqual([[['Person', '05', 'Ada Lovelace'], ['Action', '06', 'juggles'], ['Object', '05', 'kettle']]]);
  await expect(page.locator('#pao-step-title')).toHaveText('Your number is encoded.');
});

test('replacing a changed table asks first, and cancelling keeps every edit', async ({ page, isMobile }) => {
  await openPao(page);
  const input = numberInput(page);
  await input.fill('327753');
  await button(page, 'Edit table').click();
  await cell(page, 'Person', '32').fill('Ada Lovelace');
  const dialog = replaceDialog(page);
  if (isMobile) await button(page, 'New blank table').tap();
  else await button(page, 'New blank table').click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Replacing it with a new blank table discards them.');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button(page, 'New blank table')).toBeFocused();
  await expect(page.locator('#table-message')).toHaveText('Kept your current table.');
  await expect(cell(page, 'Person', '32')).toHaveValue('Ada Lovelace');
  await expect(page.locator('#pao-scenes .slot-value').first()).toHaveText('Ada Lovelace');

  await button(page, 'Restore starter').click();
  await expect(dialog).toContainText('the starter table \u201cDigitLoom starter PAO\u201d');
  await dialog.getByRole('button', { name: 'Keep current table' }).click();
  await expect(cell(page, 'Person', '32')).toHaveValue('Ada Lovelace');
  await button(page, 'Restore starter').click();
  await dialog.getByRole('button', { name: 'Replace table' }).click();
  await expect(dialog).toBeHidden();
  await expect(cell(page, 'Person', '32')).toHaveValue('astronaut');
  await expect(page.locator('#table-message')).toHaveText('Restored \u201cDigitLoom starter PAO\u201d.');
  await expect(input).toHaveValue('327753');
  await expect(page.locator('#pao-scenes .slot-value').first()).toHaveText('astronaut');

  await button(page, 'New blank table').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#table-in-use')).toHaveText('Using table \u201cMy PAO table\u201d.');
  await expect(input).toHaveValue('327753');
  await expect(page.locator('#pao-step-title')).toHaveText('3 associations need attention');
  await button(page, 'Restore starter').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#table-in-use')).toHaveText('Using table \u201cDigitLoom starter PAO\u201d.');
  await expect(page.locator('#pao-step-title')).toHaveText('Your number is encoded.');
});

test('a delayed import cannot overwrite a newer blank table or a newer import', async ({ page }) => {
  await page.addInitScript(holdSlowReads);
  await openPao(page);
  const inUse = page.locator('#table-in-use');
  const message = page.locator('#table-message');
  await chooseImport(page, 'slow.json', namedTable('Older delayed import'));
  await expect(message).toHaveText('Reading \u201cslow.json\u201d...');
  await expect(inUse).toHaveText(usingTable('DigitLoom starter PAO'));
  await button(page, 'New blank table').click();
  await expect(inUse).toHaveText(usingTable('My PAO table'));
  await expect(message).toHaveText(blankMessage);
  await releaseRead(page, 'slow.json');
  await expect(inUse).toHaveText(usingTable('My PAO table'));
  await expect(message).toHaveText(blankMessage);
  await expect(page.locator('#table-error')).toBeHidden();
  await expect(replaceDialog(page)).toBeHidden();

  await chooseImport(page, 'slow.json', namedTable('Older delayed import'));
  await chooseImport(page, 'newer.json', namedTable('Latest chosen import'));
  await expect(inUse).toHaveText(usingTable('Latest chosen import'));
  await expect(message).toHaveText(importedMessage('Latest chosen import'));
  await releaseRead(page, 'slow.json');
  await expect(inUse).toHaveText(usingTable('Latest chosen import'));
  await expect(message).toHaveText(importedMessage('Latest chosen import'));
  await expect(replaceDialog(page)).toBeHidden();
  await numberInput(page).fill('32');
  await expect(page.locator('#pao-scenes .slot-value')).toHaveText(['Latest chosen import person']);
});

test('when two delayed imports finish in either order, only the latest choice is applied', async ({ page }) => {
  await page.addInitScript(holdSlowReads);
  for (const firstToFinish of ['slow-older.json', 'slow-newer.json']) {
    await openPao(page);
    const inUse = page.locator('#table-in-use');
    const message = page.locator('#table-message');
    await chooseImport(page, 'slow-older.json', namedTable('Older choice'));
    await chooseImport(page, 'slow-newer.json', namedTable('Newer choice'));
    await expect(message).toHaveText('Reading \u201cslow-newer.json\u201d...');
    await releaseRead(page, firstToFinish);
    if (firstToFinish === 'slow-older.json') {
      await expect(inUse).toHaveText(usingTable('DigitLoom starter PAO'));
      await expect(message).toHaveText('Reading \u201cslow-newer.json\u201d...');
      await releaseRead(page, 'slow-newer.json');
    } else {
      await expect(inUse).toHaveText(usingTable('Newer choice'));
      await releaseRead(page, 'slow-older.json');
    }
    await expect(inUse).toHaveText(usingTable('Newer choice'));
    await expect(message).toHaveText(importedMessage('Newer choice'));
    await expect(page.locator('#table-error')).toBeHidden();
    await expect(replaceDialog(page)).toBeHidden();
  }
});

test('stale import errors and cancellations never replace newer feedback, and unexported edits still need confirmation', async ({ page }) => {
  await page.addInitScript(holdSlowReads);
  await openPao(page);
  const inUse = page.locator('#table-in-use');
  const message = page.locator('#table-message');
  const error = page.locator('#table-error');
  const dialog = replaceDialog(page);
  await chooseImport(page, 'slow-broken.json', '{"format": "digitloom-pao",');
  await chooseImport(page, 'good.json', namedTable('Good table'));
  await expect(message).toHaveText(importedMessage('Good table'));
  await releaseRead(page, 'slow-broken.json');
  await expect(error).toBeHidden();
  await expect(message).toHaveText(importedMessage('Good table'));
  await expect(inUse).toHaveText(usingTable('Good table'));

  await button(page, 'Edit table').click();
  await cell(page, 'Person', '32').fill('unexported edit');
  await chooseImport(page, 'slow-old.json', namedTable('Old choice'));
  await chooseImport(page, 'newest.json', namedTable('Newest choice'));
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('the imported table \u201cNewest choice\u201d');
  await dialog.getByRole('button', { name: 'Keep current table', exact: true }).click();
  const canceled = 'Import canceled. Your current table is unchanged.';
  await expect(message).toHaveText(canceled);
  await releaseRead(page, 'slow-old.json');
  await expect(dialog).toBeHidden();
  await expect(message).toHaveText(canceled);
  await expect(cell(page, 'Person', '32')).toHaveValue('unexported edit');
  await expect(inUse).toHaveText(usingTable('Good table'));

  await chooseImport(page, 'slow-current.json', namedTable('Delayed current choice'));
  await expect(message).toHaveText('Reading \u201cslow-current.json\u201d...');
  await releaseRead(page, 'slow-current.json');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('the imported table \u201cDelayed current choice\u201d');
  await dialog.getByRole('button', { name: 'Replace table', exact: true }).click();
  await expect(inUse).toHaveText(usingTable('Delayed current choice'));
  await expect(message).toHaveText(importedMessage('Delayed current choice'));
  await expect(cell(page, 'Person', '32')).toHaveValue('Delayed current choice person');
});

test('opening a newer file picker supersedes a pending import before its dialog can appear', async ({ page }) => {
  await page.addInitScript(holdSlowReads);
  await openPao(page);
  const inUse = page.locator('#table-in-use');
  const message = page.locator('#table-message');
  const dialog = replaceDialog(page);
  await button(page, 'Edit table').click();
  for (const [outcome, tableName] of [
    ['replace', 'DigitLoom starter PAO'], ['keep', 'Newest chosen table'], ['cancel picker', 'Newest chosen table']
  ]) {
    await cell(page, 'Person', '32').fill('navigator');
    await expect(page.locator('#table-summary')).toContainText('changes not exported');
    await chooseImport(page, 'slow.json', namedTable('Older import'));
    await expect(message).toHaveText('Reading \u201cslow.json\u201d...');
    const choosing = page.waitForEvent('filechooser');
    await button(page, 'Import table').click();
    const chooser = await choosing;
    await expect(message).toHaveText('');
    await releaseRead(page, 'slow.json');
    await expect(dialog).toBeHidden();
    await expect(inUse).toHaveText(usingTable(tableName));
    await expect(cell(page, 'Person', '32')).toHaveValue('navigator');
    if (outcome === 'cancel picker') {
      await chooser.setFiles([]);
      await expect(dialog).toBeHidden();
      await expect(inUse).toHaveText(usingTable(tableName));
      await expect(cell(page, 'Person', '32')).toHaveValue('navigator');
      await expect(page.locator('#table-summary')).toContainText('changes not exported');
      await expect(page.locator('#table-error')).toBeHidden();
      continue;
    }
    await chooser.setFiles(profileFile('newest.json', namedTable('Newest chosen table')));
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('the imported table \u201cNewest chosen table\u201d');
    await expect(dialog).not.toContainText('Older import');
    if (outcome === 'replace') {
      await dialog.getByRole('button', { name: 'Replace table', exact: true }).click();
      await expect(inUse).toHaveText(usingTable('Newest chosen table'));
      await expect(message).toHaveText(importedMessage('Newest chosen table'));
      await expect(cell(page, 'Person', '32')).toHaveValue('Newest chosen table person');
    } else {
      await dialog.getByRole('button', { name: 'Keep current table', exact: true }).click();
      await expect(message).toHaveText('Import canceled. Your current table is unchanged.');
      await expect(inUse).toHaveText(usingTable(tableName));
      await expect(cell(page, 'Person', '32')).toHaveValue('navigator');
    }
    await expect(dialog).toBeHidden();
  }
});

test('restore and retry supersede pending imports, and newer choices supersede pending starter requests', async ({ page }) => {
  await page.addInitScript(holdSlowReads);
  await page.addInitScript(countStarterBodies);
  let starterMode = 'missing';
  let releaseStarter = () => {};
  await page.route('**/data/pao-starter.json', async (route) => {
    if (starterMode === 'missing') return route.fulfill({ status: 404, body: 'Not found' });
    if (starterMode === 'held') await new Promise((resolve) => { releaseStarter = resolve; });
    return route.fallback();
  });
  await page.goto('/web/pao.html');
  const inUse = page.locator('#table-in-use');
  const message = page.locator('#table-message');
  await expect(page.locator('#table-load-error')).toBeVisible();

  await chooseImport(page, 'slow-import.json', namedTable('Pending import'));
  await expect(message).toHaveText('Reading \u201cslow-import.json\u201d...');
  starterMode = 'ok';
  await button(page, 'Try again').click();
  await expect(inUse).toHaveText(usingTable('DigitLoom starter PAO'));
  await expect(message).toHaveText('');
  await releaseRead(page, 'slow-import.json');
  await expect(inUse).toHaveText(usingTable('DigitLoom starter PAO'));
  await expect(message).toHaveText('');
  await expect(page.locator('#table-error')).toBeHidden();

  await chooseImport(page, 'slow-import.json', namedTable('Pending import'));
  await button(page, 'Restore starter').click();
  const restored = 'Restored \u201cDigitLoom starter PAO\u201d.';
  await expect(message).toHaveText(restored);
  await releaseRead(page, 'slow-import.json');
  await expect(inUse).toHaveText(usingTable('DigitLoom starter PAO'));
  await expect(message).toHaveText(restored);

  for (const [choice, name, feedback] of [
    ['import', 'Chosen while restoring', importedMessage('Chosen while restoring')],
    ['blank', 'My PAO table', blankMessage]
  ]) {
    starterMode = 'missing';
    await page.reload();
    await expect(page.locator('#table-load-error')).toBeVisible();
    await button(page, 'New blank table').click();
    starterMode = 'held';
    await button(page, 'Restore starter').click();
    await expect(button(page, 'Restore starter')).toBeDisabled();
    if (choice === 'import') await chooseImport(page, 'mine.json', namedTable(name));
    else await button(page, 'New blank table').click();
    await expect(inUse).toHaveText(usingTable(name));
    await expect(message).toHaveText(feedback);
    await expect(button(page, 'Restore starter')).toBeEnabled();
    releaseStarter();
    await expect.poll(() => page.evaluate(() => window.starterBodies)).toBe(1);
    await expect(inUse).toHaveText(usingTable(name));
    await expect(message).toHaveText(feedback);
    await expect(replaceDialog(page)).toBeHidden();
    await expect(page.locator('#table-error')).toBeHidden();
  }

  starterMode = 'held';
  await page.reload();
  await expect(page.locator('#table-load-status')).toHaveText('Opening the starter table...');
  await chooseImport(page, 'broken.json', '{');
  const importError = 'Could not import \u201cbroken.json\u201d.';
  await expect(page.locator('#table-error')).toContainText(importError);
  await expect(page.locator('#table-load-status')).toHaveText('No table is open yet.');
  await expect(button(page, 'Restore starter')).toBeEnabled();
  releaseStarter();
  await expect.poll(() => page.evaluate(() => window.starterBodies)).toBe(1);
  await expect(page.locator('#table-error')).toContainText(importError);
  await expect(page.locator('#table-load-status')).toHaveText('No table is open yet.');
  await expect(inUse).toHaveText('');
  await expect(numberInput(page)).toBeDisabled();
  starterMode = 'ok';
  await button(page, 'Restore starter').click();
  await expect(inUse).toHaveText(usingTable('DigitLoom starter PAO'));
  await expect(page.locator('#table-error')).toBeHidden();
  await expect(numberInput(page)).toBeEnabled();
});

test('starter failures stay visible and recover by retrying, starting blank, or importing', async ({ page }) => {
  let mode = 'missing';
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await page.route('**/data/pao-starter.json', async (route) => {
    if (mode === 'missing') return route.fulfill({ status: 404, body: 'Not found' });
    if (mode === 'broken') return route.fulfill({ contentType: 'application/json', body: '{"format": "digitloom-pao"' });
    if (mode === 'pending') {
      await pending;
      return route.abort();
    }
    return route.fallback();
  });
  await page.goto('/web/pao.html');
  const input = numberInput(page);
  const failure = page.locator('#table-load-error');
  await expect(failure).toContainText('DigitLoom could not open its starter PAO table. HTTP 404.');
  await expect(input).toBeDisabled();
  await expect(button(page, 'Export table')).toBeDisabled();
  await expect(button(page, 'Edit table')).toBeDisabled();
  await expect(page.locator('#table-editor')).toBeHidden();
  await expect(page.locator('#pao-output')).toBeHidden();
  await expect(page.locator('#table-in-use')).toHaveText('');
  await expect(page.locator('#table-summary'))
    .toHaveText('No table is open. Start a new blank table, restore the starter, or import a table.');
  mode = 'broken';
  await button(page, 'Try again').click();
  await expect(failure).toContainText('DigitLoom could not open its starter PAO table.');
  await expect(failure).not.toContainText('HTTP 404');
  await expect(button(page, 'Try again')).toBeFocused();
  await expect(input).toBeDisabled();
  mode = 'ok';
  await button(page, 'Try again').click();
  await expect(input).toBeEnabled();
  await expect(input).toBeFocused();
  await expect(failure).toBeHidden();
  await expect(page.locator('#table-in-use')).toHaveText('Using table \u201cDigitLoom starter PAO\u201d.');

  mode = 'broken';
  await page.reload();
  await expect(failure).toBeVisible();
  await expect(input).toBeDisabled();
  await button(page, 'New blank table').click();
  await expect(replaceDialog(page)).toBeHidden();
  await expect(input).toBeEnabled();
  await expect(failure).toBeHidden();
  await expect(page.locator('#table-in-use')).toHaveText('Using table \u201cMy PAO table\u201d.');
  await input.fill('32');
  await expect(page.locator('#pao-step-title')).toHaveText('1 association needs attention');

  mode = 'pending';
  await page.reload();
  await expect(page.locator('#table-load-status')).toHaveText('Opening the starter table...');
  await expect(input).toBeDisabled();
  await expect(button(page, 'Restore starter')).toBeDisabled();
  await page.locator('#import-file').setInputFiles(profileFile('mine.json', {
    format: 'digitloom-pao', version: 1, name: 'Mine', entries: [{ code: '32', person: 'pilot' }]
  }));
  await expect(page.locator('#table-in-use')).toHaveText('Using table \u201cMine\u201d.');
  await expect(input).toBeEnabled();
  const failed = page.waitForEvent('requestfailed');
  release();
  await failed;
  await input.fill('32');
  await expect(page.locator('#pao-scenes .slot-value')).toHaveText(['pilot']);
  await expect(failure).toBeHidden();
  await expect(page.locator('#table-in-use')).toHaveText('Using table \u201cMine\u201d.');
  await expect(button(page, 'Restore starter')).toBeEnabled();
});

test('peg ideas load the dictionary only on request, with honest failures and retry', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes('/data/db')) requests.push(path);
  });
  let fail = true;
  await page.route('**/data/db.txt.gz', (route) => (fail ? route.abort() : route.fallback()));
  await openPao(page);
  await numberInput(page).fill('327753');
  await button(page, 'Edit table').click();
  expect(requests).toEqual([]);
  const ideas = button(page, 'Ideas for peg 32');
  await expect(ideas).toHaveAttribute('aria-expanded', 'false');
  await ideas.click();
  await expect(ideas).toHaveAttribute('aria-expanded', 'true');
  const panel = page.getByRole('group', { name: 'Peg ideas for 32', exact: true });
  await expect(panel.getByRole('alert')).toContainText('DigitLoom could not open its word library.');
  await expect(panel.locator('.word-choice')).toHaveCount(0);
  fail = false;
  await panel.getByRole('button', { name: 'Try again', exact: true }).click();
  const entries = dictionary.byCode['32'];
  const words = entries.map(([word]) => word);
  const common = dictionary.source.commonWords.countsByCode['32'];
  await expect(panel.locator('.word-spelling')).toHaveText(words.slice(0, 24));
  await expect(panel.locator('.word-choice').first()).toBeFocused();
  await expect(panel.locator('.recommended')).toHaveCount(Math.min(24, common));
  await expandWords(page, panel, words.length);
  await expect(panel.locator('.word-spelling')).toHaveText(words);
  await expect(panel.locator('.recommended .word-spelling')).toHaveText(words.slice(0, common));
  expect(new Set(await panel.locator('.word-choice').evaluateAll((buttons) => buttons.map((choice) => choice.dataset.code)))).toEqual(new Set(['32']));
  const [, moonFlags] = entries.find(([word]) => word === 'moon');
  const moon = panel.getByRole('button', { name: 'Use moon as the peg for 32', exact: true });
  await expect(moon.locator('.word-grammar')).toHaveText(['noun', 'verb', 'adjective'].filter((label) => moonFlags.includes(label[0])).join(', '));
  const typography = await panel.locator('.word-spelling').evaluateAll((spellings) => spellings.map((spelling) => {
    const style = getComputedStyle(spelling);
    return `${style.color} ${style.fontWeight}`;
  }));
  expect(new Set(typography).size).toBe(1);
  await collapseWords(page, panel, words.length);
  await expect(panel.locator('.word-spelling')).toHaveText(words.slice(0, 24));
  await expect(panel.locator('.recommended')).toHaveCount(Math.min(24, common));
  const choice = words.find((word) => word !== 'moon');
  await panel.getByRole('button', { name: `Use ${choice} as the peg for 32`, exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(ideas).toHaveAttribute('aria-expanded', 'false');
  await expect(cell(page, 'Peg', '32')).toHaveValue(choice);
  await expect(cell(page, 'Peg', '32')).toBeFocused();
  await expect(page.locator('#pao-scenes .slot-peg').first()).toHaveText(`Peg: ${choice}`);
  await expect(page.locator('#pao-scenes .recommended')).toHaveCount(0);

  await ideas.click();
  await panel.locator('.word-choice').first().focus();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(ideas).toBeFocused();
  await button(page, 'Ideas for peg 07').click();
  await expect(page.getByRole('group', { name: 'Peg ideas for 07', exact: true }).locator('.word-spelling'))
    .toHaveText(dictionary.byCode['07'].slice(0, 24).map(([word]) => word));
  await button(page, 'Ideas for peg 53').click();
  await expect(page.getByRole('group', { name: 'Peg ideas for 07', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Peg ideas for 53', exact: true })).toBeVisible();
  await numberInput(page).fill('3277537');
  await expect(page.locator('#pao-tail .word-choice').first()).toBeVisible();
  expect(requests).toEqual(['/web/data/db.txt.gz', '/web/data/db.txt.gz']);
});

test('a final-digit ending reports dictionary failures and retries without inventing words', async ({ page }) => {
  let fail = true;
  await page.route('**/data/db.txt.gz', (route) => (fail ? route.fulfill({ body: Buffer.from([0x1f, 0x8b, 0x08, 0x00]) }) : route.fallback()));
  await openPao(page);
  await numberInput(page).fill('327');
  const tail = page.getByRole('region', { name: 'Final digit 7', exact: true });
  await expect(tail.getByRole('alert')).toContainText('DigitLoom could not open its word library.');
  await expect(tail.locator('.word-choice')).toHaveCount(0);
  await expect(page.locator('#pao-step-title')).toHaveText('Choose a word for the final digit');
  await expect(page.locator('#pao-progress-label')).toHaveText('2 of 3 digits encoded');
  fail = false;
  await tail.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(tail.locator('.word-spelling')).toHaveText(dictionary.byCode['7'].slice(0, 24).map(([word]) => word));
  await expect(tail.locator('.word-choice').first()).toBeFocused();
  await expect(tail.getByRole('alert')).toBeHidden();
  await tail.locator('.word-choice').first().click();
  await expect(page.locator('#pao-step-title')).toHaveText('Your number is encoded.');
});

test('the PAO page, its guide, and the starter notice work at root and subdirectory URLs', async ({ page }) => {
  for (const root of ['/web/', 'http://127.0.0.1:4174/']) {
    await page.goto(root);
    const menu = page.getByRole('navigation', { name: 'Site', exact: true });
    await menu.getByRole('link', { name: 'PAO', exact: true }).click();
    await expect(page).toHaveTitle('PAO scenes - DigitLoom');
    await expect(numberInput(page)).toBeEnabled();
    await expect(menu.locator('[aria-current="page"]')).toHaveText('PAO');
    await numberInput(page).fill('327753');
    await expect(page.locator('#pao-scenes .slot-value')).toHaveText(['astronaut', 'frosts', 'lime']);
    await page.getByRole('link', { name: 'How PAO works', exact: true }).click();
    await expect(page).toHaveTitle('How it works - DigitLoom');
    await expect(page.getByRole('heading', { name: 'Scenes with person, action, object', exact: true })).toBeInViewport();
    await expect(page.locator('.scene-example')).toContainText('327753 becomes an astronaut who frosts a lime.');
    await expect(page.locator('main')).toContainText('Wile E. Coyote');
    await expect(page.locator('.example')).toContainText('3277 becomes moon cake');
    await menu.getByRole('link', { name: 'Data & licenses', exact: true }).click();
    await expect(page).toHaveTitle('Data & licenses - DigitLoom');
    await expect(page.locator('#pao-starter + p')).toContainText('DigitLoom contributors');
    const starterLink = page.getByRole('link', { name: 'DigitLoom starter PAO', exact: true });
    const response = await page.request.get(await starterLink.evaluate((link) => link.href));
    expect(response.ok()).toBe(true);
    expect(parseProfile(await response.text())).toEqual(starter);
    await expect(page.locator('main')).toContainText('Robyn Speer');
    await menu.getByRole('link', { name: 'PAO', exact: true }).click();
    await expect(numberInput(page)).toBeEnabled();
    await expect(numberInput(page)).toHaveValue('');
    await page.getByRole('link', { name: 'DigitLoom', exact: true }).click();
    await expect(page).toHaveTitle('DigitLoom - Give numbers a memorable shape');
    await expect(page.getByLabel('Your number', { exact: true })).toBeEnabled();
  }
});

test('keyboard and touch reach the encoder, warnings, editor cells, and endings', async ({ page, isMobile }) => {
  await openPao(page);
  const activate = (locator) => (isMobile ? locator.tap() : locator.press('Enter'));
  await button(page, 'New blank table').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#table-in-use')).toHaveText('Using table \u201cMy PAO table\u201d.');
  const input = numberInput(page);
  await input.focus();
  await page.keyboard.type('530303');
  await page.keyboard.press('Tab');
  await expect(button(page, 'Clear')).toBeFocused();
  await expect(page.locator('#pao-step-title')).toHaveText('3 associations need attention');
  await activate(button(page, 'Edit object for 03'));
  await expect(cell(page, 'Object', '03')).toBeFocused();
  await page.keyboard.type('sumo wrestler');
  await page.keyboard.press('Shift+Tab');
  await expect(cell(page, 'Action', '03')).toBeFocused();
  await page.keyboard.type('juggles');
  await page.keyboard.press('Shift+Tab');
  await expect(cell(page, 'Person', '03')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(button(page, 'Ideas for peg 03')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cell(page, 'Peg', '03')).toBeFocused();
  await expect(page.locator('#pao-step-title')).toHaveText('1 association needs attention');
  await activate(button(page, 'Edit person for 53'));
  await expect(cell(page, 'Person', '53')).toBeFocused();
  await page.keyboard.type('bartender');
  await expect(page.locator('#pao-step-title')).toHaveText('Your number is encoded.');
  await input.fill('53037');
  const firstEnding = page.locator('#pao-tail .word-choice').first();
  await activate(firstEnding);
  await expect(button(page, 'Undo ending')).toBeFocused();
  await activate(button(page, 'Undo ending'));
  await expect(firstEnding).toBeFocused();
  const outline = await cell(page, 'Person', '53').evaluate((element) => {
    element.focus();
    const style = getComputedStyle(element);
    return `${style.outlineStyle} ${style.outlineWidth}`;
  });
  expect(outline).toBe('solid 3px');
});

test('the encoder and table editor fit narrow screens and wider fonts', async ({ page }) => {
  for (const [viewport, wideFont] of [
    [{ width: 320, height: 640 }, false], [{ width: 320, height: 640 }, true], [page.viewportSize(), true]
  ]) {
    await page.setViewportSize(viewport);
    await openPao(page);
    if (wideFont) await page.addStyleTag({ content: 'body, input, button, select { font-family: Verdana, sans-serif !important; }' });
    const input = numberInput(page);
    await input.fill('3277538853660');
    await button(page, 'Edit table').click();
    const long = 'Supercalifragilisticexpialidocious'.repeat(5);
    await cell(page, 'Person', '32').fill(long);
    await page.getByLabel('Table name', { exact: true }).fill('A'.repeat(80));
    await button(page, 'Ideas for peg 32').click();
    await expect(page.getByRole('group', { name: 'Peg ideas for 32', exact: true }).locator('.word-choice').first()).toBeVisible();
    await expect(page.locator('#pao-scenes .slot-value').first()).toHaveText(long);
    await expect(page.locator('#pao-tail .word-choice').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    expect(await domProblems(page)).toEqual({ duplicateIds: [], missingReferences: [] });
    const narrow = viewport.width <= 760;
    const labelWidth = await page.locator('#pao-row-32 .row-field > label').first().evaluate((label) => label.getBoundingClientRect().width);
    expect(labelWidth > 1).toBe(narrow);
    await expect(page.locator('.pao-rows-header')).toBeVisible({ visible: !narrow });
    for (const target of [input, cell(page, 'Object', '99'), button(page, 'Export table'), button(page, 'Ideas for peg 99')]) {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const header = await page.locator('.site-header').boundingBox();
    expect(header.height).toBeLessThanOrEqual(70);
    await page.getByLabel('Table name', { exact: true }).fill('DigitLoom starter PAO');
    await cell(page, 'Person', '32').fill('astronaut');
  }
});

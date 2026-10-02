import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const problems = new WeakMap();
const allowedOrigins = new Set(['http://127.0.0.1:4173', 'http://127.0.0.1:4174']);
const choose = (page, word, code) => page.getByRole('button', { name: `Choose ${word} (${code})`, exact: true });

test.beforeEach(async ({ page }) => {
  const failures = [];
  problems.set(page, failures);
  page.on('pageerror', (failure) => failures.push(failure.message));
  await page.route('**/*', (route) => {
    if (allowedOrigins.has(new URL(route.request().url()).origin)) return route.continue();
    failures.push(`Unexpected remote request: ${route.request().url()}`);
    return route.abort();
  });
  await page.goto('/web/');
  await expect(page.getByLabel('Your number', { exact: true })).toBeEnabled();
});

test.afterEach(async ({ page }) => {
  expect(problems.get(page)).toEqual([]);
});

test('the prompt moves up and suggestions fit without scrolling, even in a short viewport', async ({ page }) => {
  const input = page.getByLabel('Your number', { exact: true });
  for (const viewport of [page.viewportSize(), { width: 320, height: 568 }, { width: 375, height: 400 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.options-area')).toBeHidden();
    await expect(page.locator('#memory-thread')).toBeHidden();
    const idle = await input.boundingBox();
    expect(idle.y).toBeGreaterThanOrEqual(viewport.height * 0.2);
    expect(idle.y + idle.height).toBeLessThan(viewport.height * 0.55);
    await input.pressSequentially('3');
    await expect(page.locator('.word-choice').first()).toBeVisible();
    await input.pressSequentially('43434');
    await expect(page.locator('.options-area')).toBeVisible();
    await expect(page.locator('#memory-thread')).toBeHidden();
    const active = await input.boundingBox();
    const firstWord = await page.locator('.word-choice').first().boundingBox();
    expect(active.y).toBeLessThan(idle.y);
    expect(active.y).toBeLessThan(140);
    expect(firstWord.y - (active.y + active.height)).toBeLessThan(65);
    expect(firstWord.y + firstWord.height).toBeLessThan(Math.min(300, viewport.height * 0.7));
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(input).toBeFocused();
    await expect(page.locator('.options-area')).toBeHidden();
    expect((await input.boundingBox()).y).toBe(idle.y);
  }
});

test('grammar hints do not shift word spellings within a row', async ({ page }) => {
  await page.locator('#number').fill('343434');
  await expect(choose(page, 'murmur', '3434').locator('.word-grammar')).toHaveText('noun, verb');
  await expect(choose(page, 'miramar', '3434').locator('.word-grammar')).toHaveCount(0);
  const words = await page.locator('.word-choice').evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect();
    const spelling = button.querySelector('.word-spelling').getBoundingClientRect();
    const grammar = button.querySelector('.word-grammar')?.getBoundingClientRect();
    return { row: box.top, wordTop: spelling.top, inset: spelling.top - box.top,
      wordBottom: spelling.bottom, grammarTop: grammar?.top };
  }));
  const rows = new Map();
  for (const word of words) {
    if (!rows.has(word.row)) rows.set(word.row, word.wordTop);
    expect(word.wordTop).toBe(rows.get(word.row));
    expect(word.inset).toBeLessThan(9);
    if (word.grammarTop !== undefined) expect(word.grammarTop).toBeGreaterThanOrEqual(word.wordBottom);
  }
});

test('choosing a word far down the list returns to the thread and next suggestions', async ({ page }) => {
  await page.locator('#number').fill('343434');
  const lastWord = page.locator('.word-choice').last();
  await lastWord.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await lastWord.click();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('#number')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#memory-thread')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.word-choice').first()).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.word-choice').first()).toBeFocused();
});

test('DigitLoom builds moon cake and restores each step with Undo word', async ({ page }) => {
  const input = page.getByLabel('Your number', { exact: true });
  await expect(page).toHaveTitle('DigitLoom - Give numbers a memorable shape');
  await input.fill('3277');
  await expect(page.locator('#step-title')).toHaveText('Choose a word for the next digits');
  await choose(page, 'moon', '32').click();
  await expect(page.locator('#memory-thread')).toBeVisible();
  await expect(input).toHaveValue('32 77');
  await expect(page.locator('#progress-label')).toHaveText('2 of 4 digits encoded');
  await expect(page.locator('#sequence li')).toHaveText(['moon32']);
  await choose(page, 'cake', '77').click();
  await expect(page.locator('#sequence li')).toHaveText(['moon32', 'cake77']);
  await expect(page.locator('#progress')).toHaveAttribute('value', '4');
  await expect(page.locator('#step-title')).toHaveText('Your number is encoded.');
  await expect(page.locator('#options')).toBeEmpty();
  await expect(page.locator('#empty-options')).toBeHidden();
  await page.getByRole('button', { name: 'Undo word', exact: true }).click();
  await expect(choose(page, 'cake', '77')).toBeVisible();
  await expect(page.locator('#progress-label')).toHaveText('2 of 4 digits encoded');
  await page.getByRole('button', { name: 'Undo word', exact: true }).click();
  await expect(input).toHaveValue('3277');
  await expect(page.locator('#sequence')).toBeEmpty();
  await expect(page.locator('#memory-thread')).toBeHidden();
  await expect(page.locator('#undo')).toBeDisabled();
});

test('typing, validation, Clear, and zero-prefixed numbers keep the UI coherent', async ({ page }) => {
  const input = page.getByLabel('Your number', { exact: true });
  await input.fill('3277');
  await choose(page, 'moon', '32').click();
  await input.fill('12a');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#input-error')).toHaveText('Use digits and spaces only.');
  await expect(page.locator('#sequence')).toBeEmpty();
  await expect(page.locator('#memory-thread')).toBeHidden();
  await expect(page.locator('#options')).toBeEmpty();
  await expect(page.locator('.options-area')).toBeVisible();
  await expect(page.locator('#step-title')).toHaveText('Check your number');
  await input.fill(' 009 20 ');
  await expect(input).toHaveValue('00920');
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await expect(page.locator('#input-error')).toBeHidden();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(page.locator('#step-title')).toHaveText('Type digits to begin');
  await expect(page.locator('#progress-label')).toHaveText('No digits yet');
  await expect(page.locator('#options')).toBeEmpty();
  await expect(page.locator('.options-area')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeDisabled();
});

test('length groups, common-word ranking, plain grammar labels and exact codes are preserved', async ({ page }) => {
  await page.locator('#number').fill('1234');
  await expect(page.locator('.group-heading h3')).toHaveText(['4-digit words', '3-digit words', '2-digit words']);
  for (const [length, count] of [[4, 5], [3, 17], [2, 440]]) {
    const group = page.getByRole('region', { name: `${length}-digit words`, exact: true });
    await expect(group.getByRole('button')).toHaveCount(count);
    expect(await group.locator('button').evaluateAll((buttons) => buttons.map((b) => b.dataset.code.length)))
      .toEqual(Array(count).fill(length));
  }
  const common = page.getByRole('region', { name: '2-digit words', exact: true }).getByRole('button');
  await expect(common.nth(0).locator('.word-spelling')).toHaveText("don't");
  await expect(common.nth(1).locator('.word-spelling')).toHaveText('than');
  await expect(common.nth(2).locator('.word-spelling')).toHaveText('then');
  for (const [word, label] of [['then', 'noun, adjective'], ['doing', 'verb'], ['down', 'noun, verb, adjective']]) {
    await expect(choose(page, word, '12').locator('.word-grammar')).toHaveText(label);
    await expect(choose(page, word, '12')).toHaveAccessibleDescription(label);
    await expect(choose(page, word, '12')).toHaveClass('word-choice');
  }
  await expect(choose(page, "don't", '12').locator('.word-grammar')).toHaveCount(0);
  await expect(page.locator('#options sup')).toHaveCount(0);
  const typography = await page.locator('.word-spelling').evaluateAll((words) => words.map((word) => {
    const style = getComputedStyle(word);
    return { color: style.color, weight: style.fontWeight, size: style.fontSize };
  }));
  expect(new Set(typography.map((style) => JSON.stringify(style))).size).toBe(1);
  expect(typography[0].weight).toBe('400');
  await expect(choose(page, 'autonomy', '123').locator('.word-spelling')).toHaveText('autonomy');
  await choose(page, 'autonomy', '123').click();
  await expect(page.locator('#number')).toHaveValue('123 4');
  await expect(page.locator('.group-heading h3')).toHaveText(['1-digit words']);
  await page.getByRole('region', { name: '1-digit words' }).getByRole('button').first().click();
  await expect(page.locator('#step-title')).toHaveText('Your number is encoded.');
});

test('long inputs, single-digit remainders, and punctuation in words work', async ({ page }) => {
  const input = page.locator('#number');
  await input.fill('009');
  await choose(page, 'says', '00').click();
  await expect(input).toHaveValue('00 9');
  await expect(page.locator('.group-heading h3')).toHaveText(['1-digit words']);
  await page.locator('.word-choice').first().click();
  await expect(page.locator('#step-title')).toHaveText('Your number is encoded.');
  const digits = '00920'.repeat(2000);
  await input.fill(digits);
  await expect(input).toHaveValue(digits);
  await choose(page, 'says', '00').click();
  await expect(input).toHaveValue(`00 ${digits.slice(2)}`);
  await input.fill('0');
  await choose(page, "a's", '0').click();
  await expect(page.locator('#sequence li')).toHaveText(["a's0"]);
});

test('alternate long pronunciations and the longest word fit a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const [word, code] of [
    ['internationalization', '2142625062'], ['internationalization', '242625062'],
    ['antidisestablishmentarianism', '2110019563214203']
  ]) {
    await page.locator('#number').fill(code);
    await expect(page.locator('.group-heading h3').first()).toHaveText(`${code.length}-digit words`);
    await expect(page.locator('#options sup')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await choose(page, word, code).click();
    await expect(page.locator('#number')).toHaveValue(code);
    await expect(page.locator('#step-title')).toHaveText('Your number is encoded.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.getByRole('button', { name: 'Undo word', exact: true }).click();
    await expect(choose(page, word, code)).toBeVisible();
  }
});

test('the inline sound key works with keyboard and touch without covering the builder', async ({ page, isMobile }) => {
  const key = page.locator('#sound-key');
  const toggle = key.locator('summary');
  const closedInput = await page.locator('#number').boundingBox();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(key).toHaveAttribute('open', '');
  await expect(key.locator('dl > div')).toHaveCount(10);
  await expect(key.locator('dd')).toHaveText(['ice', 'hat', 'knee', 'ham', 'ray', 'owl', 'shoe', 'key', 'ivy', 'bee']);
  const panel = await key.locator('.sound-key-content').boundingBox();
  const input = await page.locator('#number').boundingBox();
  expect(input.y).toBe(closedInput.y);
  expect(input.y + input.height).toBeLessThanOrEqual(panel.y);
  await expect(page.locator('#number')).toBeInViewport({ ratio: 1 });
  if (isMobile) await toggle.tap();
  else await toggle.click();
  await expect(key).not.toHaveAttribute('open', '');
  await page.locator('#number').fill('32');
  await expect(choose(page, 'moon', '32')).toBeVisible();
});

test('guide, source notices, and navigation work at root and subdirectory URLs', async ({ page }) => {
  for (const root of ['/web/', 'http://127.0.0.1:4174/']) {
    await page.goto(root);
    await expect(page.locator('#number')).toBeEnabled();
    await expect(page.getByRole('link', { name: 'GitHub', exact: true }))
      .toHaveAttribute('href', 'https://github.com/certik/digitloom');
    await expect(page.getByRole('link', { name: 'GitHub', exact: true })).toBeInViewport();
    await page.getByRole('link', { name: 'How it works', exact: true }).click();
    await expect(page).toHaveTitle('How it works - DigitLoom');
    await expect(page.getByRole('link', { name: 'GitHub', exact: true }))
      .toHaveAttribute('href', 'https://github.com/certik/digitloom');
    await expect(page.locator('.example')).toContainText('3277 becomes moon cake');
    await page.getByRole('link', { name: 'Data & licenses', exact: true }).click();
    await expect(page).toHaveTitle('Data & licenses - DigitLoom');
    await expect(page.getByRole('link', { name: 'GitHub', exact: true }))
      .toHaveAttribute('href', 'https://github.com/certik/digitloom');
    await expect(page.locator('main')).toContainText('Robyn Speer');
    await expect(page.locator('main')).toContainText('Carnegie Mellon');
    await expect(page.locator('main')).toContainText('Princeton University');
    await expect(page.locator('main')).toContainText('MIT');
    const urls = await page.locator('a[href^="licenses/"]').evaluateAll((links) => links.map((link) => link.href));
    expect(new Set(urls).size).toBe(4);
    for (const url of new Set(urls)) {
      const response = await page.request.get(url);
      expect(response.ok()).toBe(true);
      expect((await response.text()).length).toBeGreaterThan(1000);
    }
    await page.getByRole('link', { name: 'Word builder', exact: true }).click();
    await expect(page.locator('#number')).toBeEnabled();
  }
});

test('native gzip is the only dictionary request and is below the size budget', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.reload();
  await expect(page.locator('#number')).toBeEnabled();
  expect(requests.filter((path) => path.includes('/data/'))).toEqual(['/web/data/db.txt.gz']);
  const response = await page.request.get('/web/data/db.txt.gz');
  expect(response.headers()['content-encoding']).toBeUndefined();
  expect((await response.body()).length).toBeLessThan(530_000);
});

test('browsers without a native decompressor use JSON and can complete a thread', async ({ page }) => {
  await page.addInitScript(() => { window.DecompressionStream = undefined; });
  const requests = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.reload();
  await expect(page.locator('#number')).toBeEnabled();
  expect(requests.filter((path) => path.includes('/data/'))).toEqual(['/web/data/db.json']);
  await page.locator('#number').fill('3277');
  await choose(page, 'moon', '32').click();
  await choose(page, 'cake', '77').click();
  await expect(page.locator('#step-title')).toHaveText('Your number is encoded.');
});

test('already-decoded responses and HTTP Content-Encoding gzip are both accepted', async ({ page }) => {
  const packed = await readFile(new URL('../web/data/db.txt.gz', import.meta.url));
  for (const decoded of [true, false]) {
    await page.route('**/data/db.txt.gz', (route) => route.fulfill({
      contentType: 'text/plain', headers: decoded ? {} : { 'Content-Encoding': 'gzip' },
      body: decoded ? gunzipSync(packed) : packed
    }));
    await page.reload();
    await expect(page.locator('#number')).toBeEnabled();
    await page.locator('#number').fill('32');
    await expect(choose(page, 'moon', '32')).toBeVisible();
  }
});

test('loading and download failures stay visible without retrying the large asset', async ({ page }) => {
  let resume;
  const wait = new Promise((resolve) => { resume = resolve; });
  await page.route('**/data/db.txt.gz', async (route) => { await wait; await route.abort(); });
  await page.reload();
  await expect(page.locator('#number')).toBeDisabled();
  await expect(page.locator('#library-status')).toHaveText('Opening the word library...');
  resume();
  await expect(page.locator('#library-error')).toContainText('DigitLoom could not open its word library');
  const requests = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  for (const body of ['{', '{}', Buffer.from([0x1f, 0x8b, 0x08, 0x00])]) {
    await page.route('**/data/db.txt.gz', (route) => route.fulfill({ body }));
    await page.reload();
    await expect(page.locator('#number')).toBeDisabled();
    await expect(page.locator('#library-error')).toBeVisible();
  }
  expect(requests).not.toContain('/web/data/db.json');
});

test('empty dictionaries explain missing prefixes without invented suggestions', async ({ page }) => {
  await page.route('**/data/db.txt.gz', (route) => route.fulfill({
    body: JSON.stringify({
      format: 'digitloom-columns', version: 1, dictionaryVersion: 3,
      source: { pairCount: 0, codeCount: 0, maxCodeLength: 0 }, codes: [], counts: []
    }) + '\n\n'
  }));
  await page.reload();
  await expect(page.locator('#number')).toBeEnabled();
  await page.locator('#number').fill('99');
  await expect(page.locator('#step-title')).toHaveText('No words for this prefix');
  await expect(page.locator('#options')).toBeEmpty();
  await expect(page.locator('#empty-options')).toContainText('Undo a choice or try a different number');
});

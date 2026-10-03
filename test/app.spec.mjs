import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const problems = new WeakMap();
const allowedOrigins = new Set(['http://127.0.0.1:4173', 'http://127.0.0.1:4174']);
const dictionary = JSON.parse(await readFile(new URL('../web/data/db.json', import.meta.url)));
const choose = (page, word, code) => page.getByRole('button', { name: `Choose ${word} (${code})`, exact: true });

test.beforeEach(async ({ page }) => {
  const failures = [];
  problems.set(page, failures);
  page.on('pageerror', (failure) => failures.push(failure.message));
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const versionedAsset = url.search === '?v=5' &&
      /\/(?:app\.js|pao\.js|logic\.js|dictionary\.js|styles\.css|data\/db\.(?:json|txt\.gz))$/.test(url.pathname);
    if (request.method() !== 'GET' || (url.search && !versionedAsset)) {
      failures.push(`Unexpected ${request.method()} request: ${request.url()}`);
    }
    if (allowedOrigins.has(url.origin)) return route.continue();
    failures.push(`Unexpected remote request: ${request.url()}`);
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

test('length groups, frequency recommendations, plain grammar labels and exact codes are preserved', async ({ page }) => {
  await page.locator('#number').fill('1234');
  await expect(page.locator('.group-heading h3')).toHaveText(['4-digit words', '3-digit words', '2-digit words']);
  for (const [length, count, commonCount] of [[4, 5, 0], [3, 17, 2], [2, 440, 69]]) {
    const group = page.getByRole('region', { name: `${length}-digit words`, exact: true });
    await expect(group.getByRole('button')).toHaveCount(count);
    expect(await group.locator('button').evaluateAll((buttons) => buttons.map((b) => b.dataset.code.length)))
      .toEqual(Array(count).fill(length));
    const rankedWords = dictionary.byCode['1234'.slice(0, length)].map(([word]) => word);
    await expect(group.locator('.word-spelling')).toHaveText(rankedWords);
    await expect(group.locator('.recommended .word-spelling')).toHaveText(rankedWords.slice(0, commonCount));
    await expect(group.locator('.word-recommendation')).toHaveText(Array(commonCount).fill('Recommended'));
    for (const label of await group.locator('.word-recommendation').all()) await expect(label).toBeHidden();
  }
  const common = page.getByRole('region', { name: '2-digit words', exact: true }).getByRole('button');
  await expect(common.nth(0).locator('.word-spelling')).toHaveText("don't");
  await expect(common.nth(1).locator('.word-spelling')).toHaveText('than');
  await expect(common.nth(2).locator('.word-spelling')).toHaveText('then');
  for (const [word, label, recommended] of [
    ['then', 'noun, adjective', true], ['doing', 'verb', true], ['down', 'noun, verb, adjective', true]
  ]) {
    await expect(choose(page, word, '12').locator('.word-grammar')).toHaveText(label);
    await expect(choose(page, word, '12')).toHaveAccessibleDescription(`${label}${recommended ? ' Recommended' : ''}`);
    await expect(choose(page, word, '12')).toHaveClass(`word-choice${recommended ? ' recommended' : ''}`);
  }
  await expect(choose(page, "don't", '12').locator('.word-grammar')).toHaveCount(0);
  await expect(choose(page, "don't", '12')).toHaveAccessibleDescription('Recommended');
  const background = (button) => button.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(await background(common.nth(0))).not.toBe(await background(common.nth(69)));
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

test('green highlights follow the frequency threshold with no cap or minimum', async ({ page }) => {
  for (const [code, count] of [['32', 29], ['77', 14], ['08', 9], ['626', 1], ['3277', 0]]) {
    await page.locator('#number').fill(code);
    const group = page.getByRole('region', { name: `${code.length}-digit words`, exact: true });
    await expect(group.locator('.recommended')).toHaveCount(count);
    const highlighted = await group.getByRole('button').evaluateAll((buttons) => buttons
      .map((button, index) => button.classList.contains('recommended') ? index : -1).filter((index) => index >= 0));
    expect(highlighted).toEqual(Array.from({ length: count }, (_, index) => index));
    await page.getByRole('checkbox', { name: 'Auto split', exact: true }).check();
    await expect(group.locator('.recommended')).toHaveCount(count);
    await page.getByRole('checkbox', { name: 'Auto split', exact: true }).uncheck();
  }
});

test('common-only filtering hides white choices and empty groups without changing ranking', async ({ page }) => {
  const filter = page.locator('#word-filter');
  const commonOnly = page.getByRole('checkbox', { name: 'Common words only', exact: true });
  const cutoff = page.getByRole('slider', { name: 'Frequency cutoff', exact: true });
  await expect(filter).not.toHaveAttribute('open', '');
  await filter.locator('summary').click();
  await expect(commonOnly).not.toBeChecked();
  await expect(cutoff).toHaveValue('3.5');
  await expect(page.locator('#reset-cutoff')).toBeDisabled();
  await page.locator('#number').fill('1234');
  await commonOnly.check();
  await expect(page.locator('.group-heading h3')).toHaveText(['3-digit words', '2-digit words']);
  await expect(page.locator('#options .word-choice')).toHaveCount(71);
  await expect(page.locator('#options .word-choice:not(.recommended)')).toHaveCount(0);
  for (const [code, count] of [['123', 2], ['12', 69]]) {
    const group = page.getByRole('region', { name: `${code.length}-digit words`, exact: true });
    await expect(group.locator('.word-spelling'))
      .toHaveText(dictionary.byCode[code].filter(([, , frequency]) => frequency >= 350).map(([word]) => word));
    await expect(group.locator('.group-heading p')).toHaveText(`${code} / ${count} common of ${dictionary.byCode[code].length} choices`);
  }
  await commonOnly.uncheck();
  await expect(page.locator('.group-heading h3')).toHaveText(['4-digit words', '3-digit words', '2-digit words']);
  await expect(page.locator('#options .word-choice')).toHaveCount(462);
  await expect(page.locator('#options .recommended')).toHaveCount(71);
  await expect(page.locator('#number')).toHaveValue('1234');
});

test('the cutoff slider changes highlights live and filtered empty results have a recovery action', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.locator('#number').fill('12');
  await page.locator('#word-filter > summary').click();
  const cutoff = page.getByRole('slider', { name: 'Frequency cutoff', exact: true });
  const commonOnly = page.getByRole('checkbox', { name: 'Common words only', exact: true });
  await expect(page.locator('#options .recommended')).toHaveCount(69);
  for (let step = 0; step < 5; step += 1) await cutoff.press('ArrowRight');
  await expect(cutoff).toHaveValue('4');
  await expect(cutoff).toHaveAttribute('aria-valuetext', 'Zipf 4.0');
  await expect(page.locator('#frequency-value')).toHaveText('Zipf 4.0');
  await expect(page.locator('#options .word-choice')).toHaveCount(440);
  await expect(page.locator('#options .recommended')).toHaveCount(45);
  await commonOnly.check();
  await expect(page.locator('#options .word-choice')).toHaveCount(45);
  await cutoff.press('End');
  await expect(cutoff).toHaveValue('8');
  await expect(page.locator('#options')).toBeEmpty();
  await expect(page.locator('#step-title')).toHaveText('No words at this cutoff');
  await expect(page.locator('#empty-options')).toContainText('Lower the frequency cutoff');
  await page.getByRole('button', { name: 'Show all words', exact: true }).click();
  await expect(commonOnly).not.toBeChecked();
  await expect(cutoff).toHaveValue('8');
  await expect(page.locator('#options .word-choice')).toHaveCount(440);
  await expect(page.locator('#options .recommended')).toHaveCount(0);
  await expect(page.locator('#options .word-choice').first()).toBeFocused();
  await expect(page.locator('#options .word-choice').first()).toBeInViewport({ ratio: 1 });
  await cutoff.press('Home');
  await expect(cutoff).toHaveValue('1');
  await expect(page.locator('#options .recommended')).toHaveCount(373);
  await commonOnly.check();
  await expect(page.locator('#options .word-choice')).toHaveCount(373);
  await page.getByRole('button', { name: 'Reset 3.5', exact: true }).click();
  await expect(cutoff).toHaveValue('3.5');
  await expect(cutoff).toBeFocused();
  await expect(commonOnly).toBeChecked();
  await expect(page.locator('#options .word-choice')).toHaveCount(69);
  await expect(page.locator('#reset-cutoff')).toBeDisabled();
  await expect(page.locator('#number')).toHaveValue('12');
  expect(requests).toEqual([]);
  expect(new URL(page.url()).search + new URL(page.url()).hash).toBe('');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, '']);
});

test('frequency controls preserve selections and let Auto split plan only common chunks', async ({ page }) => {
  const input = page.locator('#number');
  const split = page.getByRole('checkbox', { name: 'Auto split', exact: true });
  const commonOnly = page.getByRole('checkbox', { name: 'Common words only', exact: true });
  const cutoff = page.getByRole('slider', { name: 'Frequency cutoff', exact: true });
  await input.fill('3277');
  await choose(page, 'moon', '32').click();
  await page.locator('#word-filter > summary').click();
  await commonOnly.check();
  await expect(page.locator('#options .word-choice')).toHaveCount(14);
  await cutoff.press('End');
  await expect(page.locator('#sequence li')).toHaveText(['moon32']);
  await expect(input).toHaveValue('32 77');
  await expect(page.locator('#progress-label')).toHaveText('2 of 4 digits encoded');
  await expect(page.locator('#step-title')).toHaveText('No words at this cutoff');
  await split.check();
  await expect(page.locator('#step-title')).toHaveText('No automatic split at this cutoff');
  await expect(page.locator('#show-all-words')).toBeVisible();
  await page.getByRole('button', { name: 'Reset 3.5', exact: true }).click();
  await expect(page.locator('#options .word-choice')).toHaveCount(14);
  await page.getByRole('button', { name: 'Undo word', exact: true }).click();
  await expect(input).toHaveValue('32 77');
  await expect(page.locator('#progress-label')).toHaveText('0 of 4 digits encoded');
  await expect(page.locator('.group-heading h3')).toHaveText(['2-digit words']);
  await expect(page.locator('#options .word-choice')).toHaveCount(29);
  await expect(choose(page, 'menchaca', '3277')).toHaveCount(0);
  await cutoff.press('Home');
  await expect(input).toHaveValue('3277');
  await expect(page.locator('.group-heading h3')).toHaveText(['4-digit words']);
  await expect(choose(page, 'menchaca', '3277')).toHaveClass('word-choice recommended');
  await page.getByRole('button', { name: 'Reset 3.5', exact: true }).click();
  await choose(page, 'moon', '32').click();
  await expect(page.locator('#options .word-choice').first()).toBeInViewport({ ratio: 1 });
  await choose(page, 'cake', '77').click();
  await expect(page.locator('#step-title')).toHaveText('Your number is encoded.');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(commonOnly).toBeChecked();
  await expect(split).toBeChecked();
  await expect(cutoff).toHaveValue('3.5');
  await input.fill(' 009 20 ');
  expect((await input.inputValue()).replaceAll(' ', '')).toBe('00920');
  await expect(page.locator('#options .word-choice:not(.recommended)')).toHaveCount(0);
  await input.fill('12a');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#step-title')).toHaveText('Check your number');
  await expect(page.locator('#show-all-words')).toBeHidden();
  await expect(page.locator('#options')).toBeEmpty();
});

test('filter controls are keyboard and touch accessible without overlapping the input or sound key', async ({ page, isMobile }) => {
  await page.addStyleTag({ content: '.composer { font-family: Verdana, sans-serif; }' });
  for (const viewport of [page.viewportSize(), { width: 320, height: 568 }, { width: 375, height: 400 }]) {
    await page.setViewportSize(viewport);
    await page.locator('#number').fill('32');
    const input = await page.locator('#number').boundingBox();
    const boxes = await Promise.all([
      'label[for="number"]', 'label[for="auto-split"]', '#word-filter > summary', '#sound-key > summary'
    ].map((selector) => page.locator(selector).boundingBox()));
    for (let index = 0; index < boxes.length; index += 1) {
      expect(boxes[index].y + boxes[index].height).toBeLessThanOrEqual(input.y + 1);
      if (index) expect(boxes[index - 1].x + boxes[index - 1].width).toBeLessThanOrEqual(boxes[index].x);
    }
    const summary = page.locator('#word-filter > summary');
    if (isMobile) await summary.tap();
    else {
      await summary.focus();
      await summary.press('Enter');
    }
    await expect(page.locator('#word-filter')).toHaveAttribute('open', '');
    const panel = await page.locator('.filter-content').boundingBox();
    expect(panel.y).toBeGreaterThanOrEqual(input.y + input.height);
    expect((await page.locator('#number').boundingBox()).y).toBe(input.y);
    const cutoff = page.getByRole('slider', { name: 'Frequency cutoff', exact: true });
    await cutoff.press('ArrowRight');
    await expect(cutoff).toHaveValue('3.6');
    const activeFilter = await summary.boundingBox();
    const autoSplit = await page.locator('label[for="auto-split"]').boundingBox();
    const soundKey = await page.locator('#sound-key > summary').boundingBox();
    expect(autoSplit.x + autoSplit.width).toBeLessThanOrEqual(activeFilter.x);
    expect(activeFilter.x + activeFilter.width).toBeLessThanOrEqual(soundKey.x);
    expect((await cutoff.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expect(cutoff).toBeFocused();
    await page.getByRole('button', { name: 'Reset 3.5', exact: true }).click();
    await page.locator('#sound-key > summary').click();
    const keyPanel = await page.locator('.sound-key-content').boundingBox();
    expect(keyPanel.y).toBeGreaterThanOrEqual(panel.y + panel.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.locator('#sound-key > summary').click();
    await summary.click();
    await expect(page.locator('#word-filter')).not.toHaveAttribute('open', '');
  }
});

test('versioned assets avoid stale unversioned scripts, styles, and dictionary downloads', async ({ page }) => {
  const requests = [];
  const legacyRequests = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname + new URL(request.url()).search));
  await page.route(/\/(?:app|pao|logic|dictionary)\.js$/, (route) => {
    legacyRequests.push(route.request().url());
    return route.fulfill({ contentType: 'text/javascript', body: 'throw new Error("Stale unversioned script");' });
  });
  await page.route(/\/styles\.css$/, (route) => {
    legacyRequests.push(route.request().url());
    return route.fulfill({ contentType: 'text/css', body: 'body { display: none !important; }' });
  });
  await page.route(/\/data\/db\.(?:json|txt\.gz)$/, (route) => {
    legacyRequests.push(route.request().url());
    return route.fulfill({ body: '{}' });
  });
  await page.reload();
  await expect(page.locator('#number')).toBeEnabled();
  await page.locator('#number').fill('32');
  await expect(choose(page, 'moon', '32')).toBeVisible();
  for (const asset of ['app.js', 'logic.js', 'dictionary.js', 'styles.css', 'data/db.txt.gz']) {
    expect(requests).toContain(`/web/${asset}?v=5`);
  }
  await page.goto('/web/pao.html');
  await expect(page.locator('#pao-number')).toBeEnabled();
  await page.locator('#pao-number').fill('3277530');
  await expect(page.locator('#pao-tail .word-choice').first()).toBeVisible();
  expect(requests).toContain('/web/pao.js?v=5');
  for (const path of ['guide.html', 'sources.html']) {
    await page.goto(`/web/${path}`);
    await expect(page.getByRole('navigation', { name: 'Site', exact: true })).toBeVisible();
  }
  await page.addInitScript(() => { window.DecompressionStream = undefined; });
  await page.goto('/web/');
  await expect(page.locator('#number')).toBeEnabled();
  await page.locator('#number').fill('12');
  await page.locator('#word-filter > summary').click();
  await page.getByRole('checkbox', { name: 'Common words only', exact: true }).check();
  await expect(page.locator('#options .word-choice')).toHaveCount(69);
  expect(requests).toContain('/web/data/db.json?v=5');
  expect(legacyRequests).toEqual([]);
});

test('automatic chunking is optional and preserves choices through mode switches and undo', async ({ page, isMobile }) => {
  const input = page.locator('#number');
  const split = page.getByRole('checkbox', { name: 'Auto split', exact: true });
  await expect(split).not.toBeChecked();
  await input.fill('952147132');
  await expect(input).toHaveValue('952147132');
  if (isMobile) await split.tap();
  else {
    await split.focus();
    await page.keyboard.press('Space');
  }
  await expect(split).toBeChecked();
  await expect(input).toHaveValue('9521 471 32');
  await expect(page.locator('.group-heading h3')).toHaveText(['4-digit words']);
  expect(await page.locator('.word-choice').evaluateAll((buttons) => [...new Set(buttons.map((b) => b.dataset.code))]))
    .toEqual(['9521']);
  await choose(page, 'planet', '9521').click();
  await expect(page.locator('#sequence li')).toHaveText(['planet9521']);
  await expect(page.locator('#progress-label')).toHaveText('4 of 9 digits encoded');
  await expect(page.locator('.group-heading h3')).toHaveText(['3-digit words']);
  await expect(choose(page, 'ragtime', '4713')).toHaveCount(0);
  await split.uncheck();
  await expect(input).toHaveValue('9521 47132');
  await expect(choose(page, 'ragtime', '4713')).toBeVisible();
  await expect(page.locator('#sequence li')).toHaveText(['planet9521']);
  await split.check();
  await expect(input).toHaveValue('9521 471 32');
  await expect(page.locator('#progress-label')).toHaveText('4 of 9 digits encoded');
  await choose(page, 'rocket', '471').click();
  await expect(page.locator('.group-heading h3')).toHaveText(['2-digit words']);
  await choose(page, 'moon', '32').click();
  await expect(page.locator('#sequence li')).toHaveText(['planet9521', 'rocket471', 'moon32']);
  await expect(page.locator('#progress-label')).toHaveText('9 of 9 digits encoded');
  await expect(page.locator('#step-title')).toHaveText('Your number is encoded.');
  for (const [length, encoded] of [[2, 7], [3, 4], [4, 0]]) {
    await page.getByRole('button', { name: 'Undo word', exact: true }).click();
    await expect(page.locator('.group-heading h3')).toHaveText([`${length}-digit words`]);
    await expect(page.locator('#progress-label')).toHaveText(`${encoded} of 9 digits encoded`);
  }
  await expect(input).toHaveValue('9521 471 32');
  await expect(page.locator('#memory-thread')).toBeHidden();
  await expect(input).toBeFocused();
});

test('automatic spacing preserves cursor edits, validation, leading zeros, and Clear', async ({ page }) => {
  const input = page.locator('#number');
  const split = page.getByRole('checkbox', { name: 'Auto split', exact: true });
  await split.check();
  await input.fill('952147132');
  await input.evaluate((element) => element.setSelectionRange(5, 5));
  await input.press('Backspace');
  expect((await input.inputValue()).replaceAll(' ', '')).toBe('95247132');
  expect(await input.evaluate((element) => element.selectionStart)).toBe(3);

  await input.fill('952147132');
  await input.evaluate((element) => element.setSelectionRange(4, 4));
  await input.press('Delete');
  expect((await input.inputValue()).replaceAll(' ', '')).toBe('95217132');
  expect(await input.evaluate((element) => element.selectionStart)).toBe(4);

  await input.fill('952147132');
  await input.evaluate((element) => element.setSelectionRange(3, 7));
  await page.keyboard.insertText('0');
  expect((await input.inputValue()).replaceAll(' ', '')).toBe('9520132');
  expect(await input.evaluate((element) => element.value.slice(0, element.selectionStart).replaceAll(' ', '').length)).toBe(4);

  await input.fill('952147132');
  await choose(page, 'planet', '9521').click();
  await input.fill('12a');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#sequence')).toBeEmpty();
  await expect(page.locator('#options')).toBeEmpty();
  await expect(page.locator('#input-error')).toHaveText('Use digits and spaces only.');
  await input.fill(' 009 20 ');
  expect((await input.inputValue()).replaceAll(' ', '')).toBe('00920');
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(split).toBeChecked();
  await expect(page.locator('.options-area')).toBeHidden();
  await input.fill('0');
  await expect(page.locator('.group-heading h3')).toHaveText(['1-digit words']);
  await choose(page, 'ice', '0').click();
  await expect(page.locator('#step-title')).toHaveText('Your number is encoded.');
});

test('automatic chunking supports long numbers without changing their digits', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'Auto split', exact: true }).check();
  const input = page.locator('#number');
  const digits = '00920'.repeat(2000);
  await input.fill(digits);
  expect((await input.inputValue()).replaceAll(' ', '')).toBe(digits);
  const nextWord = page.locator('.word-choice').first();
  const code = await nextWord.getAttribute('data-code');
  expect(code.length).toBeGreaterThanOrEqual(2);
  expect(code.length).toBeLessThanOrEqual(4);
  await nextWord.click();
  await expect(page.locator('#progress-label')).toHaveText(`${code.length} of ${digits.length} digits encoded`);
  expect((await input.inputValue()).replaceAll(' ', '')).toBe(digits);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
});

test('unavailable automatic splits explain the problem without silently changing modes', async ({ page }) => {
  await page.addInitScript(() => { window.DecompressionStream = undefined; });
  await page.route('**/data/db.json*', (route) => route.fulfill({
    json: {
      version: 5, source: { pairCount: 1, codeCount: 1, maxCodeLength: 5 },
      byCode: { '12345': [['example', 'n', 350]] }
    }
  }));
  await page.reload();
  const input = page.locator('#number');
  await expect(input).toBeEnabled();
  await input.fill('12345');
  await expect(choose(page, 'example', '12345')).toBeVisible();
  const split = page.getByRole('checkbox', { name: 'Auto split', exact: true });
  await split.check();
  await expect(input).toHaveValue('12345');
  await expect(split).toBeChecked();
  await expect(page.locator('#step-title')).toHaveText('No automatic split available');
  await expect(page.locator('#empty-options')).toContainText('Turn off Auto split to see all word lengths');
  await expect(page.locator('#options')).toBeEmpty();
  await split.uncheck();
  await choose(page, 'example', '12345').click();
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
  const split = await page.locator('label[for="auto-split"]').boundingBox();
  const keyToggle = await toggle.boundingBox();
  expect(split.x + split.width).toBeLessThanOrEqual(keyToggle.x);
  expect(split.y + split.height).toBeLessThanOrEqual(closedInput.y);
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

test('all pages keep the same compact menu with current-page and external-site indicators', async ({ page }) => {
  for (const [viewport, wideFont] of [
    [page.viewportSize(), false], [{ width: 320, height: 568 }, false], [{ width: 320, height: 568 }, true]
  ]) {
    await page.setViewportSize(viewport);
    let headerBounds;
    for (const [path, currentPage] of [
      ['index.html', 'DigitLoom'], ['pao.html', 'PAO'], ['guide.html', 'How it works'], ['sources.html', 'Data & licenses']
    ]) {
      await page.goto(`/web/${path}`);
      if (wideFont) await page.addStyleTag({ content: 'nav { font-family: Verdana, sans-serif; }' });
      const menu = page.getByRole('navigation', { name: 'Site', exact: true });
      const items = menu.locator(':scope > *');
      await expect(items).toHaveText(['DigitLoom', 'PAO', 'How it works', 'Data & licenses', 'GitHub \u2197']);
      const current = menu.locator('[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText(currentPage);
      await expect(current).not.toHaveAttribute('href');
      await expect(menu.getByRole('link', { name: currentPage, exact: true })).toHaveCount(0);
      if (currentPage !== 'PAO') await expect(menu.getByRole('link', { name: 'PAO', exact: true })).toHaveAttribute('href', 'pao.html');
      expect(await current.evaluate((element) => element.tabIndex)).toBe(-1);
      expect(await current.evaluate((element) => Number(getComputedStyle(element).fontWeight))).toBeGreaterThanOrEqual(700);
      const github = menu.getByRole('link', { name: 'GitHub', exact: true });
      await expect(github).toHaveAttribute('href', 'https://github.com/certik/digitloom');
      await expect(github).toHaveAccessibleDescription('External site');
      await expect(github.locator('[aria-hidden="true"]')).toBeVisible();
      await github.focus();
      await expect(github).toBeFocused();
      const bounds = await page.locator('.site-header').boundingBox();
      expect(bounds.y).toBe(0);
      expect(bounds.height).toBeLessThanOrEqual(70);
      if (headerBounds) expect(bounds).toEqual(headerBounds);
      headerBounds = bounds;
      for (const item of await items.all()) {
        await expect(item).toBeInViewport({ ratio: 1 });
        const box = await item.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(bounds.x);
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(box.y + box.height / 2).toBeCloseTo(bounds.y + (bounds.height - 1) / 2, 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    }
  }
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
    await page.getByRole('link', { name: 'DigitLoom', exact: true }).click();
    await expect(page.locator('#number')).toBeEnabled();
    await page.getByRole('navigation', { name: 'Site', exact: true })
      .getByRole('link', { name: 'Data & licenses', exact: true }).click();
    await expect(page).toHaveTitle('Data & licenses - DigitLoom');
    await page.getByRole('link', { name: 'DigitLoom', exact: true }).click();
    await expect(page.locator('#number')).toBeEnabled();
    await page.getByRole('navigation', { name: 'Site', exact: true })
      .getByRole('link', { name: 'PAO', exact: true }).click();
    await expect(page).toHaveTitle('PAO scenes - DigitLoom');
    await expect(page.getByRole('link', { name: 'GitHub', exact: true }))
      .toHaveAttribute('href', 'https://github.com/certik/digitloom');
    await expect(page.locator('#pao-number')).toBeEnabled();
    await page.getByRole('link', { name: 'DigitLoom', exact: true }).click();
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
  expect((await response.body()).length).toBeLessThan(650_000);
});

test('browsers without a native decompressor use JSON and can complete a thread', async ({ page }) => {
  await page.addInitScript(() => { window.DecompressionStream = undefined; });
  const requests = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.reload();
  await expect(page.locator('#number')).toBeEnabled();
  expect(requests.filter((path) => path.includes('/data/'))).toEqual(['/web/data/db.json']);
  await page.locator('#number').fill('3277');
  await expect(choose(page, 'moon', '32')).toHaveClass('word-choice recommended');
  await expect(choose(page, 'menchaca', '3277')).toHaveClass('word-choice');
  await choose(page, 'moon', '32').click();
  await choose(page, 'cake', '77').click();
  await expect(page.locator('#step-title')).toHaveText('Your number is encoded.');
});

test('already-decoded responses and HTTP Content-Encoding gzip are both accepted', async ({ page }) => {
  const packed = await readFile(new URL('../web/data/db.txt.gz', import.meta.url));
  for (const decoded of [true, false]) {
    await page.route('**/data/db.txt.gz*', (route) => route.fulfill({
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
  await page.route('**/data/db.txt.gz*', async (route) => { await wait; await route.abort(); });
  await page.reload();
  await expect(page.locator('#number')).toBeDisabled();
  await expect(page.locator('#library-status')).toHaveText('Opening the word library...');
  resume();
  await expect(page.locator('#library-error')).toContainText('DigitLoom could not open its word library');
  const requests = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  for (const body of ['{', '{}', Buffer.from([0x1f, 0x8b, 0x08, 0x00])]) {
    await page.route('**/data/db.txt.gz*', (route) => route.fulfill({ body }));
    await page.reload();
    await expect(page.locator('#number')).toBeDisabled();
    await expect(page.locator('#library-error')).toBeVisible();
  }
  expect(requests).not.toContain('/web/data/db.json');
});

test('empty dictionaries explain missing prefixes without invented suggestions', async ({ page }) => {
  await page.route('**/data/db.txt.gz*', (route) => route.fulfill({
    body: JSON.stringify({
      format: 'digitloom-columns', version: 2, dictionaryVersion: 5,
      source: { pairCount: 0, codeCount: 0, maxCodeLength: 0 }, codes: [], counts: []
    }) + '\n\n\n'
  }));
  await page.reload();
  await expect(page.locator('#number')).toBeEnabled();
  await page.locator('#number').fill('99');
  await expect(page.locator('#step-title')).toHaveText('No words for this prefix');
  await expect(page.locator('#options')).toBeEmpty();
  await expect(page.locator('#empty-options')).toContainText('Undo a choice or try a different number');
});

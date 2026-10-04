import { test, expect } from '@playwright/test';

const example = [
  ['harmless', '4350'], ['unhappy', '29'], ['merely', '345'],
  ['naomi', '23'], ['russel', '405'], ['buck', '97']
];
const target = example.map(([, code]) => code).join('');
const choose = (page, word, code) => page.getByRole('button', { name: `Choose ${word} (${code})`, exact: true });
const edit = (page, word, code) => page.getByRole('button', { name: `Edit ${word} (${code})`, exact: true });
const placements = (page) => page.locator('#sequence .thread-word').evaluateAll((buttons) => buttons.map((button) => ({
  id: button.dataset.wordId, start: button.dataset.start, end: button.dataset.end,
  word: button.firstChild.textContent, code: button.querySelector('small').textContent
})));
const anchors = (words) => words.filter(({ word }) => ['harmless', 'russel', 'buck'].includes(word));
const problems = new WeakMap();

async function buildExample(page) {
  await page.locator('#number').fill(target);
  for (const [word, code] of example) await choose(page, word, code).click();
  await expect(page.locator('#step-title')).toHaveText('Your number is encoded.');
}

async function changeLength(page, fromWord, fromCode, toWord, toCode) {
  await edit(page, fromWord, fromCode).click();
  await page.getByRole('button', { name: 'Other lengths', exact: true }).click();
  await expect(page.locator('#other-lengths > summary')).toBeFocused();
  await choose(page, toWord, toCode).click();
}

test.beforeEach(async ({ page }) => {
  const failures = [];
  problems.set(page, failures);
  page.on('pageerror', (failure) => failures.push(failure.message));
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const local = ['http://127.0.0.1:4173', 'http://127.0.0.1:4174'].includes(url.origin);
    const asset = (url.search === '?v=5' && /\/(?:logic\.js|dictionary\.js|data\/db\.(?:json|txt\.gz))$/.test(url.pathname)) ||
      (url.search === '?v=6' && /\/(?:app\.js|styles\.css)$/.test(url.pathname)) ||
      (url.search === '?v=1' && /\/word-thread\.js$/.test(url.pathname));
    if (!local || request.method() !== 'GET' || (url.search && !asset)) {
      failures.push(`Unexpected request: ${request.method()} ${request.url()}`);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto('/web/');
  await expect(page.locator('#number')).toBeEnabled();
});

test.afterEach(async ({ page }) => {
  expect(problems.get(page)).toEqual([]);
  expect(await page.evaluate(() => ({
    local: localStorage.length, session: sessionStorage.length, search: location.search, hash: location.hash
  }))).toEqual({ local: 0, session: 0, search: '', hash: '' });
});

test('same-length replacements and Undo change retain every other placement', async ({ page }) => {
  await buildExample(page);
  const original = await placements(page);
  await edit(page, 'unhappy', '29').click();
  await expect(page.locator('#word-editor-title')).toBeFocused();
  await expect(page.locator('#word-editor-range')).toHaveText('Matching: 29 (digits 5-6).');
  await expect(page.locator('#options h3')).toHaveText(['2-digit words']);
  await expect(page.locator('#other-lengths')).not.toHaveAttribute('open', '');
  await expect(page.locator('#options .word-choice').first()).toBeInViewport({ ratio: 1 });
  await choose(page, 'nap', '29').click();
  await expect(edit(page, 'nap', '29')).toBeFocused();
  const changed = await placements(page);
  expect(changed.filter(({ id }) => id !== original[1].id)).toEqual(original.filter(({ id }) => id !== original[1].id));
  expect(changed[1]).toEqual({ ...original[1], word: 'nap' });
  await expect(page.locator('#word-editor')).toBeHidden();
  await expect(page.locator('#coverage-panel')).toBeHidden();
  await expect(page.locator('#step-title')).toHaveText('Your number is encoded.');
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  expect(await placements(page)).toEqual(original);
  await expect(edit(page, 'unhappy', '29')).toBeFocused();
  await edit(page, 'unhappy', '29').click();
  await choose(page, 'unhappy', '29').click();
  await expect(page.locator('#undo')).toHaveText('Undo word');
  expect(await placements(page)).toEqual(original);
});

test('longer replacements show exact overlaps, with fitting only on explicit request', async ({ page }) => {
  await buildExample(page);
  const original = await placements(page);
  await changeLength(page, 'unhappy', '29', 'niobium', '293');
  const overlapping = await placements(page);
  expect(anchors(overlapping)).toEqual(anchors(original));
  expect(overlapping[2]).toEqual(original[2]);
  await expect(page.locator('#number')).toHaveValue('4350 29345 23 405 97');
  await expect(page.locator('#progress-label')).toHaveText('15 of 16 digits covered once');
  await expect(page.locator('#step-title')).toHaveText('Resolve overlapping words');
  await expect(page.locator('#coverage-summary')).toContainText('1 digit overlapping');
  await expect(page.locator('.thread-word.has-overlap')).toHaveCount(2);
  await expect(page.locator('.coverage-digit.is-overlapping')).toHaveAttribute('aria-label', 'Digit 7: 3, shared by 2 words');

  await edit(page, 'merely', '345').click();
  await expect(page.locator('#word-editor-range')).toHaveText('Matching: 345 (digits 7-9).');
  await expect(page.locator('#options h3')).toHaveText(['3-digit words']);
  await page.getByRole('button', { name: 'Fit between neighbors: 45', exact: true }).click();
  await expect(page.locator('#word-editor-range')).toHaveText('Fit preview: 45 (digits 8-9).');
  expect(await placements(page)).toEqual(overlapping);
  await page.getByRole('button', { name: 'Use current position', exact: true }).click();
  await expect(page.locator('#word-editor-range')).toHaveText('Matching: 345 (digits 7-9).');
  await page.getByRole('button', { name: 'Fit between neighbors: 45', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await placements(page)).toEqual(overlapping);
  await expect(edit(page, 'merely', '345')).toBeFocused();

  await edit(page, 'merely', '345').click();
  await page.getByRole('button', { name: 'Fit between neighbors: 45', exact: true }).click();
  await choose(page, 'real', '45').click();
  const repaired = await placements(page);
  expect(anchors(repaired)).toEqual(anchors(original));
  expect(repaired[2]).toEqual({ ...original[2], start: '7', word: 'real', code: '45' });
  expect(repaired[3]).toEqual(original[3]);
  await expect(page.locator('#number')).toHaveValue('4350 293 45 23 405 97');
  await expect(page.locator('#progress-label')).toHaveText('16 of 16 digits encoded');
  await expect(page.locator('#step-title')).toHaveText('Your number is encoded.');
  await expect(page.locator('#coverage-panel')).toBeHidden();
  await expect(page.locator('.thread-word.has-overlap')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  expect(await placements(page)).toEqual(overlapping);
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  expect(await placements(page)).toEqual(original);
});

test('shortening leaves a one-digit gap that can be filled, removed, and undone locally', async ({ page }) => {
  await buildExample(page);
  const original = await placements(page);
  await changeLength(page, 'unhappy', '29', 'no', '2');
  await expect(page.locator('#number')).toHaveValue('4350 2 9 345 23 405 97');
  await expect(page.locator('#coverage-summary')).toContainText('1 digit unassigned');
  await expect(page.locator('#progress-label')).toHaveText('15 of 16 digits encoded');
  await expect(page.locator('.coverage-digit.is-unassigned')).toHaveAttribute('aria-label', 'Digit 6: 9, unassigned');
  await page.getByRole('button', { name: 'Add word for unassigned digit 6', exact: true }).click();
  await expect(page.locator('#word-editor-title')).toHaveText('Fill unassigned digits');
  await expect(page.locator('#options h3')).toHaveText(['1-digit words']);
  await choose(page, 'bee', '9').click();
  const filled = await placements(page);
  expect(anchors(filled)).toEqual(anchors(original));
  expect(filled.map(({ word }) => word)).toEqual(['harmless', 'no', 'bee', 'merely', 'naomi', 'russel', 'buck']);
  expect(filled[3]).toEqual(original[2]);
  await expect(page.locator('#step-title')).toHaveText('Your number is encoded.');
  await edit(page, 'bee', '9').click();
  await page.getByRole('button', { name: 'Remove word', exact: true }).click();
  await expect(page.locator('.thread-gap')).toBeFocused();
  await expect(page.locator('#coverage-summary')).toContainText('1 digit unassigned');
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  expect(await placements(page)).toEqual(filled);
  await page.getByRole('button', { name: 'Undo word', exact: true }).click();
  await expect(page.locator('.thread-gap')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  expect(await placements(page)).toEqual(original);
});

test('a wholly overlapped word can be removed when there is no space between neighbors', async ({ page }) => {
  const byCode = Object.fromEntries([...example, ['longer', '29345']].map(([word, code]) => [code, [[word, 'n', 400]]]));
  await page.addInitScript(() => { window.DecompressionStream = undefined; });
  await page.route('**/data/db.json?v=5', (route) => route.fulfill({
    json: { version: 5, source: { maxCodeLength: 5, codeCount: 7, pairCount: 7 }, byCode }
  }));
  await page.reload();
  await expect(page.locator('#number')).toBeEnabled();
  await buildExample(page);
  const original = await placements(page);
  await changeLength(page, 'unhappy', '29', 'longer', '29345');
  await expect(page.locator('#coverage-summary')).toContainText('3 digits overlapping');
  await edit(page, 'merely', '345').click();
  await expect(page.getByRole('button', { name: 'No space between neighbors', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove word', exact: true }).click();
  expect(anchors(await placements(page))).toEqual(anchors(original));
  await expect(page.locator('#sequence .thread-word')).toHaveCount(5);
  await expect(page.locator('#step-title')).toHaveText('Your number is encoded.');
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  await expect(edit(page, 'merely', '345')).toBeVisible();
  await expect(page.locator('#coverage-summary')).toContainText('3 digits overlapping');
});

test('a fit preview with no full-span word explains the alternative lengths without changing the thread', async ({ page }) => {
  const byCode = Object.fromEntries(example.map(([word, code]) => [code, [[word, 'n', 400]]]));
  await page.addInitScript(() => { window.DecompressionStream = undefined; });
  await page.route('**/data/db.json?v=5', (route) => route.fulfill({
    json: { version: 5, source: { maxCodeLength: 4, codeCount: 6, pairCount: 6 }, byCode }
  }));
  await page.reload();
  await expect(page.locator('#number')).toBeEnabled();
  await buildExample(page);
  await edit(page, 'russel', '405').click();
  await page.getByRole('button', { name: 'Remove word', exact: true }).click();
  const before = await placements(page);
  await edit(page, 'naomi', '23').click();
  await page.getByRole('button', { name: 'Fit between neighbors: 23405', exact: true }).click();
  await expect(page.locator('#step-title')).toHaveText('No 5-digit replacements');
  await expect(page.locator('#empty-options')).toContainText('Try another length');
  await expect(page.locator('#other-lengths')).toHaveAttribute('open', '');
  await expect(page.locator('#other-lengths > p')).toContainText('Replace naomi starting at digit 10');
  expect(await placements(page)).toEqual(before);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await placements(page)).toEqual(before);
});

test('filters apply during editing but Auto split does not restrict replacement lengths', async ({ page }) => {
  await buildExample(page);
  const original = await placements(page);
  await page.locator('#auto-split').check();
  await edit(page, 'unhappy', '29').click();
  await page.locator('#word-filter > summary').click();
  await page.locator('#common-only').check();
  expect(await placements(page)).toEqual(original);
  await page.locator('#other-lengths > summary').click();
  await expect(choose(page, 'niobium', '293')).toHaveCount(0);
  await page.locator('#common-only').uncheck();
  await expect(choose(page, 'niobium', '293')).toBeVisible();
  await page.locator('#common-only').check();
  await choose(page, 'no', '2').click();
  await page.getByRole('button', { name: 'Add word for unassigned digit 6', exact: true }).click();
  await page.locator('#frequency-cutoff').fill('8');
  await expect(page.locator('#step-title')).toHaveText('No words at this cutoff');
  await expect(page.locator('#sequence .thread-word')).toHaveCount(6);
  await page.getByRole('button', { name: 'Show all words', exact: true }).click();
  await expect(page.locator('#common-only')).not.toBeChecked();
  await expect(page.locator('#frequency-cutoff')).toHaveValue('8');
  await expect(page.locator('#options .word-choice').first()).toBeFocused();
  await choose(page, 'bee', '9').click();
  await expect(page.locator('#auto-split')).toBeChecked();
  expect(anchors(await placements(page))).toEqual(anchors(original));
  await expect(page.locator('#step-title')).toHaveText('Your number is encoded.');
});

test('long inputs retain leading zeros with bounded coverage and undo after removing the only word', async ({ page }) => {
  const digits = '00920'.repeat(2000);
  await page.locator('#number').fill(digits);
  await choose(page, 'says', '00').click();
  await edit(page, 'says', '00').click();
  await expect(page.locator('#coverage-digits li')).toHaveCount(48);
  await expect(page.locator('#coverage-window')).toHaveText('Digits 1-48 of 10000');
  await page.getByRole('button', { name: 'Later digits', exact: true }).click();
  await expect(page.locator('#coverage-window')).toHaveText('Digits 49-96 of 10000');
  await expect(page.locator('#coverage-digits li')).toHaveCount(48);
  expect((await page.locator('#number').inputValue()).replaceAll(' ', '')).toBe(digits);
  await page.getByRole('button', { name: 'Earlier digits', exact: true }).click();
  await expect(page.locator('#coverage-window')).toBeFocused();
  await page.getByRole('button', { name: 'Remove word', exact: true }).click();
  await expect(page.locator('#sequence .thread-word')).toHaveCount(0);
  await expect(page.locator('#memory-thread')).toBeVisible();
  await expect(page.locator('.thread-gap')).toContainText('Unassigned 10,000 digits');
  await expect(page.locator('#undo')).toBeEnabled();
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  await expect(edit(page, 'says', '00')).toBeFocused();
  await expect(page.locator('#progress-label')).toHaveText('2 of 10000 digits encoded');
  expect((await page.locator('#number').inputValue()).replaceAll(' ', '')).toBe(digits);
});

test('coverage paging reaches the final partial window and returns to the previous digits', async ({ page }) => {
  const digits = '00'.repeat(25);
  await page.locator('#number').fill(digits);
  await choose(page, 'says', '00').click();
  await edit(page, 'says', '00').click();
  await page.getByRole('button', { name: 'Later digits', exact: true }).click();
  await expect(page.locator('#coverage-window')).toHaveText('Digits 49-50 of 50');
  await expect(page.locator('#coverage-digits li')).toHaveCount(2);
  await expect(page.locator('#later-digits')).toBeDisabled();
  await page.getByRole('button', { name: 'Earlier digits', exact: true }).click();
  await expect(page.locator('#coverage-window')).toHaveText('Digits 1-48 of 50');
  await expect(page.locator('#coverage-digits li')).toHaveCount(48);
  await expect(page.locator('#earlier-digits')).toBeDisabled();
  expect((await page.locator('#number').inputValue()).replaceAll(' ', '')).toBe(digits);
});

test('missing same-length common words have an explicit recovery without hiding other lengths', async ({ page }) => {
  await buildExample(page);
  await changeLength(page, 'unhappy', '29', 'niobium', '293');
  const before = await placements(page);
  await page.locator('#word-filter > summary').click();
  await page.locator('#common-only').check();
  await edit(page, 'niobium', '293').click();
  await expect(page.locator('#step-title')).toHaveText('No 3-digit replacements at this cutoff');
  await expect(page.locator('#other-lengths')).toHaveAttribute('open', '');
  await expect(page.locator('#other-options .word-choice').first()).toBeVisible();
  await expect(choose(page, 'niobium', '293')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show all words', exact: true }).click();
  await expect(page.locator('#options h3')).toHaveText(['3-digit words']);
  await expect(choose(page, 'niobium', '293')).toBeVisible();
  await expect(choose(page, 'niobium', '293')).not.toHaveClass(/recommended/);
  expect(await placements(page)).toEqual(before);
});

test('separate gaps can be repaired in any order without changing surrounding words', async ({ page }) => {
  await buildExample(page);
  const original = await placements(page);
  for (const [word, code] of [example[1], example[3]]) {
    await edit(page, word, code).click();
    await page.getByRole('button', { name: 'Remove word', exact: true }).click();
  }
  await expect(page.locator('.thread-gap')).toHaveCount(2);
  await expect(page.locator('#coverage-summary')).toContainText('4 digits unassigned');
  await page.getByRole('button', { name: 'Add word for unassigned digits 10-11', exact: true }).click();
  await expect(page.locator('#word-editor-range')).toHaveText('Matching: 23 (digits 10-11).');
  await choose(page, 'name', '23').click();
  await expect(page.locator('.thread-gap')).toHaveCount(1);
  await page.getByRole('button', { name: 'Add word for unassigned digits 5-6', exact: true }).click();
  await choose(page, 'nap', '29').click();
  expect(anchors(await placements(page))).toEqual(anchors(original));
  expect((await placements(page)).find(({ word }) => word === 'merely')).toEqual(original[2]);
  await expect(page.locator('#step-title')).toHaveText('Your number is encoded.');
  await expect(page.locator('#number')).toHaveValue('4350 29 345 23 405 97');
});

test('replacement actions and first choices fit short narrow screens without horizontal scrolling', async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 400 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => { document.documentElement.style.fontFamily = 'Verdana, sans-serif'; });
    await page.locator('#number').fill('3277');
    await choose(page, 'moon', '32').click();
    await choose(page, 'cake', '77').click();
    await edit(page, 'moon', '32').click();
    await expect(page.locator('#word-editor-title')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#cancel-word-edit')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#remove-word')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#show-other-lengths')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#options .word-choice').first()).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.keyboard.press('Escape');
    await expect(edit(page, 'moon', '32')).toBeFocused();
  }
});

test('editing works by keyboard and touch on root and subpath hosting, and typing resets it', async ({ page }, testInfo) => {
  for (const url of ['/web/', 'http://127.0.0.1:4174/']) {
    await page.goto(url);
    await expect(page.locator('#number')).toBeEnabled();
    await page.locator('#number').fill('3277');
    await choose(page, 'moon', '32').click();
    await choose(page, 'cake', '77').click();
    const button = edit(page, 'moon', '32');
    if (testInfo.project.use.hasTouch) await button.tap();
    else {
      await button.focus();
      await button.press('Enter');
    }
    await expect(page.locator('#word-editor-title')).toBeFocused();
    await choose(page, 'man', '32').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#word-editor')).toBeHidden();
    await expect(button).toBeFocused();
    await button.click();
    await page.setViewportSize({ width: 320, height: 568 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.locator('#number').fill('12a');
    await expect(page.locator('#number')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#word-editor')).toBeHidden();
    await expect(page.locator('#coverage-panel')).toBeHidden();
    await expect(page.locator('#other-lengths')).toBeHidden();
    await expect(page.locator('#sequence')).toBeEmpty();
    await expect(page.locator('#undo')).toBeDisabled();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.locator('#number')).toBeFocused();
  }
});

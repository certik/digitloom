import { loadDictionary } from './dictionary.js';
import { getCandidates, normalizeInput, partOfSpeechLabel } from './logic.js';
import {
  PAO_ROLES, PROFILE_LIMITS, createBlankProfile, encodePao, findDuplicates, parseProfile, serializeProfile
} from './pao-logic.js';

const SCENES_PER_PAGE = 50;
const ISSUE_PREVIEW = 8;
const IDEA_PREVIEW = 24;
const EXPORT_FILENAME = 'digitloom-pao.json';
const FIELDS = ['peg', ...PAO_ROLES];
const LABELS = { peg: 'Peg', person: 'Person', action: 'Action', object: 'Object' };
const CONTROLS = /[\p{Cc}\u2028\u2029]/gu;

const byId = (id) => document.getElementById(id);
const number = byId('pao-number');
const clearButton = byId('pao-clear');
const openEditorButton = byId('open-editor');
const inputError = byId('pao-input-error');
const tableInUse = byId('table-in-use');
const loadStatus = byId('table-load-status');
const loadError = byId('table-load-error');
const loadErrorText = byId('table-load-error-text');
const retryStarter = byId('retry-starter');
const output = byId('pao-output');
const stepTitle = byId('pao-step-title');
const emptyHint = byId('pao-empty');
const progressRow = byId('pao-progress');
const progressBar = byId('pao-progress-bar');
const progressLabel = byId('pao-progress-label');
const issuesBox = byId('pao-issues');
const issueList = byId('pao-issue-list');
const issuesMore = byId('pao-issues-more');
const sceneCount = byId('scene-count');
const sceneList = byId('pao-scenes');
const moreScenes = byId('more-scenes');
const tailSection = byId('pao-tail');
const tailTitle = byId('tail-title');
const tailChosen = byId('tail-chosen');
const tailWord = byId('tail-word');
const tailCode = byId('tail-code');
const undoTail = byId('undo-tail');
const tailStatus = byId('tail-status');
const tailError = byId('tail-error');
const tailErrorText = byId('tail-error-text');
const tailRetry = byId('tail-retry');
const tailOptions = byId('tail-options');
const tableSummary = byId('table-summary');
const newTable = byId('new-table');
const restoreStarter = byId('restore-starter');
const importTable = byId('import-table');
const exportTable = byId('export-table');
const importFile = byId('import-file');
const tableMessage = byId('table-message');
const tableError = byId('table-error');
const editor = byId('table-editor');
const tableName = byId('table-name');
const tableNameError = byId('table-name-error');
const tableLicense = byId('table-license');
const tableAttribution = byId('table-attribution');
const search = byId('table-search');
const filter = byId('table-filter');
const filterCount = byId('filter-count');
const duplicateSummary = byId('duplicate-summary');
const duplicateList = byId('duplicate-list');
const rows = byId('pao-rows');
const noRows = byId('no-rows');
const replaceDialog = byId('replace-dialog');
const replaceText = byId('replace-text');

// The working table exists only in memory; savedState marks its last opened or exported form.
let profile = null;
let savedState = '';
let starterText = null;
let starterLoading = false;
let loadFailure = '';
// Each table choice or starter attempt gets a new number; work from an older one is dropped when it settles.
let tableOperation = 0;
let digits = '';
let inputProblem = '';
let result = null;
let tail = null;
let allEndings = false;
let sceneLimit = SCENES_PER_PAGE;
let allIssues = false;
let duplicates = [];
let duplicateCells = new Map();
let dictionary = null;
let dictionaryPromise = null;
let dictionaryFailure = '';
let openIdeas = '';
let allIdeas = false;
let outputFrame = 0;
let leaveGuard = false;
const rowElements = new Map();

const formatCount = (count) => count.toLocaleString('en-US');
const plural = (count, one, many = `${one}s`) => `${formatCount(count)} ${count === 1 ? one : many}`;
const quoted = (value) => `\u201c${value}\u201d`;
const isBlank = (value) => typeof value !== 'string' || value.trim() === '';
const cellKey = (field, code) => `${field}:${code}`;
const cellId = (code, field) => `pao-${code}-${field}`;
const fold = (value) => value.normalize('NFC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
const displayName = () => (isBlank(profile?.name) ? 'Untitled table' : profile.name);

function sentence(message) {
  const text = String(message ?? '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function listCodes(codes) {
  if (codes.length < 3) return codes.join(' and ');
  return `${codes.slice(0, -1).join(', ')}, and ${codes.at(-1)}`;
}

function hiddenText(text) {
  const span = document.createElement('span');
  span.className = 'visually-hidden';
  span.textContent = text;
  return span;
}

function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('The file is not UTF-8 text.');
  }
}

function requestDictionary({ retry = false } = {}) {
  if (dictionary || dictionaryPromise || (dictionaryFailure && !retry)) return;
  dictionaryFailure = '';
  dictionaryPromise = loadDictionary()
    .then((loaded) => { dictionary = loaded; }, (failure) => { dictionaryFailure = sentence(failure.message); })
    .finally(() => {
      dictionaryPromise = null;
      const waitingForEnding = document.activeElement === tailStatus;
      renderTail();
      if (waitingForEnding) (tailOptions.querySelector('button') ?? (tailError.hidden ? tailStatus : tailRetry)).focus();
      renderIdeas();
    });
}

function dictionaryProblem() {
  return `DigitLoom could not open its word library. ${dictionaryFailure} Check that the data files are served with the app.`;
}

function snapshot() {
  return JSON.stringify(profile);
}

function isDirty() {
  return Boolean(profile) && snapshot() !== savedState;
}

function warnBeforeLeaving(event) {
  event.preventDefault();
  event.returnValue = '';
}

function countComplete() {
  return profile.entries.filter((entry) => PAO_ROLES.every((role) => !isBlank(entry[role]))).length;
}

function updateTableSummary(dirty = isDirty()) {
  if (!profile) {
    tableSummary.textContent = starterLoading ? 'Opening the starter table...'
      : 'No table is open. Start a new blank table, restore the starter, or import a table.';
    return;
  }
  const name = document.createElement('span');
  name.className = 'table-name';
  name.textContent = displayName();
  const details = [`${countComplete()} of 100 codes complete`];
  if (duplicates.length) details.push(plural(duplicates.length, 'duplicate'));
  details.push(dirty ? 'changes not exported' : 'no unexported changes');
  tableSummary.replaceChildren(name, ` \u00b7 ${details.join(' \u00b7 ')}`);
}

function updateDirty() {
  const dirty = isDirty();
  if (dirty !== leaveGuard) {
    leaveGuard = dirty;
    if (dirty) window.addEventListener('beforeunload', warnBeforeLeaving);
    else window.removeEventListener('beforeunload', warnBeforeLeaving);
  }
  updateTableSummary(dirty);
}

function renderLoadState() {
  const ready = Boolean(profile);
  loadStatus.classList.toggle('visually-hidden', ready || Boolean(loadFailure));
  loadStatus.textContent = ready ? `${displayName()} is ready.`
    : starterLoading ? 'Opening the starter table...'
      : loadFailure ? 'Starter table unavailable.' : 'No table is open yet.';
  loadError.hidden = ready || !loadFailure;
  loadErrorText.textContent = loadFailure
    ? `DigitLoom could not open its starter PAO table. ${loadFailure} Try again, or use New blank table or Import table below.`
    : '';
  retryStarter.disabled = starterLoading;
  restoreStarter.disabled = starterLoading;
  number.disabled = !ready;
  openEditorButton.disabled = !ready;
  exportTable.disabled = !ready;
  editor.hidden = !ready;
  tableInUse.textContent = ready ? `Using table ${quoted(displayName())}.` : '';
  updateTableSummary();
}

function clearTableFeedback() {
  tableMessage.textContent = '';
  tableError.hidden = true;
  tableError.textContent = '';
}

function showTableMessage(message) {
  tableError.hidden = true;
  tableError.textContent = '';
  tableMessage.textContent = message;
}

function showTableError(message) {
  tableMessage.textContent = '';
  tableError.textContent = message;
  tableError.hidden = false;
}

function encodeAndRender() {
  result = profile && !inputProblem ? encodePao(profile, digits) : null;
  renderOutput();
}

function scheduleOutput() {
  if (outputFrame) return;
  outputFrame = requestAnimationFrame(() => {
    outputFrame = 0;
    encodeAndRender();
  });
}

function exampleHint() {
  const sample = [['32', 'person'], ['77', 'action'], ['53', 'object']]
    .map(([code, role]) => profile.entries[Number(code)][role]);
  if (sample.every((value) => !isBlank(value))) return `Try 327753: ${sample.map((value) => value.trim()).join(' / ')}.`;
  return 'Type a number to see its scenes and which associations they still need.';
}

function renderOutput() {
  const ready = Boolean(profile);
  const total = digits.length;
  inputError.hidden = !inputProblem;
  inputError.textContent = inputProblem;
  number.setAttribute('aria-invalid', String(Boolean(inputProblem)));
  clearButton.disabled = !ready || number.value.length === 0;
  output.hidden = !ready;
  if (!ready) return;

  const pairs = result?.pairCount ?? 0;
  const resolved = result?.resolvedPairCount ?? 0;
  const issues = result?.issues ?? [];
  const trailing = result?.trailingDigit ?? '';
  const encoded = resolved * 2 + (trailing && tail ? 1 : 0);
  const complete = total > 0 && resolved === pairs && !issues.length && (!trailing || Boolean(tail));

  progressRow.hidden = total === 0;
  progressBar.max = Math.max(total, 1);
  progressBar.value = encoded;
  progressLabel.textContent = total ? `${formatCount(encoded)} of ${formatCount(total)} digits encoded` : 'No digits yet';

  if (inputProblem) stepTitle.textContent = 'Check your number';
  else if (!total) stepTitle.textContent = 'Type digits to begin';
  else if (complete) stepTitle.textContent = 'Your number is encoded.';
  else if (issues.length) stepTitle.textContent = `${formatCount(issues.length)} ${issues.length === 1 ? 'association needs' : 'associations need'} attention`;
  else stepTitle.textContent = 'Choose a word for the final digit';

  emptyHint.hidden = total > 0 && !inputProblem;
  emptyHint.textContent = inputProblem ? 'Replace letters or punctuation with digits to see your scenes.' : exampleHint();
  renderIssues();
  renderScenes();
  renderTail();
}

function issueText(issue) {
  if (issue.kind === 'missing') return `No ${issue.role} for ${issue.code} yet.`;
  const group = duplicateCells.get(cellKey(issue.role, issue.code));
  if (!group) return sentence(issue.message);
  const value = profile.entries[Number(issue.code)][issue.role].trim();
  const others = group.codes.filter((code) => code !== issue.code);
  return `${LABELS[issue.role]} ${quoted(value)} is also the ${issue.role} for ${listCodes(others)}, so ${issue.code} is ambiguous.`;
}

function renderIssues() {
  const issues = result?.issues ?? [];
  issuesBox.hidden = issues.length === 0;
  const visible = allIssues ? issues : issues.slice(0, ISSUE_PREVIEW);
  issueList.replaceChildren(...visible.map((issue) => {
    const item = document.createElement('li');
    item.className = `issue issue-${issue.kind}`;
    const text = document.createElement('span');
    text.textContent = issueText(issue);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'text-button';
    edit.textContent = `Edit ${issue.role} for ${issue.code}`;
    edit.addEventListener('click', () => focusCell(issue.code, issue.role));
    item.append(text, ' ', edit);
    return item;
  }));
  issuesMore.hidden = issues.length <= ISSUE_PREVIEW;
  issuesMore.textContent = allIssues ? 'Show fewer' : `Show all ${formatCount(issues.length)}`;
  issuesMore.setAttribute('aria-expanded', String(allIssues));
}

function slotItem(slot) {
  const wrapper = document.createElement('div');
  wrapper.className = 'slot';
  wrapper.dataset.role = slot.role;
  wrapper.dataset.code = slot.code;
  const term = document.createElement('dt');
  const role = document.createElement('span');
  role.className = 'slot-role';
  role.textContent = LABELS[slot.role];
  const code = document.createElement('span');
  code.className = 'slot-code';
  code.textContent = slot.code;
  term.append(role, ' ', code);
  const detail = document.createElement('dd');
  if (isBlank(slot.value)) {
    wrapper.classList.add('is-missing');
    const missing = document.createElement('span');
    missing.className = 'slot-missing';
    missing.textContent = `Missing ${slot.role}`;
    detail.append(missing);
  } else {
    const value = document.createElement('span');
    value.className = 'slot-value';
    value.textContent = slot.value.trim();
    detail.append(value);
    const others = (slot.duplicateCodes ?? []).filter((other) => other !== slot.code);
    if (others.length) {
      wrapper.classList.add('is-duplicate');
      const warning = document.createElement('span');
      warning.className = 'slot-warning';
      warning.textContent = `Ambiguous: also the ${slot.role} for ${listCodes(others)}`;
      detail.append(warning);
    }
  }
  if (!isBlank(slot.peg)) {
    const peg = document.createElement('span');
    peg.className = 'slot-peg';
    peg.textContent = `Peg: ${slot.peg.trim()}`;
    detail.append(peg);
  }
  wrapper.append(term, detail);
  return wrapper;
}

function sceneItem(scene) {
  const item = document.createElement('li');
  item.className = 'scene';
  item.tabIndex = -1;
  const title = document.createElement('h3');
  title.className = 'scene-title';
  const name = document.createElement('span');
  name.textContent = `Scene ${formatCount(scene.number)}`;
  const pairs = document.createElement('span');
  pairs.className = 'scene-digits';
  pairs.append(hiddenText('pairs '), scene.slots.map((slot) => slot.code).join(' '));
  title.append(name, ' ', pairs);
  const slots = document.createElement('dl');
  slots.className = 'scene-slots';
  for (const slot of scene.slots) slots.append(slotItem(slot));
  item.append(title, slots);
  if (scene.slots.length < PAO_ROLES.length) {
    const note = document.createElement('p');
    note.className = 'scene-note';
    const absent = PAO_ROLES.slice(scene.slots.length).join(' or ');
    note.textContent = result?.trailingDigit
      ? `One digit remains after this pair, so this scene has no ${absent}. That digit gets its own ending below.`
      : `The number ends here, so this scene has no ${absent}.`;
    item.append(note);
  }
  return item;
}

function renderScenes() {
  const scenes = result?.scenes ?? [];
  const shown = Math.min(scenes.length, sceneLimit);
  sceneList.replaceChildren(...scenes.slice(0, shown).map(sceneItem));
  sceneList.hidden = scenes.length === 0;
  sceneCount.hidden = scenes.length === 0;
  sceneCount.textContent = shown < scenes.length
    ? `Showing scenes 1\u2013${formatCount(shown)} of ${formatCount(scenes.length)}, from ${plural(result.pairCount, 'pair')}.`
    : `${plural(scenes.length, 'scene')} from ${plural(result?.pairCount ?? 0, 'pair')}.`;
  const next = Math.min(SCENES_PER_PAGE, scenes.length - shown);
  moreScenes.hidden = next <= 0;
  moreScenes.textContent = `Show ${plural(next, 'more scene', 'more scenes')}`;
}

function wordButton([word, code, pos], index, label, idPrefix, onChoose) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'word-choice';
  const spelling = document.createElement('span');
  spelling.className = 'word-spelling';
  spelling.textContent = word;
  button.append(spelling);
  button.title = `Encodes ${code}`;
  button.setAttribute('aria-label', label);
  button.dataset.code = code;
  const descriptions = [];
  const grammarLabel = partOfSpeechLabel(pos);
  if (grammarLabel) {
    const grammar = document.createElement('span');
    grammar.className = 'word-grammar';
    grammar.id = `${idPrefix}-grammar-${index}`;
    grammar.textContent = grammarLabel;
    button.append(grammar);
    descriptions.push(grammar.id);
  }
  // Ranked lists start with the words at or above the common-word cutoff.
  if (index < (dictionary.source.commonWords.countsByCode[code] ?? 0)) {
    button.classList.add('recommended');
    const recommendation = document.createElement('span');
    recommendation.className = 'word-recommendation';
    recommendation.id = `${idPrefix}-recommendation-${index}`;
    recommendation.hidden = true;
    recommendation.textContent = 'Recommended';
    button.append(recommendation);
    descriptions.push(recommendation.id);
  }
  if (descriptions.length) button.setAttribute('aria-describedby', descriptions.join(' '));
  button.addEventListener('click', onChoose);
  return button;
}

function renderTail() {
  const digit = result?.trailingDigit ?? '';
  tailSection.hidden = !digit;
  if (!digit) {
    tailOptions.replaceChildren();
    delete tailOptions.dataset.digit;
    return;
  }
  tailTitle.textContent = `Final digit ${digit}`;
  tailChosen.hidden = !tail;
  if (tail) {
    tailWord.textContent = tail[0];
    tailCode.textContent = tail[1];
    tailStatus.textContent = '';
    tailError.hidden = true;
    tailOptions.replaceChildren();
    delete tailOptions.dataset.digit;
    return;
  }
  if (!dictionary) {
    requestDictionary();
    tailStatus.textContent = dictionaryFailure ? '' : 'Opening the word library...';
    tailError.hidden = !dictionaryFailure;
    tailErrorText.textContent = dictionaryFailure ? dictionaryProblem() : '';
    tailOptions.replaceChildren();
    delete tailOptions.dataset.digit;
    return;
  }
  tailStatus.textContent = '';
  tailError.hidden = true;
  const view = `${digit}:${allEndings}`;
  if (tailOptions.dataset.digit === view) return;
  tailOptions.dataset.digit = view;
  const candidates = getCandidates(dictionary, digit);
  if (!candidates.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-options';
    empty.textContent = `This dictionary has no one-digit word for ${digit}. The final digit stays unencoded.`;
    tailOptions.replaceChildren(empty);
    return;
  }
  const group = document.createElement('section');
  group.className = 'word-group';
  const header = document.createElement('header');
  header.className = 'group-heading';
  const title = document.createElement('h4');
  title.id = 'tail-length';
  title.textContent = '1-digit words';
  group.setAttribute('aria-labelledby', title.id);
  const detail = document.createElement('p');
  detail.textContent = `${digit} / ${plural(candidates.length, 'choice')}`;
  header.append(title, detail);
  const choices = document.createElement('div');
  choices.className = 'choices';
  const shown = allEndings ? candidates : candidates.slice(0, IDEA_PREVIEW);
  shown.forEach((entry, index) => {
    choices.append(wordButton(entry, index, `Choose ${entry[0]} (${entry[1]})`, 'tail', () => chooseTail(entry)));
  });
  group.append(header, choices);
  if (candidates.length > IDEA_PREVIEW) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'text-button tail-more';
    more.textContent = allEndings ? 'Show fewer words' : `Show all ${formatCount(candidates.length)} words`;
    more.setAttribute('aria-expanded', String(allEndings));
    more.addEventListener('click', () => {
      allEndings = !allEndings;
      renderTail();
      const words = tailOptions.querySelectorAll('.word-choice');
      (allEndings ? words[IDEA_PREVIEW] : tailOptions.querySelector('.tail-more'))?.focus();
    });
    group.append(more);
  }
  tailOptions.replaceChildren(group);
}

function chooseTail(entry) {
  tail = entry;
  renderOutput();
  undoTail.focus();
}

function renderIdeas() {
  const panel = openIdeas ? byId(`pao-ideas-${openIdeas}`) : null;
  if (!panel) return;
  const hadFocus = panel.contains(document.activeElement);
  fillIdeas(panel, openIdeas);
  if (hadFocus && !panel.contains(document.activeElement)) panel.querySelector('button, [tabindex]')?.focus();
}

function fillIdeas(panel, code) {
  const heading = document.createElement('p');
  heading.className = 'ideas-heading';
  heading.textContent = `Peg ideas: words whose sounds encode exactly ${code}`;
  if (!dictionary) {
    if (dictionaryFailure) {
      const problem = document.createElement('div');
      problem.className = 'error pao-load-error';
      problem.setAttribute('role', 'alert');
      const text = document.createElement('p');
      text.textContent = dictionaryProblem();
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'button secondary';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => {
        requestDictionary({ retry: true });
        renderIdeas();
        renderTail();
        byId(`pao-ideas-${code}`)?.querySelector('[role="status"]')?.focus();
      });
      problem.append(text, retry);
      panel.replaceChildren(heading, problem);
    } else {
      const status = document.createElement('p');
      status.className = 'pao-status';
      status.setAttribute('role', 'status');
      status.tabIndex = -1;
      status.textContent = 'Opening the word library...';
      panel.replaceChildren(heading, status);
    }
    return;
  }
  const entries = dictionary.byCode[code] ?? [];
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-options';
    empty.textContent = `The dictionary has no word that encodes exactly ${code}. You can type your own peg.`;
    panel.replaceChildren(heading, empty);
    return;
  }
  const note = document.createElement('p');
  note.className = 'ideas-note';
  note.textContent = 'Green marks a common word. A peg is optional; scenes use the person, action, and object.';
  const choices = document.createElement('div');
  choices.className = 'choices';
  const shown = allIdeas ? entries : entries.slice(0, IDEA_PREVIEW);
  shown.forEach(([word, pos], index) => {
    choices.append(wordButton([word, code, pos], index, `Use ${word} as the peg for ${code}`,
      `idea-${code}`, () => usePeg(code, word)));
  });
  panel.replaceChildren(heading, note, choices);
  if (entries.length > IDEA_PREVIEW) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'text-button';
    more.textContent = allIdeas ? 'Show fewer words' : `Show all ${formatCount(entries.length)} words`;
    more.setAttribute('aria-expanded', String(allIdeas));
    more.addEventListener('click', () => {
      allIdeas = !allIdeas;
      fillIdeas(panel, code);
      const words = panel.querySelectorAll('.word-choice');
      (allIdeas ? words[IDEA_PREVIEW] : panel.querySelector('.ideas-more'))?.focus();
    });
    more.classList.add('ideas-more');
    panel.append(more);
  }
}

function closeIdeas() {
  if (!openIdeas) return;
  const row = rowElements.get(openIdeas);
  row?.querySelector('.ideas-panel')?.remove();
  const button = row?.querySelector('.ideas-button');
  button?.setAttribute('aria-expanded', 'false');
  button?.removeAttribute('aria-controls');
  openIdeas = '';
}

function toggleIdeas(code) {
  const wasOpen = openIdeas === code;
  closeIdeas();
  if (wasOpen) return;
  const row = rowElements.get(code);
  if (!row) return;
  openIdeas = code;
  allIdeas = false;
  const panel = document.createElement('div');
  panel.className = 'ideas-panel';
  panel.id = `pao-ideas-${code}`;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', `Peg ideas for ${code}`);
  row.append(panel);
  const button = row.querySelector('.ideas-button');
  button.setAttribute('aria-controls', panel.id);
  button.setAttribute('aria-expanded', 'true');
  requestDictionary({ retry: true });
  renderIdeas();
}

function usePeg(code, word) {
  if (!profile) return;
  const input = byId(cellId(code, 'peg'));
  input.value = word;
  profile.entries[Number(code)].peg = word;
  closeIdeas();
  tableEdited();
  input.focus();
}

function createRow(entry) {
  const row = document.createElement('div');
  row.className = 'pao-row';
  row.id = `pao-row-${entry.code}`;
  row.dataset.code = entry.code;
  const code = document.createElement('span');
  code.className = 'row-code';
  code.textContent = entry.code;
  row.append(code);
  for (const field of FIELDS) {
    const cell = document.createElement('div');
    cell.className = `row-field field-${field}`;
    const input = document.createElement('input');
    input.type = 'text';
    input.id = cellId(entry.code, field);
    input.value = entry[field];
    input.maxLength = field === 'peg' ? PROFILE_LIMITS.peg : PROFILE_LIMITS.association;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.code = entry.code;
    input.dataset.field = field;
    const label = document.createElement('label');
    label.htmlFor = input.id;
    const name = document.createElement('span');
    name.className = 'field-name';
    name.textContent = LABELS[field];
    label.append(name, hiddenText(` for ${entry.code}`));
    if (field === 'peg') {
      const control = document.createElement('div');
      control.className = 'peg-control';
      const ideas = document.createElement('button');
      ideas.type = 'button';
      ideas.className = 'ideas-button';
      ideas.dataset.code = entry.code;
      ideas.setAttribute('aria-expanded', 'false');
      ideas.append('Ideas', hiddenText(` for peg ${entry.code}`));
      control.append(input, ideas);
      cell.append(label, control);
    } else {
      const warning = document.createElement('span');
      warning.className = 'cell-warning';
      warning.id = `${input.id}-warning`;
      warning.hidden = true;
      cell.append(label, input, warning);
    }
    row.append(cell);
  }
  rowElements.set(entry.code, row);
  return row;
}

function renderRows() {
  closeIdeas();
  rowElements.clear();
  const fragment = document.createDocumentFragment();
  for (const entry of profile.entries) fragment.append(createRow(entry));
  rows.replaceChildren(fragment);
}

function markCell(key, group) {
  const [field, code] = key.split(':');
  const input = byId(cellId(code, field));
  if (!input) return;
  const warning = byId(`${input.id}-warning`);
  input.classList.toggle('has-duplicate', Boolean(group));
  if (!warning) return;
  if (group) {
    warning.textContent = `Duplicate: also the ${field} for ${listCodes(group.codes.filter((other) => other !== code))}`;
    warning.hidden = false;
    input.setAttribute('aria-describedby', warning.id);
  } else {
    warning.textContent = '';
    warning.hidden = true;
    input.removeAttribute('aria-describedby');
  }
}

function renderDuplicateSummary() {
  duplicateSummary.hidden = duplicates.length === 0;
  duplicateList.replaceChildren(...duplicates.map((group) => {
    const item = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = `${LABELS[group.role] ?? group.role} ${quoted(group.value)}: `;
    item.append(text);
    group.codes.forEach((code, index) => {
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'text-button code-link';
      jump.textContent = code;
      jump.setAttribute('aria-label', `Go to ${group.role} for ${code}`);
      jump.addEventListener('click', () => focusCell(code, group.role));
      if (index) item.append(' ');
      item.append(jump);
    });
    return item;
  }));
}

function refreshDuplicates() {
  duplicates = profile ? findDuplicates(profile) : [];
  const next = new Map();
  for (const group of duplicates) {
    for (const code of group.codes) next.set(cellKey(group.role, code), group);
  }
  for (const key of new Set([...duplicateCells.keys(), ...next.keys()])) markCell(key, next.get(key));
  duplicateCells = next;
  renderDuplicateSummary();
}

function numberCodes() {
  const codes = new Set();
  if (!inputProblem) {
    for (let offset = 0; offset + 1 < digits.length; offset += 2) codes.add(digits.slice(offset, offset + 2));
  }
  return codes;
}

function applyFilter() {
  if (!profile) return;
  const query = fold(search.value);
  const mode = filter.value;
  const wanted = mode === 'number' ? numberCodes() : null;
  let shown = 0;
  for (const entry of profile.entries) {
    const matchesQuery = !query || entry.code.startsWith(query) ||
      FIELDS.some((field) => fold(entry[field]).includes(query));
    let matchesMode = true;
    if (mode === 'number') matchesMode = wanted.has(entry.code);
    else if (mode === 'missing') matchesMode = PAO_ROLES.some((role) => isBlank(entry[role]));
    else if (mode === 'duplicates') matchesMode = PAO_ROLES.some((role) => duplicateCells.has(cellKey(role, entry.code)));
    const row = rowElements.get(entry.code);
    row.hidden = !(matchesQuery && matchesMode);
    if (!row.hidden) shown += 1;
  }
  filterCount.textContent = shown === profile.entries.length
    ? `Showing all ${profile.entries.length} codes` : `Showing ${shown} of ${profile.entries.length} codes`;
  noRows.hidden = shown > 0;
  if (openIdeas && rowElements.get(openIdeas)?.hidden) closeIdeas();
}

function openEditor() {
  editor.open = true;
}

function focusCell(code, field) {
  if (!profile) return;
  openEditor();
  if (rowElements.get(code)?.hidden) {
    search.value = '';
    filter.value = 'all';
    applyFilter();
  }
  const input = byId(cellId(code, field));
  if (!input) return;
  input.focus({ preventScroll: true });
  input.scrollIntoView({ block: 'center' });
}

function tableEdited() {
  refreshDuplicates();
  updateDirty();
  scheduleOutput();
}

function validateName() {
  const blank = isBlank(tableName.value);
  tableName.setAttribute('aria-invalid', String(blank));
  tableNameError.hidden = !blank;
}

function useProfile(next) {
  profile = next;
  savedState = snapshot();
  loadFailure = '';
  tableName.value = profile.name;
  validateName();
  tableLicense.textContent = profile.license || 'None recorded';
  tableAttribution.textContent = profile.attribution || 'None recorded';
  renderRows();
  refreshDuplicates();
  applyFilter();
  renderLoadState();
  updateDirty();
  encodeAndRender();
}

async function fetchStarter() {
  if (starterText === null) {
    const response = await fetch(new URL('./data/pao-starter.json', import.meta.url));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = decodeText(await response.arrayBuffer());
    parseProfile(text);
    starterText = text;
  }
  return parseProfile(starterText);
}

function beginTableOperation() {
  tableOperation += 1;
  starterLoading = false;
  clearTableFeedback();
  renderLoadState();
  return tableOperation;
}

function isCurrentOperation(operation) {
  return operation === tableOperation;
}

function settleStarterAttempt() {
  renderLoadState();
  if (document.activeElement === loadStatus) (profile ? number : retryStarter).focus();
}

async function openStarter() {
  const operation = beginTableOperation();
  starterLoading = true;
  loadFailure = '';
  renderLoadState();
  let next;
  try {
    next = await fetchStarter();
  } catch (failure) {
    if (!isCurrentOperation(operation)) return;
    starterLoading = false;
    loadFailure = sentence(failure.message) || 'The request failed.';
    settleStarterAttempt();
    return;
  }
  if (!isCurrentOperation(operation)) return;
  starterLoading = false;
  useProfile(next);
  settleStarterAttempt();
}

function confirmReplace(replacement) {
  if (!isDirty()) return Promise.resolve(true);
  if (replaceDialog.open) return Promise.resolve(false);
  const message = `${quoted(displayName())} has changes that are not exported. Replacing it with ${replacement} discards them. Export the table first if you want to keep a copy.`;
  if (typeof replaceDialog.showModal !== 'function') return Promise.resolve(window.confirm(message));
  replaceText.textContent = message;
  replaceDialog.returnValue = '';
  const opener = document.activeElement;
  return new Promise((resolve) => {
    replaceDialog.addEventListener('close', () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      resolve(replaceDialog.returnValue === 'replace');
    }, { once: true });
    replaceDialog.showModal();
  });
}

function importSummary(next) {
  const complete = next.entries.filter((entry) => PAO_ROLES.every((role) => !isBlank(entry[role]))).length;
  const parts = [`Imported ${quoted(isBlank(next.name) ? 'Untitled table' : next.name)}: ${complete} of 100 codes complete.`];
  if (duplicates.length) parts.push(`${plural(duplicates.length, 'duplicate value')} to review in the editor.`);
  return parts.join(' ');
}

newTable.addEventListener('click', async () => {
  const operation = beginTableOperation();
  const confirmed = await confirmReplace('a new blank table');
  if (!isCurrentOperation(operation)) return;
  if (!confirmed) {
    showTableMessage('Kept your current table.');
    return;
  }
  useProfile(createBlankProfile());
  showTableMessage('Started a new blank table. Name it, fill in the codes you need, and export it to keep it.');
});

restoreStarter.addEventListener('click', async () => {
  if (!profile) {
    openStarter();
    return;
  }
  const operation = beginTableOperation();
  starterLoading = true;
  renderLoadState();
  let next;
  try {
    next = await fetchStarter();
  } catch (failure) {
    if (!isCurrentOperation(operation)) return;
    starterLoading = false;
    renderLoadState();
    showTableError(`DigitLoom could not open the starter table. ${sentence(failure.message)} Your current table is unchanged.`);
    return;
  }
  if (!isCurrentOperation(operation)) return;
  starterLoading = false;
  renderLoadState();
  const confirmed = await confirmReplace(`the starter table ${quoted(next.name)}`);
  if (!isCurrentOperation(operation)) return;
  if (!confirmed) {
    showTableMessage('Kept your current table.');
    return;
  }
  useProfile(next);
  showTableMessage(`Restored ${quoted(next.name)}.`);
});

retryStarter.addEventListener('click', () => {
  openStarter();
  loadStatus.focus();
});

importTable.addEventListener('click', () => {
  // Opening a picker is a newer choice, so pending reads must not prompt behind it.
  beginTableOperation();
  importFile.click();
});

importFile.addEventListener('change', async () => {
  const [file] = importFile.files;
  importFile.value = '';
  if (!file) return;
  const operation = beginTableOperation();
  showTableMessage(`Reading ${quoted(file.name)}...`);
  let next;
  try {
    if (file.size > PROFILE_LIMITS.bytes) {
      throw new Error(`This file is larger than ${PROFILE_LIMITS.bytes / 1024} KiB (${PROFILE_LIMITS.bytes} bytes), the limit for a PAO table.`);
    }
    next = parseProfile(decodeText(await file.arrayBuffer()));
  } catch (failure) {
    if (isCurrentOperation(operation)) {
      showTableError(`Could not import ${quoted(file.name)}. ${sentence(failure.message)} Your current table is unchanged.`);
    }
    return;
  }
  if (!isCurrentOperation(operation)) return;
  const confirmed = await confirmReplace(`the imported table ${quoted(next.name)}`);
  if (!isCurrentOperation(operation)) return;
  if (!confirmed) {
    showTableMessage('Import canceled. Your current table is unchanged.');
    return;
  }
  useProfile(next);
  showTableMessage(importSummary(next));
});

exportTable.addEventListener('click', () => {
  clearTableFeedback();
  if (!profile) return;
  let text;
  try {
    text = serializeProfile(profile);
  } catch (failure) {
    showTableError(`Could not export this table. ${sentence(failure.message)}`);
    if (isBlank(profile.name)) {
      openEditor();
      tableName.focus();
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = EXPORT_FILENAME;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  savedState = snapshot();
  updateDirty();
  showTableMessage(`Exported ${EXPORT_FILENAME}. Import it later to continue with this table.`);
});

number.addEventListener('input', () => {
  const parsed = normalizeInput(number.value);
  inputProblem = parsed.error;
  digits = parsed.ok ? parsed.digits : '';
  tail = null;
  allEndings = false;
  sceneLimit = SCENES_PER_PAGE;
  allIssues = false;
  encodeAndRender();
  if (filter.value === 'number') applyFilter();
});

clearButton.addEventListener('click', () => {
  number.value = '';
  inputProblem = '';
  digits = '';
  tail = null;
  allEndings = false;
  sceneLimit = SCENES_PER_PAGE;
  allIssues = false;
  encodeAndRender();
  if (filter.value === 'number') applyFilter();
  number.focus();
});

undoTail.addEventListener('click', () => {
  tail = null;
  renderOutput();
  (tailOptions.querySelector('button') ?? number).focus();
});

tailRetry.addEventListener('click', () => {
  requestDictionary({ retry: true });
  renderTail();
  tailStatus.focus();
});

moreScenes.addEventListener('click', () => {
  const first = sceneLimit;
  sceneLimit += SCENES_PER_PAGE;
  renderScenes();
  sceneList.children[first]?.focus();
});

issuesMore.addEventListener('click', () => {
  allIssues = !allIssues;
  renderIssues();
  issuesMore.focus();
});

openEditorButton.addEventListener('click', () => {
  openEditor();
  const summary = editor.querySelector('summary');
  summary.focus({ preventScroll: true });
  editor.scrollIntoView({ block: 'start' });
});

tableName.addEventListener('input', () => {
  if (!profile) return;
  const clean = tableName.value.replace(CONTROLS, ' ');
  if (clean !== tableName.value) tableName.value = clean;
  profile.name = tableName.value;
  validateName();
  tableInUse.textContent = `Using table ${quoted(displayName())}.`;
  updateDirty();
});

rows.addEventListener('input', (event) => {
  const input = event.target;
  const field = input.dataset?.field;
  if (!profile || !field) return;
  const clean = input.value.replace(CONTROLS, ' ');
  if (clean !== input.value) input.value = clean;
  profile.entries[Number(input.dataset.code)][field] = input.value;
  tableEdited();
});

rows.addEventListener('click', (event) => {
  const ideas = event.target.closest('.ideas-button');
  if (ideas) toggleIdeas(ideas.dataset.code);
});

rows.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !openIdeas) return;
  const row = rowElements.get(openIdeas);
  if (!row || !event.target.closest('.ideas-panel, .ideas-button')) return;
  const button = row.querySelector('.ideas-button');
  closeIdeas();
  button.focus();
});

search.addEventListener('input', applyFilter);
filter.addEventListener('change', applyFilter);

loadStatus.tabIndex = -1;
tailStatus.tabIndex = -1;
tableName.maxLength = PROFILE_LIMITS.name;
openStarter();

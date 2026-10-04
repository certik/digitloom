import { loadDictionary } from './dictionary.js?v=5';
import { DEFAULT_MINIMUM_ZIPF, getCandidates, groupCandidates, isCommonWord, normalizeInput, partOfSpeechLabel, planChunks } from './logic.js?v=5';
import {
  addThreadWord, analyzeWordThread, createWordThread, fitWordBetweenNeighbors,
  formatWordThread, removeThreadWord, replaceThreadWord, undoThreadChange, wordEnd
} from './word-thread.js?v=1';

const number = document.querySelector('#number');
const autoSplit = document.querySelector('#auto-split');
const wordFilter = document.querySelector('#word-filter');
const commonOnly = document.querySelector('#common-only');
const frequencyCutoff = document.querySelector('#frequency-cutoff');
const frequencyValue = document.querySelector('#frequency-value');
const resetCutoff = document.querySelector('#reset-cutoff');
const showAllWords = document.querySelector('#show-all-words');
const clear = document.querySelector('#clear');
const undo = document.querySelector('#undo');
const sequence = document.querySelector('#sequence');
const memoryThread = document.querySelector('#memory-thread');
const workspace = document.querySelector('#workspace');
const inputError = document.querySelector('#input-error');
const progress = document.querySelector('#progress');
const progressLabel = document.querySelector('#progress-label');
const heading = document.querySelector('#step-title');
const optionsArea = document.querySelector('.options-area');
const options = document.querySelector('#options');
const emptyOptions = document.querySelector('#empty-options');
const libraryStatus = document.querySelector('#library-status');
const libraryError = document.querySelector('#library-error');
const wordEditor = document.querySelector('#word-editor');
const editorTitle = document.querySelector('#word-editor-title');
const editorRange = document.querySelector('#word-editor-range');
const editorHint = document.querySelector('#word-editor-hint');
const cancelEdit = document.querySelector('#cancel-word-edit');
const fitWord = document.querySelector('#fit-word');
const originalPosition = document.querySelector('#original-word-position');
const removeWord = document.querySelector('#remove-word');
const showOtherLengths = document.querySelector('#show-other-lengths');
const otherLengths = document.querySelector('#other-lengths');
const otherOptions = document.querySelector('#other-options');
const otherLengthsHint = otherLengths.querySelector('p');
const coveragePanel = document.querySelector('#coverage-panel');
const coverageSummary = document.querySelector('#coverage-summary');
const coverageWindow = document.querySelector('#coverage-window');
const coverageDigits = document.querySelector('#coverage-digits');
const earlierDigits = document.querySelector('#earlier-digits');
const laterDigits = document.querySelector('#later-digits');
const editHint = document.querySelector('#edit-hint');
const COVERAGE_WINDOW = 48;

let dictionary;
let thread = createWordThread();
let editing = null;
let coverageStart = 0;
let analysis = analyzeWordThread(thread);
let error = '';

const digitRange = (start, end) => end - start === 1 ? `digit ${start + 1}` : `digits ${start + 1}-${end}`;
const digitCount = (count) => `${count.toLocaleString('en-US')} ${count === 1 ? 'digit' : 'digits'}`;
const previewDigits = (start, end) => {
  const text = thread.digits.slice(start, end);
  return text.length > 24 ? `${text.slice(0, 24)}...` : text;
};
const wordButtonFor = (id) => sequence.querySelector(`[data-word-id="${id}"]`);

function focusInView(element) {
  if (!element) return;
  element.focus({ preventScroll: true });
  const box = element.getBoundingClientRect();
  if (box.top < 0 || box.bottom > window.innerHeight) element.scrollIntoView({ block: 'nearest' });
}

function focusWordEditor() {
  focusInView(editorTitle);
  const first = options.querySelector('button') ?? otherOptions.querySelector('button');
  if (first) {
    const overflow = first.getBoundingClientRect().bottom - window.innerHeight + 12;
    if (overflow > 0) window.scrollBy(0, Math.ceil(overflow));
  }
  if (editorTitle.getBoundingClientRect().top < 0) wordEditor.scrollIntoView({ block: 'start' });
}

function openWordEditor(id) {
  if (editing?.mode === 'replace' && editing.id === id) {
    closeWordEditor();
    return;
  }
  const word = thread.words.find((item) => item.id === id);
  if (!word) return;
  editing = { mode: 'replace', id, start: word.start, length: word.candidate[1].length, fitted: false };
  coverageStart = Math.max(0, word.start - 8);
  otherLengths.open = false;
  refresh();
  focusWordEditor();
}

function openGapEditor(gap) {
  editing = { mode: 'gap', start: gap.start, length: gap.end - gap.start };
  coverageStart = Math.max(0, gap.start - 8);
  otherLengths.open = false;
  refresh();
  focusWordEditor();
}

function closeWordEditor() {
  const id = editing?.id;
  editing = null;
  otherLengths.open = false;
  refresh();
  focusInView(id === undefined ? number : wordButtonFor(id));
}

function choose(entry, context) {
  let id;
  if (context.mode === 'replace') {
    id = context.id;
    thread = replaceThreadWord(thread, id, entry, context.start);
  } else {
    id = thread.nextId;
    thread = addThreadWord(thread, entry, context.start);
  }
  editing = null;
  otherLengths.open = false;
  coverageStart = Math.max(0, context.start - 8);
  refresh();
  window.scrollTo(0, 0);
  focusInView(context.mode === 'append' ? options.querySelector('button') ?? undo : wordButtonFor(id));
}

function wordButton(entry, index, minimumZipf, context) {
  const [word, code, flags, frequency] = entry;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'word-choice';
  const spelling = document.createElement('span');
  spelling.className = 'word-spelling';
  spelling.textContent = word;
  button.append(spelling);
  button.title = `Encodes ${code}`;
  button.setAttribute('aria-label', `Choose ${word} (${code})`);
  button.dataset.code = code;
  const descriptions = [];
  const label = partOfSpeechLabel(flags);
  if (label) {
    const grammar = document.createElement('span');
    grammar.className = 'word-grammar';
    grammar.id = `grammar-${code}-${index}`;
    grammar.textContent = label;
    button.append(grammar);
    descriptions.push(grammar.id);
  }
  if (isCommonWord(frequency, minimumZipf)) {
    button.classList.add('recommended');
    const recommendation = document.createElement('span');
    recommendation.className = 'word-recommendation';
    recommendation.id = `recommendation-${code}-${index}`;
    recommendation.hidden = true;
    recommendation.textContent = 'Recommended';
    button.append(recommendation);
    descriptions.push(recommendation.id);
  }
  if (descriptions.length) button.setAttribute('aria-describedby', descriptions.join(' '));
  button.addEventListener('click', () => choose(entry, context));
  return button;
}

function showGroups(candidates, target, minimumZipf, context) {
  const fragment = document.createDocumentFragment();
  for (const { digitCount, words } of groupCandidates(candidates)) {
    const section = document.createElement('section');
    section.className = 'word-group';
    const header = document.createElement('header');
    header.className = 'group-heading';
    const title = document.createElement('h3');
    title.id = `length-${digitCount}`;
    title.textContent = `${digitCount}-digit words`;
    section.setAttribute('aria-labelledby', title.id);
    const detail = document.createElement('p');
    const code = words[0][1];
    detail.textContent = commonOnly.checked
      ? `${code} / ${words.length} common of ${dictionary.byCode[code].length} choices`
      : `${code} / ${words.length} choices`;
    header.append(title, detail);
    const choices = document.createElement('div');
    choices.className = 'choices';
    for (const [index, word] of words.entries()) choices.append(wordButton(word, index, minimumZipf, context));
    section.append(header, choices);
    fragment.append(section);
  }
  target.replaceChildren(fragment);
}

function renderSequence(arranging) {
  const items = analysis.words.map((word) => ({ start: word.start, word }));
  if (arranging) {
    for (const gap of analysis.gaps) items.push({ start: gap.start, gap });
  }
  items.sort((left, right) => left.start - right.start);
  sequence.replaceChildren(...items.map(({ word, gap }) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-controls', 'word-editor');
    const code = document.createElement('small');
    if (word) {
      const [spelling, digits] = word.candidate;
      button.className = 'thread-word';
      button.dataset.wordId = String(word.id);
      button.dataset.start = String(word.start);
      button.dataset.end = String(wordEnd(word));
      button.setAttribute('aria-label', `Edit ${spelling} (${digits})`);
      button.title = `Edit ${spelling}, ${digitRange(word.start, wordEnd(word))}`;
      button.setAttribute('aria-pressed', String(editing?.id === word.id));
      code.textContent = digits;
      button.append(spelling, code);
      const overlap = analysis.overlaps.some((range) => word.start < range.end && wordEnd(word) > range.start);
      button.classList.toggle('has-overlap', overlap);
      if (overlap) {
        const warning = document.createElement('span');
        warning.className = 'thread-word-warning';
        warning.id = `overlap-${word.id}`;
        warning.textContent = 'Overlap';
        button.append(warning);
        button.setAttribute('aria-describedby', warning.id);
        button.title += '; shares digits with another word';
      }
      button.addEventListener('click', () => openWordEditor(word.id));
    } else {
      button.className = 'thread-gap';
      button.dataset.gapStart = String(gap.start);
      button.setAttribute('aria-pressed', String(editing?.mode === 'gap' && editing.start === gap.start));
      button.setAttribute('aria-label', `Add word for unassigned ${digitRange(gap.start, gap.end)}`);
      code.textContent = previewDigits(gap.start, gap.end);
      button.append(`Unassigned ${digitCount(gap.end - gap.start)}`, code);
      button.addEventListener('click', () => openGapEditor(gap));
    }
    item.append(button);
    return item;
  }));
}

function renderCoverage(arranging) {
  coveragePanel.hidden = !arranging;
  if (!arranging) {
    coverageDigits.replaceChildren();
    return;
  }
  const problems = [];
  if (analysis.unassignedCount) problems.push(`${digitCount(analysis.unassignedCount)} unassigned`);
  if (analysis.overlapCount) problems.push(`${digitCount(analysis.overlapCount)} overlapping`);
  coverageSummary.textContent = problems.length
    ? `${problems.join('; ')}. Click a word or an unassigned block to adjust it.`
    : 'Every digit is covered once.';
  coveragePanel.classList.toggle('has-problems', problems.length > 0);
  coverageStart = Math.max(0, Math.min(coverageStart, thread.digits.length - 1));
  const end = Math.min(thread.digits.length, coverageStart + COVERAGE_WINDOW);
  coverageWindow.textContent = `Digits ${coverageStart + 1}-${end} of ${thread.digits.length}`;
  earlierDigits.hidden = thread.digits.length <= COVERAGE_WINDOW;
  laterDigits.hidden = earlierDigits.hidden;
  earlierDigits.disabled = coverageStart === 0;
  laterDigits.disabled = end === thread.digits.length;
  const fragment = document.createDocumentFragment();
  for (let offset = coverageStart; offset < end; offset += 1) {
    const cell = document.createElement('li');
    const count = analysis.coverage[offset];
    cell.className = 'coverage-digit';
    cell.textContent = thread.digits[offset];
    cell.classList.toggle('is-unassigned', count === 0);
    cell.classList.toggle('is-overlapping', count > 1);
    cell.classList.toggle('is-editing', Boolean(editing && offset >= editing.start && offset < editing.start + editing.length));
    const state = count === 0 ? 'unassigned' : count === 1 ? 'covered once' : `shared by ${count} words`;
    cell.title = `Digit ${offset + 1}: ${thread.digits[offset]}, ${state}`;
    cell.setAttribute('aria-label', cell.title);
    fragment.append(cell);
  }
  coverageDigits.replaceChildren(fragment);
}

function renderWordEditor() {
  wordEditor.hidden = !editing;
  if (!editing) return;
  const replacing = editing.mode === 'replace';
  const word = replacing ? thread.words.find(({ id }) => id === editing.id) : null;
  editorTitle.textContent = replacing ? `Replace ${word.candidate[0]}` : 'Fill unassigned digits';
  editorHint.textContent = replacing
    ? 'Same-length choices come first. Other lengths may leave gaps or overlaps; other words stay in place.'
    : 'Words fitting this gap come first, including one-digit choices. Other words stay in place.';
  if (autoSplit.checked) editorHint.textContent += ' Auto split does not limit these choices.';
  editorRange.textContent = `${editing.fitted ? 'Fit preview' : 'Matching'}: ${previewDigits(editing.start, editing.start + editing.length)} (${digitRange(editing.start, editing.start + editing.length)}).`;
  removeWord.hidden = !replacing;
  originalPosition.hidden = !editing.fitted;
  fitWord.hidden = !replacing;
  if (replacing) {
    const fit = fitWordBetweenNeighbors(thread, word.id);
    fitWord.disabled = fit.start >= fit.end;
    fitWord.hidden = editing.fitted || (fit.start === word.start && fit.end === wordEnd(word));
    fitWord.textContent = fitWord.disabled ? 'No space between neighbors'
      : `Fit between neighbors: ${previewDigits(fit.start, fit.end)}`;
  }
}

function positionAfterDigits(value, count) {
  if (!count) return 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== ' ' && --count === 0) return index + 1;
  }
  return value.length;
}

function updateNumber(value) {
  if (number.value === value) return;
  const start = number.value.slice(0, number.selectionStart).replaceAll(' ', '').length;
  const end = number.value.slice(0, number.selectionEnd).replaceAll(' ', '').length;
  const direction = number.selectionDirection;
  number.value = value;
  number.setSelectionRange(positionAfterDigits(value, start), positionAfterDigits(value, end), direction);
}

function refresh() {
  analysis = analyzeWordThread(thread);
  const total = thread.digits.length;
  const minimumZipf = frequencyCutoff.valueAsNumber;
  const cutoffLabel = `Zipf ${minimumZipf.toFixed(1)}`;
  frequencyValue.textContent = cutoffLabel;
  frequencyCutoff.setAttribute('aria-valuetext', cutoffLabel);
  resetCutoff.disabled = !dictionary || minimumZipf === DEFAULT_MINIMUM_ZIPF;
  wordFilter.classList.toggle('is-active', commonOnly.checked || minimumZipf !== DEFAULT_MINIMUM_ZIPF);
  wordFilter.querySelector('summary').title = commonOnly.checked
    ? `Common words only, at ${cutoffLabel} or above`
    : `All words, with green highlights at ${cutoffLabel} or above`;
  const gap = analysis.gaps[0];
  const context = editing ? { ...editing } : gap ? {
    mode: analysis.canAppend ? 'append' : 'gap', start: gap.start, length: gap.end - gap.start
  } : null;
  const appending = context?.mode === 'append';
  const remaining = appending ? thread.digits.slice(context.start) : '';
  const chunks = appending && autoSplit.checked && dictionary && !error
    ? planChunks(dictionary, remaining, commonOnly.checked ? minimumZipf : undefined)
    : null;
  const noSplit = appending && autoSplit.checked && !error && remaining.length > 0 && chunks === null;
  const noCommonSplit = noSplit && commonOnly.checked && planChunks(dictionary, remaining) !== null;
  if (!error) updateNumber(formatWordThread(thread, chunks ?? undefined));
  inputError.hidden = !error;
  inputError.textContent = error;
  number.setAttribute('aria-invalid', String(Boolean(error)));
  undo.disabled = thread.history.length === 0;
  undo.textContent = thread.history.at(-1)?.before ? 'Undo change' : 'Undo word';
  clear.disabled = number.value.length === 0;
  const arranging = Boolean(total && (editing || analysis.hasInternalGap || analysis.overlapCount ||
    (analysis.hasEdits && !analysis.complete)));
  editHint.hidden = !analysis.complete || Boolean(editing);
  memoryThread.hidden = thread.words.length === 0 && !arranging;
  workspace.classList.toggle('has-input', number.value.length > 0);
  optionsArea.hidden = !total && !error;
  renderSequence(arranging);
  renderCoverage(arranging);
  renderWordEditor();
  const encoded = analysis.matchedCount;
  progress.max = Math.max(total, 1);
  progress.value = encoded;
  progressLabel.textContent = total
    ? `${encoded} of ${total} digits ${analysis.overlapCount ? 'covered once' : 'encoded'}` : 'No digits yet';

  const nextDigits = context ? appending && autoSplit.checked ? chunks?.[0] ?? '' : thread.digits.slice(context.start) : '';
  const candidates = dictionary && !error
    ? getCandidates(dictionary, nextDigits).filter(([, code]) => !appending || !autoSplit.checked || code === nextDigits)
    : [];
  if (context && !appending && nextDigits.length > 1 && !error) {
    candidates.unshift(...getCandidates(dictionary, nextDigits[0]));
  }
  const visible = commonOnly.checked
    ? candidates.filter(([, , , frequency]) => isCommonWord(frequency, minimumZipf))
    : candidates;
  const preferredLength = ([, code]) => !context || appending ||
    (context.mode === 'replace' ? code.length === context.length : code.length <= context.length);
  const preferred = visible.filter(preferredLength);
  const alternatives = visible.filter((entry) => !preferredLength(entry));
  const noPreferred = !preferred.length && alternatives.length > 0;
  const filteredPreferred = commonOnly.checked && !preferred.length && candidates.some(preferredLength);
  showGroups(preferred, options, minimumZipf, context);
  showGroups(alternatives, otherOptions, minimumZipf, context);
  otherLengths.hidden = alternatives.length === 0;
  showOtherLengths.hidden = otherLengths.hidden;
  if (alternatives.length) {
    const action = context.mode === 'replace'
      ? `Replace ${thread.words.find(({ id }) => id === context.id).candidate[0]}` : 'Fill the gap';
    otherLengthsHint.textContent = `${action} starting at digit ${context.start + 1}. Other words stay in place; shorter or longer choices may need gap or overlap repairs.`;
  }
  if (noPreferred) otherLengths.open = true;
  showOtherLengths.setAttribute('aria-expanded', String(otherLengths.open));
  heading.classList.toggle('visually-hidden', visible.length > 0 && !noPreferred);
  emptyOptions.hidden = (visible.length > 0 && !noPreferred) || (analysis.complete && !editing && !error);
  showAllWords.hidden = !commonOnly.checked || !(noCommonSplit || filteredPreferred || (candidates.length > 0 && !visible.length));
  if (error) {
    heading.textContent = 'Check your number';
    emptyOptions.textContent = 'Replace letters or punctuation with digits to explore the word library.';
  } else if (!total) {
    heading.textContent = 'Type digits to begin';
    emptyOptions.textContent = 'Try 3277: a moon, a cake, a scene to remember.';
  } else if (analysis.complete && !editing) {
    heading.textContent = 'Your number is encoded.';
  } else if (!context && analysis.overlapCount) {
    heading.textContent = 'Resolve overlapping words';
    emptyOptions.textContent = 'Click a word with an Overlap warning to replace or remove it. Fit between neighbors helps repair its boundaries without moving other words.';
  } else if (noCommonSplit) {
    heading.textContent = 'No automatic split at this cutoff';
    emptyOptions.textContent = 'No complete split uses only words at this cutoff. Lower the frequency cutoff in Filter or show all words. Your selected words are kept.';
  } else if (noSplit) {
    heading.textContent = 'No automatic split available';
    emptyOptions.textContent = 'This number cannot be fully split into available 2-4-digit words, with an optional final digit. Turn off Auto split to see all word lengths.';
  } else if (!candidates.length) {
    heading.textContent = 'No words for this prefix';
    emptyOptions.textContent = editing ? 'No dictionary word starts at this position. Use the current position, fit between neighbors, or cancel this edit.'
      : 'This dictionary has no matching word. Undo a choice or try a different number.';
  } else if (!visible.length) {
    heading.textContent = 'No words at this cutoff';
    emptyOptions.textContent = 'Lower the frequency cutoff in Filter or show all words. Your selected words are kept.';
  } else if (noPreferred) {
    heading.textContent = context.mode === 'replace'
      ? `No ${context.length}-digit replacements${filteredPreferred ? ' at this cutoff' : ''}`
      : `No words fit this gap${filteredPreferred ? ' at this cutoff' : ''}`;
    emptyOptions.textContent = filteredPreferred
      ? 'Lower the cutoff or show all words to see choices fitting this span. Other lengths are available below.'
      : 'Try another length below; any remaining gaps or overlaps will stay visible. Only the chosen word changes.';
  } else {
    heading.textContent = context?.mode === 'replace' ? 'Choose a replacement'
      : context?.mode === 'gap' ? 'Choose a word for the unassigned digits'
        : autoSplit.checked ? 'Choose a word for the next automatic chunk'
          : thread.words.length ? 'Add to your memory thread' : 'Choose a word for the next digits';
  }
}

function readInput() {
  const parsed = normalizeInput(number.value);
  error = parsed.error;
  thread = createWordThread(parsed.ok ? parsed.digits : '');
  editing = null;
  coverageStart = 0;
  otherLengths.open = false;
  refresh();
}

number.addEventListener('input', readInput);
number.addEventListener('beforeinput', (event) => {
  if (!autoSplit.checked || error || !event.cancelable || number.selectionStart !== number.selectionEnd) return;
  const cursor = number.selectionStart;
  const backward = event.inputType === 'deleteContentBackward' && number.value[cursor - 1] === ' ';
  const forward = event.inputType === 'deleteContentForward' && number.value[cursor] === ' ';
  if (!backward && !forward) return;
  event.preventDefault();
  number.setRangeText('', backward ? cursor - 2 : cursor, backward ? cursor : cursor + 2, 'start');
  readInput();
});

autoSplit.addEventListener('change', refresh);
commonOnly.addEventListener('change', refresh);
frequencyCutoff.addEventListener('input', refresh);

resetCutoff.addEventListener('click', () => {
  frequencyCutoff.value = String(DEFAULT_MINIMUM_ZIPF);
  refresh();
  frequencyCutoff.focus();
});

showAllWords.addEventListener('click', () => {
  commonOnly.checked = false;
  refresh();
  focusInView(options.querySelector('button') ?? otherOptions.querySelector('button'));
});

undo.addEventListener('click', () => {
  const change = thread.history.at(-1);
  if (!change) return;
  thread = undoThreadChange(thread);
  editing = null;
  otherLengths.open = false;
  refresh();
  if (undo.disabled) number.focus({ preventScroll: true });
  else if (change.before) focusInView(wordButtonFor(change.before.id));
});

clear.addEventListener('click', () => {
  number.value = '';
  error = '';
  thread = createWordThread();
  editing = null;
  coverageStart = 0;
  otherLengths.open = false;
  refresh();
  number.focus();
});

cancelEdit.addEventListener('click', closeWordEditor);
showOtherLengths.addEventListener('click', () => {
  otherLengths.open = true;
  otherLengths.querySelector('summary').focus({ preventScroll: true });
  otherLengths.scrollIntoView({ block: 'start' });
});
otherLengths.addEventListener('toggle', () => {
  showOtherLengths.setAttribute('aria-expanded', String(otherLengths.open));
});
workspace.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && editing) {
    event.preventDefault();
    closeWordEditor();
  }
});
fitWord.addEventListener('click', () => {
  if (editing?.mode !== 'replace') return;
  const fit = fitWordBetweenNeighbors(thread, editing.id);
  if (fit.start >= fit.end) return;
  editing = { ...editing, start: fit.start, length: fit.end - fit.start, fitted: true };
  coverageStart = Math.max(0, fit.start - 8);
  otherLengths.open = false;
  refresh();
  focusWordEditor();
});
originalPosition.addEventListener('click', () => {
  if (editing?.mode !== 'replace') return;
  const word = thread.words.find(({ id }) => id === editing.id);
  editing = { ...editing, start: word.start, length: word.candidate[1].length, fitted: false };
  coverageStart = Math.max(0, word.start - 8);
  otherLengths.open = false;
  refresh();
  focusWordEditor();
});
removeWord.addEventListener('click', () => {
  if (editing?.mode !== 'replace') return;
  thread = removeThreadWord(thread, editing.id);
  editing = null;
  otherLengths.open = false;
  refresh();
  focusInView(sequence.querySelector('.thread-gap') ?? options.querySelector('button') ?? undo);
});
for (const [button, direction] of [[earlierDigits, -1], [laterDigits, 1]]) {
  button.addEventListener('click', () => {
    coverageStart += direction * COVERAGE_WINDOW;
    renderCoverage(true);
    if (button.disabled) focusInView(coverageWindow);
  });
}

async function openLibrary() {
  try {
    dictionary = await loadDictionary();
  } catch (failure) {
    libraryStatus.textContent = 'Word library unavailable.';
    libraryError.textContent = `DigitLoom could not open its word library. ${failure.message} Check that the data files are served with the app.`;
    libraryError.hidden = false;
    return;
  }
  number.disabled = false;
  autoSplit.disabled = false;
  commonOnly.disabled = false;
  frequencyCutoff.disabled = false;
  libraryStatus.textContent = `${dictionary.source.pairCount.toLocaleString('en-US')} word encodings, ready in your browser.`;
  libraryStatus.classList.add('visually-hidden');
  refresh();
}

openLibrary();

import { loadDictionary } from './dictionary.js';
import { chooseCandidate, formatNumber, getCandidates, groupCandidates, normalizeInput, partOfSpeechLabel, planChunks } from './logic.js';

const number = document.querySelector('#number');
const autoSplit = document.querySelector('#auto-split');
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

let dictionary;
let thread = { selected: [], remaining: '' };
let total = 0;
let error = '';

function choose(entry) {
  thread = chooseCandidate(thread, entry);
  refresh();
  window.scrollTo(0, 0);
  (options.querySelector('button') ?? undo).focus({ preventScroll: true });
}

function wordButton(entry, index) {
  const [word, code, flags] = entry;
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
  if (index < 5) {
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
  button.addEventListener('click', () => choose(entry));
  return button;
}

function showGroups(candidates) {
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
    detail.textContent = `${thread.remaining.slice(0, digitCount)} / ${words.length} choices`;
    header.append(title, detail);
    const choices = document.createElement('div');
    choices.className = 'choices';
    for (const [index, word] of words.entries()) choices.append(wordButton(word, index));
    section.append(header, choices);
    fragment.append(section);
  }
  options.replaceChildren(fragment);
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
  const chunks = autoSplit.checked && dictionary && !error ? planChunks(dictionary, thread.remaining) : null;
  const noSplit = autoSplit.checked && !error && thread.remaining.length > 0 && chunks === null;
  if (!error) updateNumber(formatNumber(thread.selected, chunks?.join(' ') ?? thread.remaining));
  inputError.hidden = !error;
  inputError.textContent = error;
  number.setAttribute('aria-invalid', String(Boolean(error)));
  undo.disabled = thread.selected.length === 0;
  clear.disabled = number.value.length === 0;
  memoryThread.hidden = thread.selected.length === 0;
  workspace.classList.toggle('has-input', number.value.length > 0);
  optionsArea.hidden = !total && !error;
  sequence.replaceChildren(...thread.selected.map(([word, code]) => {
    const item = document.createElement('li');
    const digits = document.createElement('small');
    digits.textContent = code;
    item.append(word, digits);
    return item;
  }));
  const encoded = total - thread.remaining.length;
  progress.max = Math.max(total, 1);
  progress.value = encoded;
  progressLabel.textContent = total ? `${encoded} of ${total} digits encoded` : 'No digits yet';

  const nextDigits = autoSplit.checked ? chunks?.[0] ?? '' : thread.remaining;
  const candidates = dictionary && !error
    ? getCandidates(dictionary, nextDigits).filter(([, code]) => !autoSplit.checked || code === nextDigits)
    : [];
  showGroups(candidates);
  heading.classList.toggle('visually-hidden', candidates.length > 0);
  emptyOptions.hidden = candidates.length > 0 || (total > 0 && !thread.remaining && !error);
  if (error) {
    heading.textContent = 'Check your number';
    emptyOptions.textContent = 'Replace letters or punctuation with digits to explore the word library.';
  } else if (!total) {
    heading.textContent = 'Type digits to begin';
    emptyOptions.textContent = 'Try 3277: a moon, a cake, a scene to remember.';
  } else if (!thread.remaining) {
    heading.textContent = 'Your number is encoded.';
  } else if (noSplit) {
    heading.textContent = 'No automatic split available';
    emptyOptions.textContent = 'This number cannot be fully split into available 2-4-digit words, with an optional final digit. Turn off Auto split to see all word lengths.';
  } else if (!candidates.length) {
    heading.textContent = 'No words for this prefix';
    emptyOptions.textContent = 'This dictionary has no matching word. Undo a choice or try a different number.';
  } else {
    heading.textContent = autoSplit.checked ? 'Choose a word for the next automatic chunk'
      : thread.selected.length ? 'Add to your memory thread' : 'Choose a word for the next digits';
  }
}

function readInput() {
  const parsed = normalizeInput(number.value);
  error = parsed.error;
  thread = { selected: [], remaining: parsed.ok ? parsed.digits : '' };
  total = thread.remaining.length;
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

undo.addEventListener('click', () => {
  const last = thread.selected.at(-1);
  if (!last) return;
  thread = { selected: thread.selected.slice(0, -1), remaining: last[1] + thread.remaining };
  refresh();
  if (undo.disabled) number.focus({ preventScroll: true });
});

clear.addEventListener('click', () => {
  number.value = '';
  error = '';
  total = 0;
  thread = { selected: [], remaining: '' };
  refresh();
  number.focus();
});

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
  libraryStatus.textContent = `${dictionary.source.pairCount.toLocaleString('en-US')} word encodings, ready in your browser.`;
  libraryStatus.classList.add('visually-hidden');
  refresh();
}

openLibrary();

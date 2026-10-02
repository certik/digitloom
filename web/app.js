import { loadDictionary } from './dictionary.js';
import { chooseCandidate, formatNumber, getCandidates, groupCandidates, normalizeInput, partOfSpeechLabel } from './logic.js';

const number = document.querySelector('#number');
const clear = document.querySelector('#clear');
const undo = document.querySelector('#undo');
const sequence = document.querySelector('#sequence');
const sequenceHint = document.querySelector('#sequence-hint');
const inputError = document.querySelector('#input-error');
const progress = document.querySelector('#progress');
const progressLabel = document.querySelector('#progress-label');
const heading = document.querySelector('#step-title');
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
  number.value = formatNumber(thread.selected, thread.remaining);
  refresh();
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
  const label = partOfSpeechLabel(flags);
  if (label) {
    const grammar = document.createElement('span');
    grammar.className = 'word-grammar';
    grammar.id = `grammar-${code}-${index}`;
    grammar.textContent = label;
    button.append(grammar);
    button.setAttribute('aria-describedby', grammar.id);
  }
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

function refresh() {
  inputError.hidden = !error;
  inputError.textContent = error;
  number.setAttribute('aria-invalid', String(Boolean(error)));
  undo.disabled = thread.selected.length === 0;
  clear.disabled = number.value.length === 0;
  sequenceHint.hidden = thread.selected.length > 0;
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

  const candidates = dictionary && !error ? getCandidates(dictionary, thread.remaining) : [];
  showGroups(candidates);
  emptyOptions.hidden = candidates.length > 0 || (total > 0 && !thread.remaining && !error);
  if (error) {
    heading.textContent = 'Check your number';
    emptyOptions.textContent = 'Replace letters or punctuation with digits to explore the word library.';
  } else if (!total) {
    heading.textContent = 'Type digits to begin';
    emptyOptions.textContent = 'Try 3277: a moon, a cake, a scene to remember.';
  } else if (!thread.remaining) {
    heading.textContent = 'Your number is encoded.';
  } else if (!candidates.length) {
    heading.textContent = 'No words for this prefix';
    emptyOptions.textContent = 'This dictionary has no matching word. Undo a choice or try a different number.';
  } else {
    heading.textContent = thread.selected.length ? 'Add to your memory thread' : 'Choose a word for the next digits';
  }
}

number.addEventListener('input', () => {
  const parsed = normalizeInput(number.value);
  error = parsed.error;
  thread = { selected: [], remaining: parsed.ok ? parsed.digits : '' };
  total = thread.remaining.length;
  if (parsed.ok) number.value = parsed.digits;
  refresh();
});

undo.addEventListener('click', () => {
  const last = thread.selected.at(-1);
  if (!last) return;
  thread = { selected: thread.selected.slice(0, -1), remaining: last[1] + thread.remaining };
  number.value = formatNumber(thread.selected, thread.remaining);
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
  libraryStatus.textContent = `${dictionary.source.pairCount.toLocaleString('en-US')} word encodings, ready in your browser.`;
  refresh();
}

openLibrary();

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, '..', 'analytics.html'), 'utf8');

function grab(name) {
  const i = HTML.indexOf('function ' + name);
  assert.ok(i >= 0, `Brak funkcji ${name}`);
  const b = HTML.slice(i);
  let d = 0, started = false, end = 0;
  for (let k = 0; k < b.length; k++) {
    if (b[k] === '{') { d++; started = true; }
    else if (b[k] === '}') { d--; if (started && d === 0) { end = k + 1; break; } }
  }
  return b.slice(0, end);
}

const api = new Function(
  'const ZROBIONE_SECTION_ID="6gj92pRv86Mh4Rvq";' +
  grab('isClosedBug') + grab('bugCostSummary') +
  '; return { isClosedBug, bugCostSummary };',
)();

const DONE = '6gj92pRv86Mh4Rvq';
const BUGS = '6gj92pQjFpC8gfrH';

test('isClosedBug: BUG: w Zrobione = zamknięty; inaczej nie', () => {
  assert.equal(api.isClosedBug({ section_id: DONE, content: 'BUG: format' }), true);
  assert.equal(api.isClosedBug({ section_id: DONE, content: 'Zwykły task' }), false, 'nie-BUG w Zrobione');
  assert.equal(api.isClosedBug({ section_id: BUGS, content: 'BUG: otwarty' }), false, 'BUG w Bugi = otwarty');
  assert.equal(api.isClosedBug({ section_id: DONE, content: '' }), false, 'pusta nazwa');
});

test('bugCostSummary sumuje koszty otwartych i zamkniętych + wskazuje najdroższy', () => {
  const open = [{ id: 'o1' }, { id: 'o2' }];
  const closed = [{ id: 'c1' }];
  const costById = new Map([['o1', 0.4], ['c1', 5.92]]); // o2 bez kosztu
  const s = api.bugCostSummary(open, closed, costById);
  assert.equal(+s.total.toFixed(2), 6.32);
  assert.equal(+s.openCost.toFixed(2), 0.4);
  assert.equal(+s.closedCost.toFixed(2), 5.92);
  assert.equal(+s.avg.toFixed(2), 2.11); // 6.32 / 3
  assert.equal(s.max.task.id, 'c1', 'najdroższy = c1');
});

test('bugCostSummary radzi sobie z pustymi listami', () => {
  const s = api.bugCostSummary([], [], new Map());
  assert.equal(s.total, 0);
  assert.equal(s.avg, 0);
  assert.equal(s.max, null);
});

test('renderBugs przyjmuje (open, closed, costItems) i renderuje obie sekcje', () => {
  const fn = grab('renderBugs');
  assert.match(fn, /function renderBugs\(openBugs,\s*closedBugs,\s*costItems\)/, 'Zła sygnatura renderBugs');
  assert.match(fn, /bugs-closed-tbody/, 'Brak renderowania zamkniętych');
  assert.match(fn, /bugNameCell\(task,\s*["']Otwarty["']\)/, 'Otwarte bez linku nazwy');
  assert.match(fn, /bugNameCell\(task,\s*["']Zamknięty["']\)/, 'Zamknięte bez linku nazwy');
  assert.match(fn, /Koszt błędów łącznie/, 'Brak podsumowania kosztów');
  assert.match(fn, /b\.priority\s*-\s*a\.priority/, 'Otwarte nie sortowane P1→P3');
});

test('loadData zwraca closedBugs', () => {
  const fn = grab('loadData');
  assert.match(fn, /closedBugs\s*=\s*tasks\.filter\(\(t\)\s*=>\s*isClosedBug\(t\)\)/, 'Brak wyliczenia closedBugs');
  assert.match(fn, /closedBugs,/, 'closedBugs nie w return');
});

test('HTML ma zwijaną sekcję zamkniętych bugów', () => {
  assert.match(HTML, /<details class="bugs-closed">/, 'Brak <details bugs-closed>');
  assert.match(HTML, /id="bugs-closed-tbody"/, 'Brak tbody zamkniętych');
  assert.match(HTML, /id="bugs-closed-count"/, 'Brak licznika zamkniętych');
  assert.match(HTML, /id="bugs-open-header"/, 'Brak nagłówka otwartych');
});

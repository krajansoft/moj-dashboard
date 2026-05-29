import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, '..', 'analytics.html'), 'utf8');

// Wyciąga ciało funkcji top-level z analytics.html (po nazwie, zliczając klamry)
function grab(name) {
  const i = HTML.indexOf('function ' + name);
  assert.ok(i >= 0, `Brak funkcji ${name} w analytics.html`);
  const b = HTML.slice(i);
  let d = 0, started = false, end = 0;
  for (let k = 0; k < b.length; k++) {
    if (b[k] === '{') { d++; started = true; }
    else if (b[k] === '}') { d--; if (started && d === 0) { end = k + 1; break; } }
  }
  return b.slice(0, end);
}

const urlFns = new Function(
  grab('todoistTaskUrl') + grab('todoistProjectUrl') + grab('bugPrioLabel') +
  '; return { todoistTaskUrl, todoistProjectUrl, bugPrioLabel };',
)();

test('todoistTaskUrl buduje link do konkretnego taska (nie projektu)', () => {
  const url = urlFns.todoistTaskUrl('6gjJqR6QPQ8R3JvH');
  assert.equal(url, 'https://app.todoist.com/app/task/6gjJqR6QPQ8R3JvH');
  assert.match(url, /\/app\/task\//, 'URL musi wskazywać na /task/, nie /project/');
});

test('todoistProjectUrl buduje link do projektu', () => {
  assert.equal(
    urlFns.todoistProjectUrl('6gj92jFJMwm2RmFq'),
    'https://app.todoist.com/app/project/6gj92jFJMwm2RmFq',
  );
});

test('bugPrioLabel mapuje priorytet API na etykietę', () => {
  assert.equal(urlFns.bugPrioLabel(4), 'P1');
  assert.equal(urlFns.bugPrioLabel(3), 'P2');
  assert.equal(urlFns.bugPrioLabel(2), 'P3');
});

test('renderBugs tworzy anchor nazwy błędu z target/rel i ikoną', () => {
  const fn = grab('renderBugs');
  assert.match(fn, /todoistTaskUrl\(task\.id\)/, 'Link nazwy nie używa todoistTaskUrl(task.id)');
  assert.match(fn, /\.target\s*=\s*["']_blank["']/, 'Brak target=_blank');
  assert.match(fn, /\.rel\s*=\s*["']noopener["']/, 'Brak rel=noopener');
  assert.match(fn, /link-icon/, 'Brak ikony ↗️ (link-icon)');
  assert.match(fn, /Priorytet:|Status:/, 'Brak tooltipa ze statusem/priorytetem');
});

test('karta "Łącznie otwartych" linkuje do projektu', () => {
  const fn = grab('renderBugs');
  assert.match(fn, /todoistProjectUrl\(PROJECT_ID\)/, 'Karta nie linkuje do projektu');
  assert.match(fn, /bug-stat-link/, 'Brak klasy bug-stat-link');
});

test('CSS .bug-link istnieje i pokazuje ikonę po najechaniu', () => {
  assert.match(HTML, /\.bug-link\s*\{/, 'Brak stylu .bug-link');
  assert.match(HTML, /\.bug-link:hover\s+\.link-icon/, 'Ikona nie pojawia się po najechaniu');
});

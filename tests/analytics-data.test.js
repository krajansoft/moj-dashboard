import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, '..', 'analytics.html'), 'utf8');

// Wyciąga ciało funkcji top-level z analytics.html (zliczając klamry)
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

// HIST_BUCKETS jest stałą modułową — odtwarzamy ją dla testu costHistogram
const PREAMBLE = `
  const HIST_BUCKETS = [
    { label: "$0–0.25", min: 0, max: 0.25, color: "#10b981" },
    { label: "$0.25–0.50", min: 0.25, max: 0.5, color: "#84cc16" },
    { label: "$0.50–1.00", min: 0.5, max: 1.0, color: "#fbbf24" },
    { label: "$1.00–2.00", min: 1.0, max: 2.0, color: "#fb923c" },
    { label: "$2.00+", min: 2.0, max: Infinity, color: "#f87171" },
  ];
`;

const api = new Function(
  PREAMBLE +
    grab('costHistogram') +
    grab('costStats') +
    grab('histogramInsight') +
    grab('dayBlockOf') +
    grab('buildHeatmap') +
    grab('heatmapInsight') +
    grab('buildPareto') +
    grab('parseBugSource') +
    grab('buildBugCostRows') +
    grab('bugCostStats') +
    grab('heatColor') +
    '; return { costHistogram, costStats, histogramInsight, dayBlockOf, buildHeatmap, heatmapInsight, buildPareto, buildBugCostRows, bugCostStats, heatColor };',
)();

test('costHistogram: kubełkuje koszty i trzyma listę tasków + skrajne przypadki', () => {
  const items = [
    { id: 'a', name: 'A', costUSD: 0.1 },
    { id: 'b', name: 'B', costUSD: 0.25 }, // granica → wpada do 0.25–0.50
    { id: 'c', name: 'C', costUSD: 0.7 },
    { id: 'd', name: 'D', costUSD: 1.5 },
    { id: 'e', name: 'E', costUSD: 3.0 }, // 2.00+
  ];
  const b = api.costHistogram(items);
  assert.equal(b.length, 5);
  assert.equal(b[0].count, 1, '$0–0.25 ma 1');
  assert.equal(b[1].count, 1, 'granica 0.25 wpada do drugiego kubełka');
  assert.equal(b[2].count, 1);
  assert.equal(b[3].count, 1);
  assert.equal(b[4].count, 1, '3.00 wpada do 2.00+');
  assert.equal(b[4].items[0].id, 'e');
});

test('costStats: mediana, odch. std i outliery (>2σ)', () => {
  // 9× ~0.5 + jeden 3.0 → 3.0 jest jednoznacznym outlierem (>2σ)
  const s = api.costStats([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 3.0]);
  assert.equal(s.n, 10);
  assert.equal(s.median, 0.5);
  assert.equal(s.max, 3.0);
  assert.ok(s.std > 0);
  assert.equal(s.outliers.length, 1);
  assert.equal(s.outliers[0].value, 3.0);
});

test('costStats: pusty zbiór nie wybucha', () => {
  const s = api.costStats([]);
  assert.equal(s.n, 0);
  assert.equal(s.median, 0);
  assert.equal(s.outliers.length, 0);
});

test('histogramInsight: ostrzega przy dużym rozrzucie, chwali przy stabilnym', () => {
  const wide = api.histogramInsight({ n: 10, median: 0.5, std: 0.4, outliers: [] });
  assert.ok(wide.some((m) => m.includes('nieprzewidywalne')));
  const stable = api.histogramInsight({ n: 10, median: 0.5, std: 0.1, outliers: [] });
  assert.ok(stable.some((m) => m.includes('przewidywalne')));
});

test('dayBlockOf: poniedziałek=0, blok 2h', () => {
  // 2026-05-25 to poniedziałek, 09:30 → blok 4 (08-10)
  const db = api.dayBlockOf('2026-05-25T09:30:00');
  assert.equal(db.day, 0);
  assert.equal(db.block, 4);
  // niedziela → day 6
  const sun = api.dayBlockOf('2026-05-31T23:00:00');
  assert.equal(sun.day, 6);
  assert.equal(sun.block, 11);
});

test('buildHeatmap + heatmapInsight: agreguje sesje i wskazuje najtańszy blok', () => {
  const sessions = [
    { postedAt: '2026-05-25T07:00:00', costUSD: 0.2 }, // pon, blok 3
    { postedAt: '2026-05-25T07:30:00', costUSD: 0.2 }, // pon, blok 3
    { postedAt: '2026-05-25T15:00:00', costUSD: 2.0 }, // pon, blok 7
    { postedAt: '2026-05-26T15:00:00', costUSD: 1.6 }, // wt, blok 7
  ];
  const hm = api.buildHeatmap(sessions);
  assert.equal(hm.totalSessions, 4);
  assert.equal(hm.grid[3][0].count, 2);
  assert.equal(hm.grid[3][0].sum.toFixed(2), '0.40');
  const ins = api.heatmapInsight(hm);
  assert.equal(ins.best.block, 3, 'najtańszy blok = poranny');
  assert.equal(ins.best.day, 0);
  assert.ok(ins.savingsPct > 0, 'poranek tańszy niż średnia');
});

test('buildPareto: sortuje malejąco, liczy kumulację i flaguje vital few do 80%', () => {
  const { rows, total } = api.buildPareto([
    { source: 'SKILL', cost: 6 },
    { source: 'HUMAN', cost: 3 },
    { source: 'CONFIG', cost: 1 },
  ]);
  assert.equal(total, 10);
  assert.equal(rows[0].source, 'SKILL');
  assert.equal(rows[0].cumPct, 60);
  assert.equal(rows[1].cumPct, 90);
  assert.equal(rows[0].vital, true, 'SKILL vital');
  assert.equal(rows[1].vital, true, 'HUMAN domyka 80% → vital');
  assert.equal(rows[2].vital, false, 'CONFIG to trivial many');
});

test('buildBugCostRows + bugCostStats: koszt znalezienia/naprawy/łącznie + błąd estymy', () => {
  const bugs = [
    { id: 'b1', content: 'BUG: x', description: '💡 ESTYMATA: $0.10—$0.30 | 2026-05-01' },
    { id: 'b2', content: 'BUG: y', description: 'brak estymaty' },
  ];
  const costUSD = new Map([['b1', 0.4], ['b2', 0.2]]);
  const findUSD = new Map([['b1', 0.1]]); // tylko b1 ma koszt znalezienia
  const estMid = new Map([['b1', 0.2]]);
  const rows = api.buildBugCostRows(bugs, costUSD, findUSD, estMid);
  assert.equal(rows[0].findUSD, 0.1);
  assert.equal(rows[0].fixUSD, 0.4);
  assert.equal(rows[0].totalUSD.toFixed(2), '0.50');
  assert.equal(rows[0].estErrPct, 100, '(0.4-0.2)/0.2 = 100%');
  assert.equal(rows[1].findUSD, null, 'brak danych → null (kolumna —)');
  assert.equal(rows[1].estErrPct, null);

  const stats = api.bugCostStats(rows, 2.0);
  assert.equal(stats.n, 2);
  assert.equal(stats.totalUSD.toFixed(2), '0.70');
  assert.equal(stats.findTotal.toFixed(2), '0.10');
  assert.equal(stats.fixTotal.toFixed(2), '0.60');
  assert.equal(stats.max.id, 'b1', 'najdroższy = b1 (0.50)');
  assert.equal(stats.pctOfBudget.toFixed(0), '35', '0.70/2.00 = 35%');
});

test('heatColor: zwraca rgb i przesuwa się zielony→czerwony', () => {
  assert.match(api.heatColor(0), /^rgb\(/);
  assert.equal(api.heatColor(0), 'rgb(16, 185, 129)');
  assert.equal(api.heatColor(1), 'rgb(248, 113, 113)');
  // wartości spoza zakresu są klampowane
  assert.equal(api.heatColor(-5), api.heatColor(0));
  assert.equal(api.heatColor(9), api.heatColor(1));
});

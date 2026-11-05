// Pulls the session history logic out of index.html and checks the summary and the JSON-lines storage format.
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.slice(html.indexOf('// ---------- helpers'), html.indexOf('function current()'));
const state = { sens: 5, splitMode: 'auto' };
const api = new Function('state', ['const BUCKETS = 100;', src,
  'return { snapshot, summarizeSession, appendHistory, parseHistory, newestFirst, historyRow, steadyLabel, isSession };'].join('\n'))(state);

// A fake finished engine: hits every 0.6 s (100 bpm), feet on 1 and 3, hands on 2 and 4, small fixed jitter.
function fakeEngine(n, duration) {
  const jit = [0, 0.012, -0.008, 0.005, -0.011, 0.007, 0, -0.004];
  const onsets = [];
  for (let i = 0; i < n; i++) onsets.push({ t: 1 + i * 0.6 + jit[i % jit.length], feat: i % 2 ? 2 : -2, loud: 0.5, lane: 'all' });
  return { onsets, pmin: [], pmax: [], amp: 0.02, time: () => duration };
}
const started = Date.UTC(2026, 10, 4, 22, 15, 0);

// summary of a session with enough hits
const D = api.snapshot(fakeEngine(32, 21.3), false);
const rec = api.summarizeSession(D, started, state);
assert(rec, 'a session with 32 hits is saved');
assert.strictEqual(rec.v, 1);
assert.strictEqual(rec.start, '2026-11-04T22:15:00.000Z', 'start time as ISO');
assert.strictEqual(rec.durationS, 21.3);
assert.strictEqual(rec.hits, 32);
assert(Math.abs(rec.avgBpm - 100) < 1, 'average tempo near 100, got ' + rec.avgBpm);
assert.strictEqual(rec.avgBpm, Math.round(rec.avgBpm * 10) / 10, 'tempo rounded to 0.1');
assert.strictEqual(rec.steadiness, D.all.steadiness);
assert.strictEqual(rec.spreadMs, Math.round(D.all.jitterMs));
assert(Number.isInteger(rec.spreadMs) && rec.spreadMs > 0, 'spread in whole ms');
for (const k of ['peakBpm', 'lowBpm', 'driftBpm', 'pauses']) assert(Number.isFinite(rec[k]), k + ' kept');
assert.strictEqual(rec.sensitivity, 5); assert.strictEqual(rec.sort, 'auto');
assert(D.split, 'fake take splits into lanes');
assert.strictEqual(rec.lanes.feet.hits, 16); assert.strictEqual(rec.lanes.hands.hits, 16);
assert(Math.abs(rec.lanes.feet.avgBpm - 50) < 1, 'feet pulse is every other hit, got ' + rec.lanes.feet.avgBpm);
assert(JSON.stringify(rec).length < 600, 'a record stays small');

// one lane: no lanes field
state.splitMode = 'one';
const one = api.summarizeSession(api.snapshot(fakeEngine(32, 21.3), false), started, state);
assert.strictEqual(one.lanes, undefined); assert.strictEqual(one.sort, 'one');
state.splitMode = 'auto';

// too few hits, or nothing at all, is not a session
assert.strictEqual(api.summarizeSession(api.snapshot(fakeEngine(4, 3), false), started, state), null, '4 hits is not a session');
assert.strictEqual(api.summarizeSession(null, started, state), null, 'no data is not a session');

// serialization: append-only JSON lines, round trip
let text = '';
text = api.appendHistory(text, rec);
assert(text.endsWith('\n') && text.split('\n').length === 2, 'one line per session');
const later = Object.assign({}, rec, { start: '2026-11-05T08:00:00.000Z', steadiness: 91 });
text = api.appendHistory(text, later);
assert(text.startsWith(JSON.stringify(rec) + '\n'), 'appending never rewrites earlier lines');
assert.deepStrictEqual(api.parseHistory(text), [rec, later], 'round trip');
assert.strictEqual(api.appendHistory('{"a":1}', rec).split('\n')[1], JSON.stringify(rec), 'adds a missing newline before appending');

// parsing survives damage and junk
assert.deepStrictEqual(api.parseHistory(null), []);
assert.deepStrictEqual(api.parseHistory(''), []);
const damaged = JSON.stringify(rec) + '\n{"start":"2026-11-05T0\n\n[1,2]\n{"start":"not a date","avgBpm":1,"steadiness":1,"spreadMs":1}\n' + JSON.stringify(later) + '\r\n';
assert.deepStrictEqual(api.parseHistory(damaged), [rec, later], 'skips broken, blank and invalid lines, tolerates CRLF');

// newest first, without changing the stored order
const list = [later, rec];
const early = Object.assign({}, rec, { start: '2026-10-30T12:00:00.000Z' });
assert.deepStrictEqual(api.newestFirst([rec, early, later]).map((r) => r.start), [later.start, rec.start, early.start]);
assert.deepStrictEqual(list.map((r) => r.start), [later.start, rec.start], 'input not mutated');

// display row
const row = api.historyRow({ start: rec.start, durationS: 125.4, hits: 64, avgBpm: 101.6, steadiness: 87, spreadMs: 18 });
assert.deepStrictEqual(row, { bpm: '102', steady: '87', cls: 'good', word: 'Steady', spread: '±18', detail: '2:05 · 64 hits' });
assert.strictEqual(api.historyRow({ start: rec.start, avgBpm: 90, steadiness: 40, spreadMs: 70 }).detail, '0:00', 'old or partial records still show');
assert.deepStrictEqual([95, 90, 89, 75, 74, 55, 54].map((s) => api.steadyLabel(s)[1]), ['Metronome', 'Metronome', 'Steady', 'Steady', 'A bit loose', 'A bit loose', 'Wobbly']);

console.log(`ok: history record ${JSON.stringify(rec).length} bytes, ${rec.avgBpm} bpm, steadiness ${rec.steadiness}, spread ±${rec.spreadMs} ms`);

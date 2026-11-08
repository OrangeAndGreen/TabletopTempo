// Pulls the set-tempo logic out of index.html and checks the grid scoring, the summary and what goes into the history.
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.slice(html.indexOf('// ---------- helpers'), html.indexOf('function current()'));
const state = { sens: 5, splitMode: 'one' };
const api = new Function('state', ['const BUCKETS = 100;', src,
  'return { clampBpm, makeGrid, scoreHits, unwrapOffsets, gridSummary, fmtOffset, driftWord, trendWord, snapshot, summarizeSession, historyRow, COUNT_IN };'].join('\n'))(state);
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: expected ${b} ± ${tol}, got ${a}`);
let checks = 0; const ok = (fn) => { fn(); checks++; };

// BPM picker: whole numbers, kept to 40-200, junk falls back to 100
ok(() => {
  assert.deepStrictEqual([40, 200, 120, 39, 201, 0, -5, 1000].map(api.clampBpm), [40, 200, 120, 40, 200, 40, 40, 200]);
  assert.deepStrictEqual(['96', '96.4', '96.6', '', 'abc', null, undefined, NaN].map(api.clampBpm), [96, 96, 97, 100, 100, 100, 100, 100]);
});

// grid: beat 0 is the first count-in pulse, scoring starts half a beat before the first silent beat
const grid = api.makeGrid(2, 120); // a beat every 0.5 s, pulses at 2.0, 2.5, 3.0, 3.5
ok(() => {
  assert.strictEqual(api.COUNT_IN, 4);
  assert.strictEqual(grid.interval, 0.5); assert.strictEqual(grid.bpm, 120); assert.strictEqual(grid.start, 2);
  assert.strictEqual(grid.from, 3.75, 'first scored beat is 4.0, scoring opens at 3.75');
});

// each hit: nearest beat, early negative, late positive, count-in hits skipped
ok(() => {
  const s = api.scoreHits([2.0, 2.5, 3.5, 3.74, 4.0, 4.52, 4.97, 5.249, 5.251, 60.0], grid);
  assert.deepStrictEqual(s.map((h) => h.beat), [4, 5, 6, 6, 7, 116], 'count-in hits are not scored');
  [0, 20, -30, 249, -249, 0].forEach((ms, i) => near(s[i].offMs, ms, 1e-6, 'offset of hit ' + i));
  assert.deepStrictEqual(api.scoreHits([], grid), []);
  assert.deepStrictEqual(api.scoreHits([1, 2, 3], grid), [], 'nothing after the count-in');
});

// summary: drift = mean offset, spread around it, miss from the grid, early/late counts
ok(() => {
  const offs = [10, 30, 20, 40, 0, 20, 30, 10]; // mean 20
  const times = offs.map((ms, i) => 4 + i * 0.5 + ms / 1000);
  const m = api.gridSummary(api.scoreHits(times, grid), grid);
  assert.strictEqual(m.hits, 8); assert.strictEqual(m.bpm, 120);
  near(m.meanMs, 20, 1e-6, 'mean offset');
  near(m.spreadMs, 10, 1e-6, 'spread is the typical distance from the mean');
  near(m.missMs, 20, 1e-6, 'typical miss from the grid');
  assert.strictEqual(m.early, 0); assert.strictEqual(m.late, 7, 'a hit dead on is neither');
});

// a player who rushes evenly: no wobble, a falling trend and a faster played tempo
ok(() => {
  // plays at 125 bpm (0.48 s) against a 120 grid, landing on beat 4: each beat 20 ms earlier
  const times = []; for (let i = 0; i < 10; i++) times.push(4 + i * 0.48);
  const m = api.gridSummary(api.scoreHits(times, grid), grid);
  near(m.meanMs, -90, 1e-6, 'drifts early on average');
  near(m.trendMsPerMin, -2500, 1e-6, '20 ms earlier per beat at 2 beats per second'); // -20 ms per 0.48 s
  near(m.playedBpm, 125, 1e-6, 'tempo played from the trend');
  assert.strictEqual(api.trendWord(m.trendMsPerMin), 'pulling ahead');
  assert.strictEqual(m.early, 9);
});

// drifting past half a beat: per-hit offsets snap to the next beat, the trend keeps counting
ok(() => {
  const times = []; for (let i = 0; i < 40; i++) times.push(4 + i * 0.48); // 40 hits at 125 bpm: 780 ms early by the end
  const s = api.scoreHits(times, grid);
  assert(s.some((h) => h.offMs > 0), 'nearest-beat offsets wrap round to late');
  const un = api.unwrapOffsets(s, grid.interval);
  un.forEach((v, i) => near(v, -20 * i, 1e-6, 'unwrapped offset ' + i));
  const m = api.gridSummary(s, grid);
  near(m.playedBpm, 125, 1e-6, 'played tempo survives the wrap');
  near(m.trendMsPerMin, -2500, 1e-6, 'trend survives the wrap');
  // rests (a skipped beat) do not confuse the unwrap
  const rests = [4, 4.5, 5.51, 6.0, 7.02, 7.5];
  assert.deepStrictEqual(api.unwrapOffsets(api.scoreHits(rests, grid), grid.interval).map(Math.round), [0, 0, 10, 0, 20, 0]);
});

// dragging the other way, and holding the grid with a steady offset
ok(() => {
  const late = []; for (let i = 0; i < 12; i++) late.push(4 + i * 0.505);
  const m = api.gridSummary(api.scoreHits(late, grid), grid);
  assert(m.trendMsPerMin > 0 && m.playedBpm < 120, 'slower than the grid falls behind');
  assert.strictEqual(api.trendWord(m.trendMsPerMin), 'falling behind');
  const held = []; for (let i = 0; i < 13; i++) held.push(4 + i * 0.5 + 0.015 + (i % 2 ? 0.004 : -0.004));
  const h = api.gridSummary(api.scoreHits(held, grid), grid);
  near(h.meanMs, 15 - 4 / 13, 1e-6, 'steady 15 ms late');
  assert(Math.abs(h.trendMsPerMin) < 20, 'no trend, got ' + h.trendMsPerMin);
  near(h.playedBpm, 120, 0.1, 'played the target');
  assert.strictEqual(api.trendWord(h.trendMsPerMin), 'held the grid');
  assert.strictEqual(api.driftWord(h.meanMs), 'late on average');
  assert.strictEqual(api.driftWord(-12), 'early on average');
  assert.strictEqual(api.driftWord(9.9), 'on the grid');
});

// too few hits for a summary; a single instant gives no trend rather than NaN
ok(() => {
  assert.strictEqual(api.gridSummary(api.scoreHits([4, 4.5, 5], grid), grid), null);
  const same = api.gridSummary([4, 4, 4, 4].map((t) => ({ t, beat: 4, offMs: 0 })), grid);
  assert.strictEqual(same.trendMsPerMin, 0); assert.strictEqual(same.playedBpm, 120);
});

// display text, shared by both modes
ok(() => {
  assert.deepStrictEqual(api.fmtOffset(12.4), ['+12', 'ms late']);
  assert.deepStrictEqual(api.fmtOffset(-7.6), ['−8', 'ms early']);
  assert.deepStrictEqual(api.fmtOffset(0.3), ['0', 'ms, on it']);
  assert.deepStrictEqual(api.fmtOffset(-0.4), ['0', 'ms, on it'], 'no minus zero');
});

// through snapshot and into the history record
function fakeEngine(times, duration) {
  return { onsets: times.map((t) => ({ t, feat: 0, loud: 0.5, lane: 'all' })), pmin: [], pmax: [], amp: 0.02, time: () => duration };
}
const started = Date.UTC(2026, 10, 7, 21, 0, 0);
ok(() => {
  // a 100 bpm grid from 1 s: count-in at 1.0-2.8, then 24 hits that start about 10 ms late and drag 1 ms per beat
  const g = api.makeGrid(1, 100), times = [1.0, 1.6, 2.2]; // tapping along with the count-in: not scored
  for (let i = 0; i < 24; i++) times.push(1 + (4 + i) * 0.6 + 0.0102 + i * 0.001);
  const D = api.snapshot(fakeEngine(times, 20), false, g);
  assert(D.target && D.target.grid === g, 'snapshot carries the grid');
  assert.strictEqual(D.target.scored.length, 24);
  assert.strictEqual(D.target.scored[0].lane, 'all', 'lane carried onto scored hits');
  near(D.target.sum.meanMs, 21.7, 1e-6, 'mean offset');
  assert(D.target.sum.trendMsPerMin > 90 && D.target.sum.trendMsPerMin < 110, 'about 100 ms/min late trend, got ' + D.target.sum.trendMsPerMin);
  assert(D.all, 'free-mode numbers still computed');
  const rec = api.summarizeSession(D, started, state);
  assert.deepStrictEqual(Object.keys(rec.target), ['bpm', 'hits', 'meanMs', 'spreadMs', 'trendMsPerMin', 'playedBpm']);
  assert.strictEqual(rec.target.bpm, 100); assert.strictEqual(rec.target.hits, 24); assert.strictEqual(rec.target.meanMs, 22);
  assert(Number.isInteger(rec.target.spreadMs) && Number.isInteger(rec.target.trendMsPerMin));
  assert(rec.target.playedBpm < 100, 'dragging plays under the target, got ' + rec.target.playedBpm);
  assert.strictEqual(api.historyRow(rec).detail, '0:20 · 27 hits · set 100, +22 ms late');
});

// free mode is unchanged: no grid, no target in the snapshot or the record
ok(() => {
  const times = []; for (let i = 0; i < 20; i++) times.push(1 + i * 0.6);
  const D = api.snapshot(fakeEngine(times, 13), false);
  assert.strictEqual(D.target, null);
  const rec = api.summarizeSession(D, started, state);
  assert.strictEqual(rec.target, undefined);
  assert.strictEqual(api.historyRow(rec).detail, '0:13 · 20 hits');
  // a set-tempo take too short to summarize keeps its scored hits but stores no target
  const short = api.snapshot(fakeEngine([1, 1.6, 2.2, 2.8, 3.4, 4.0, 4.6], 5), false, api.makeGrid(1, 100));
  assert.strictEqual(short.target.scored.length, 3); assert.strictEqual(short.target.sum, null);
  assert.strictEqual(api.summarizeSession(short, started, state).target, undefined);
});

console.log(`ok: ${checks} set-tempo checks`);

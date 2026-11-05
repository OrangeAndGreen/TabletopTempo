// Pulls the engine and analysis out of index.html and checks them on a synthesized take.
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.slice(html.indexOf('// ---------- helpers'), html.indexOf('function current()'));
const state = { sens: 5, splitMode: 'auto' };
const api = new Function('state', ['const BUCKETS = 100;', src, 'return { createEngine, snapshot };'].join('\n'))(state);

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// 24 s at 100 -> ~104 bpm: stomps on 1 and 3, slaps on 2 and 4, two bars of slaps only, 16 ms timing jitter
function makeTake() {
  const sr = 22050, dur = 24, len = sr * dur, x = new Float32Array(len), rnd = mulberry32(7), times = [];
  const gauss = () => { let a = 0; while (!a) a = rnd(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * rnd()); };
  for (let i = 0; i < len; i++) x[i] = (rnd() * 2 - 1) * 0.004;
  const stomp = (t, a) => { const s = Math.round(t * sr), L = Math.round(0.25 * sr); let ph = 0;
    for (let i = 0; i < L && s + i < len; i++) { const tt = i / sr; ph += 2 * Math.PI * (58 - 56 * tt) / sr; x[s + i] += a * Math.exp(-tt / 0.07) * Math.min(1, i / (0.002 * sr)) * Math.sin(ph) + a * 0.12 * Math.exp(-tt / 0.005) * (rnd() * 2 - 1); } };
  const slap = (t, a) => { const s = Math.round(t * sr), L = Math.round(0.18 * sr); let prev = 0, ph = 0;
    for (let i = 0; i < L && s + i < len; i++) { const tt = i / sr, nz = rnd() * 2 - 1; ph += 2 * Math.PI * 190 / sr; x[s + i] += a * Math.exp(-tt / 0.03) * (nz - prev) * 0.8 + a * 0.25 * Math.exp(-tt / 0.03) * Math.sin(ph); prev = nz; } };
  let t = 0.8, k = 0, feet = 0;
  while (t < dur - 0.8) {
    const bar = Math.floor(k / 4), beat = k % 4, fill = bar >= 8 && bar < 10, jt = t + gauss() * 0.016;
    if (fill) slap(jt, 0.45 + rnd() * 0.15); else if (beat % 2 === 0) { stomp(jt, 0.7 + rnd() * 0.2); feet++; } else slap(jt, 0.5 + rnd() * 0.15);
    times.push(jt); t += 0.6 - 0.023 * (t / dur); k++;
  }
  return { x, sr, times, feet };
}
function run(x, sr, chunk) {
  const E = api.createEngine(sr);
  for (let i = 0; i < x.length; i += chunk) E.push(x.subarray(i, i + chunk));
  E.finish();
  return api.snapshot(E, false);
}

const take = makeTake();
const D = run(take.x, take.sr, 1024);
assert.strictEqual(D.onsets.length, take.times.length, 'finds every hit');
D.onsets.forEach((o, i) => assert(Math.abs(o.t - take.times[i]) < 0.02, `hit ${i} within 20 ms`));
assert(D.split, 'splits hands and feet');
assert.strictEqual(D.onsets.filter((o) => o.lane === 'feet').length, take.feet, 'sorts stomps as feet');
assert(Math.abs(D.all.avgBpm - 102) < 3, 'average tempo near 102, got ' + D.all.avgBpm);
assert(D.all.steadiness >= 80 && D.all.steadiness <= 95, 'steadiness in range, got ' + D.all.steadiness);
for (const chunk of [128, 333, 4096]) assert.deepStrictEqual(run(take.x, take.sr, chunk).onsets.map((o) => o.t), D.onsets.map((o) => o.t), 'same hits at chunk ' + chunk);

state.sens = 10;
const rnd = mulberry32(3), noise = new Float32Array(48000 * 10);
for (let i = 0; i < noise.length; i++) noise[i] = (rnd() * 2 - 1) * 0.003;
assert.strictEqual(run(noise, 48000, 1024).onsets.length, 0, 'noise alone gives no hits');
console.log(`ok: ${D.onsets.length} hits, ${Math.round(D.all.avgBpm)} bpm, steadiness ${D.all.steadiness}`);

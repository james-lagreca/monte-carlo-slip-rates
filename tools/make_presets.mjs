/**
 * Generate data/presets/*.json.
 *
 * The synthetic presets are forward-modelled from a stated ground truth, so a
 * page can print "the answer you are trying to recover is 3.00" and mean it.
 * If you edit one, re-run this and then re-run tools/verify.js and
 * tools/make_fixtures.mjs, because the prose on the pages quotes measured
 * output and the teaching only works while the numbers and the words agree.
 *
 *   node tools/make_presets.mjs
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';

mkdirSync('data/presets', { recursive: true });
const w = (id, obj) => writeFileSync('data/presets/' + id + '.json', JSON.stringify(obj, null, 2) + '\n');
const U = { age: 'ka', displacement: 'm', rate: 'mm/yr' };
const SYN = 'Invented for teaching. Not a real site and not real measurements.';

/* ---------- Method 1 ---------- */

w('single-well-behaved', {
  id: 'single-well-behaved', kind: 'single', synthetic: true,
  title: 'A well-dated marker',
  teaches: 'With a tightly constrained age, Monte Carlo and naive error propagation agree.',
  provenance: SYN, units: U,
  truth: { slipRate: 3.0, note: 'Offset and age chosen so the answer is exactly 3.00 mm/yr.' },
  displacement: { type: 'pert', min: 10.5, mode: 12.0, max: 13.5 },
  age: { type: 'gauss', mean: 4.0, sd: 0.2 },
  anchor: null,
});

w('single-poorly-dated', {
  id: 'single-poorly-dated', kind: 'single', synthetic: true,
  title: 'The same marker, a worse age',
  teaches: 'Identical displacement, age sigma raised from 0.20 to 0.90 ka. The rate grows a long right tail and the naive interval stops being usable.',
  provenance: SYN, units: U,
  truth: { slipRate: 3.0, note: 'Same offset as single-well-behaved. Only the age changed.' },
  displacement: { type: 'pert', min: 10.5, mode: 12.0, max: 13.5 },
  age: { type: 'gauss', mean: 4.0, sd: 0.9 },
  anchor: null,
});

w('single-two-restorations', {
  id: 'single-two-restorations', kind: 'single', synthetic: true,
  title: 'Two defensible restorations',
  teaches: 'When two reconstructions are equally valid, the honest displacement PDF is a trapezoid whose flat top spans both.',
  provenance: SYN, units: U,
  truth: { slipRate: 3.0, note: 'The flat top runs from 11 to 13 m.' },
  displacement: { type: 'trapezoid', min: 9.0, lo: 11.0, hi: 13.0, max: 15.0 },
  age: { type: 'gauss', mean: 4.0, sd: 0.3 },
  anchor: null,
});

// A bimodal age, as a calibration plateau produces.
const pts = [];
for (let i = 0; i <= 160; i++) {
  const x = 3.0 + i * (2.6 / 160);
  const p = Math.exp(-0.5 * Math.pow((x - 3.55) / 0.16, 2))
          + 0.85 * Math.exp(-0.5 * Math.pow((x - 4.65) / 0.20, 2));
  pts.push([Number(x.toFixed(4)), Number(p.toFixed(8))]);
}
w('single-calibrated-14c', {
  id: 'single-calibrated-14c', kind: 'single', synthetic: true,
  title: 'A bimodal calibrated age',
  teaches: 'Calibration wiggles routinely split an age into two plateaux. The rate inherits the split, and a single interval hides it. This is what HPD clusters are for.',
  provenance: SYN + ' The shape imitates what OxCal produces across a calibration plateau.',
  units: U, truth: null,
  displacement: { type: 'pert', min: 10.5, mode: 12.0, max: 13.5 },
  age: { type: 'empirical', points: pts },
  anchor: null,
});

/* ---------- Method 2: forward-modelled from exactly 3.00 mm/yr ---------- */

const anchor = { id: 'mre', label: 'MRE', age: { type: 'boxcar', min: 0.25, max: 0.55 } };

w('multi-well-behaved', {
  id: 'multi-well-behaved', kind: 'multi', synthetic: true,
  title: 'Four markers that agree',
  teaches: 'Every realisation satisfies monotonicity, so acceptance is 100 per cent and every interval recovers the rate the data were built from.',
  provenance: SYN, units: U,
  truth: { slipRate: 3.0, onset: 0.40, note: 'Offsets are exactly 3.0 x (t - 0.40).' },
  anchor,
  markers: [
    { id: 'm1', label: 'M1', displacement: { type: 'pert', min: 3.0, mode: 3.6, max: 4.2 }, age: { type: 'gauss', mean: 1.60, sd: 0.15 } },
    { id: 'm2', label: 'M2', displacement: { type: 'pert', min: 7.0, mode: 8.1, max: 9.2 }, age: { type: 'gauss', mean: 3.10, sd: 0.22 } },
    { id: 'm3', label: 'M3', displacement: { type: 'pert', min: 11.6, mode: 13.2, max: 14.8 }, age: { type: 'gauss', mean: 4.80, sd: 0.30 } },
    { id: 'm4', label: 'M4', displacement: { type: 'pert', min: 18.8, mode: 21.0, max: 23.2 }, age: { type: 'gauss', mean: 7.40, sd: 0.45 } },
  ],
});

w('multi-inconsistent', {
  id: 'multi-inconsistent', kind: 'multi', synthetic: true,
  title: 'Markers that overlap each other',
  teaches: 'Ages spaced too closely relative to their errors. Acceptance falls, and the interval rates come back too wide to say anything with.',
  provenance: SYN, units: U, truth: null, anchor: null,
  markers: [
    { id: 'm1', label: 'M1', displacement: { type: 'pert', min: 4.0, mode: 4.8, max: 5.6 }, age: { type: 'gauss', mean: 2.60, sd: 0.60 } },
    { id: 'm2', label: 'M2', displacement: { type: 'pert', min: 7.0, mode: 9.5, max: 12.0 }, age: { type: 'gauss', mean: 3.20, sd: 0.60 } },
    { id: 'm3', label: 'M3', displacement: { type: 'pert', min: 11.0, mode: 14.6, max: 18.0 }, age: { type: 'gauss', mean: 3.90, sd: 0.65 } },
    { id: 'm4', label: 'M4', displacement: { type: 'pert', min: 17.5, mode: 22.4, max: 27.0 }, age: { type: 'gauss', mean: 4.60, sd: 0.70 } },
  ],
});

w('multi-mispaired', {
  id: 'multi-mispaired', kind: 'multi', synthetic: true,
  title: 'One mispaired age',
  teaches: 'M3 had a long active phase, so the date on its fill is younger than M2 even though it carries more offset. Acceptance collapses and one interval rate explodes.',
  provenance: SYN, units: U,
  truth: { slipRate: 3.0, onset: 0.0, note: 'True formation ages are 1.70, 3.45, 5.00 and 7.60 ka. Only M3 is badly mispaired.' },
  anchor: null,
  markers: [
    { id: 'm1', label: 'M1', displacement: { type: 'pert', min: 4.4, mode: 5.1, max: 5.8 }, age: { type: 'gauss', mean: 1.55, sd: 0.20 } },
    { id: 'm2', label: 'M2', displacement: { type: 'pert', min: 9.0, mode: 10.4, max: 11.8 }, age: { type: 'gauss', mean: 3.30, sd: 0.30 } },
    { id: 'm3', label: 'M3', displacement: { type: 'pert', min: 13.2, mode: 15.0, max: 16.8 }, age: { type: 'gauss', mean: 2.90, sd: 0.30 } },
    { id: 'm4', label: 'M4', displacement: { type: 'pert', min: 20.4, mode: 22.8, max: 25.2 }, age: { type: 'gauss', mean: 7.40, sd: 0.45 } },
  ],
});

w('multi-mispaired-control', {
  id: 'multi-mispaired-control', kind: 'multi', synthetic: true,
  title: 'The same markers, correctly paired',
  teaches: 'Identical to multi-mispaired except M3 carries its true formation age of 5.00 ka. Everything relaxes.',
  provenance: SYN, units: U,
  truth: { slipRate: 3.0, onset: 0.0, note: 'The control for multi-mispaired.' },
  anchor: null,
  markers: [
    { id: 'm1', label: 'M1', displacement: { type: 'pert', min: 4.4, mode: 5.1, max: 5.8 }, age: { type: 'gauss', mean: 1.55, sd: 0.20 } },
    { id: 'm2', label: 'M2', displacement: { type: 'pert', min: 9.0, mode: 10.4, max: 11.8 }, age: { type: 'gauss', mean: 3.30, sd: 0.30 } },
    { id: 'm3', label: 'M3', displacement: { type: 'pert', min: 13.2, mode: 15.0, max: 16.8 }, age: { type: 'gauss', mean: 5.00, sd: 0.30 } },
    { id: 'm4', label: 'M4', displacement: { type: 'pert', min: 20.4, mode: 22.8, max: 25.2 }, age: { type: 'gauss', mean: 7.40, sd: 0.45 } },
  ],
});

/* ---------- Published benchmarks ---------- */

const CAVEAT = ' Digitised as minimum and maximum bounds and loaded here as uniform PDFs. '
  + 'The published analysis used fuller PDF shapes, so the rates computed on this page are '
  + 'illustrative recomputations, not reproductions of the published values.';

const gc = [[1, 5.5, 7.1, 1.06, 3.0], [2, 8.0, 10.5, 1.06, 6.0], [3, 12.9, 15.5, 2.0, 7.4],
            [4, 29.0, 36.0, 3.92, 7.4], [5, 40.0, 58.0, 6.0, 16.0], [6, 60.0, 102.0, 13.0, 16.0]];
w('published-gold-cowgill', {
  id: 'published-gold-cowgill', kind: 'multi', synthetic: false,
  title: 'Gold and Cowgill (2011), six markers',
  teaches: 'Real bracketing constraints, heavily overlapping in age. This is the case rejection sampling was designed for: about a fifth of realisations survive.',
  provenance: 'Displacement and age brackets after Gold and Cowgill (2011), Earth and Planetary Science Letters.' + CAVEAT,
  units: U, truth: null, anchor: null,
  markers: gc.map((r) => ({
    id: 'm' + r[0], label: 'M' + r[0],
    displacement: { type: 'boxcar', min: r[1], max: r[2] },
    age: { type: 'boxcar', min: r[3], max: r[4] },
  })),
});

const zw = [[1, 4.0, 6.0, 1.90, 2.10], [2, 13.5, 16.5, 2.70, 3.20], [3, 23.0, 27.0, 3.20, 6.00],
            [4, 25.2, 27.5, 8.07, 9.12], [5, 36.1, 40.2, 8.50, 9.57], [6, 36.7, 39.8, 9.06, 10.14],
            [7, 49.1, 53.6, 9.52, 10.88], [8, 52.0, 56.0, 10.40, 11.80], [9, 56.5, 60.5, 11.12, 12.83]];
w('published-zinke-wairau', {
  id: 'published-zinke-wairau', kind: 'multi', synthetic: false,
  title: 'Zinke and others (2021), Wairau Fault, nine markers',
  teaches: 'Nine dated markers on one fault. The interval rates vary by more than an order of magnitude, which is the phenomenon incremental analysis exists to measure.',
  provenance: 'Displacement and age brackets after Zinke and others (2021), Tectonics, for the Wairau Fault, Aotearoa New Zealand.' + CAVEAT,
  units: U, truth: null, anchor: null,
  markers: zw.map((r) => ({
    id: 'm' + r[0], label: 'M' + r[0],
    displacement: { type: 'boxcar', min: r[1], max: r[2] },
    age: { type: 'boxcar', min: r[3], max: r[4] },
  })),
});

/* ---------- manifest ---------- */

const ids = [
  'single-well-behaved', 'single-poorly-dated', 'single-two-restorations', 'single-calibrated-14c',
  'multi-well-behaved', 'multi-inconsistent', 'multi-mispaired', 'multi-mispaired-control',
  'published-gold-cowgill', 'published-zinke-wairau',
];
const index = ids.map((id) => {
  const p = JSON.parse(readFileSync('data/presets/' + id + '.json', 'utf8'));
  return { id, kind: p.kind, title: p.title, teaches: p.teaches, synthetic: p.synthetic };
});
writeFileSync('data/presets/index.json', JSON.stringify(index, null, 2) + '\n');
console.log('wrote ' + ids.length + ' presets and the manifest');

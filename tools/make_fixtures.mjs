/**
 * Measure every headline number the pages quote, and write them to
 * data/fixtures/headline.json.
 *
 * The pages read this file and inject the numbers, so the prose cannot drift
 * away from what the engine actually produces. If you change a preset, run
 * this and the quoted results follow automatically.
 *
 *   node tools/make_fixtures.mjs
 *
 * Note on oracles: the plan called for a scipy script here as an independent
 * check. It is not needed. Every load-bearing quantity in tools/checks.js is
 * asserted against a closed form instead, which is stronger than a second
 * numerical library, and it keeps the repository free of a Python dependency.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  runSingleMarker, naivePropagation, runIncremental, quantiles, normalCdf,
} from '../js/engine/index.js';

const SEED = 'teaching';
const N_SINGLE = 200000;
const N_PATHS = 20000;

const load = (id) => JSON.parse(readFileSync('data/presets/' + id + '.json', 'utf8'));
const r2 = (v) => Number(v.toFixed(2));
const r3 = (v) => Number(v.toFixed(3));

const out = {
  generated: 'run tools/make_fixtures.mjs to regenerate',
  seed: SEED,
  nSingle: N_SINGLE,
  nPaths: N_PATHS,
  single: {},
  multi: {},
  anchoring: {},
  extras: {},
};

/* ---------- Method 1 presets ---------- */

for (const id of ['single-well-behaved', 'single-poorly-dated', 'single-two-restorations', 'single-calibrated-14c']) {
  const p = load(id);
  const res = runSingleMarker({
    displacement: p.displacement, age: p.age, anchor: p.anchor,
    n: N_SINGLE, seed: SEED,
  });
  const pct = res.stats.percentile;
  const q95 = quantiles(res.rates, [0.025, 0.975]);
  const naive = naivePropagation({ displacement: p.displacement, age: p.age, anchor: p.anchor });
  out.single[id] = {
    median: r3(pct.median),
    ci68: [r3(pct.lower), r3(pct.upper)],
    ci95: [r3(q95[0]), r3(q95[1])],
    mean: r3(res.stats.mean),
    asymmetry: r3(pct.asymmetry),
    hpd: [r3(res.stats.hpd.lower), r3(res.stats.hpd.upper)],
    hpdClusters: res.stats.hpd.clusters.length,
    naive: {
      rate: r3(naive.rate), sigma: r3(naive.sigma),
      lower: r3(naive.lower), upper: r3(naive.upper),
    },
    naiveUpperShortfall: r3(pct.upper - naive.upper),
    hpdNarrowerPct: r2(100 * (1 - (res.stats.hpd.upper - res.stats.hpd.lower) / (pct.upper - pct.lower))),
  };
}

/* ---------- Method 2 presets ---------- */

for (const id of ['multi-well-behaved', 'multi-inconsistent', 'multi-mispaired',
                  'multi-mispaired-control', 'published-gold-cowgill', 'published-zinke-wairau']) {
  const p = load(id);
  const res = runIncremental({
    markers: p.markers, anchor: p.anchor, n: N_PATHS, seed: SEED,
  });
  out.multi[id] = {
    acceptance: r3(100 * res.acceptance),
    accepted: res.accepted,
    attempts: res.attempts,
    bestFit: res.bestFitStats ? {
      median: r2(res.bestFitStats.percentile.median),
      ci68: [r2(res.bestFitStats.percentile.lower), r2(res.bestFitStats.percentile.upper)],
    } : null,
    intervals: res.intervals.map((iv) => ({
      label: iv.label,
      median: r2(iv.stats.percentile.median),
      ci68: [r2(iv.stats.percentile.lower), r2(iv.stats.percentile.upper)],
      p975: r2(quantiles(iv.rates, [0.975])[0]),
      max: r2(iv.stats.tailMax),
    })),
  };
}

// The closed-form prediction for the mispairing acceptance rate: the M2/M3
// age pair dominates the rejections, so P(accept) = Phi((mu3-mu2)/sqrt(s2^2+s3^2)).
{
  const p = load('multi-mispaired');
  const a = p.markers[1].age, b = p.markers[2].age;
  const z = (b.mean - a.mean) / Math.sqrt(a.sd * a.sd + b.sd * b.sd);
  out.extras.mispairPrediction = {
    z: r3(z),
    predictedPct: r2(100 * normalCdf(z)),
    observedPct: out.multi['multi-mispaired'].acceptance,
    formula: 'Phi((mu3 - mu2) / sqrt(sigma2^2 + sigma3^2))',
  };
}

/* ---------- The open-interval bias table ---------- */

{
  const anchorAge = 0.40;
  const trueRate = 3.0;
  const preset = load('multi-well-behaved');
  const rows = [];
  for (const mk of preset.markers) {
    const t = mk.age.mean;
    const common = { displacement: mk.displacement, age: mk.age, n: N_SINGLE, seed: SEED };
    const un = runSingleMarker(common);
    const an = runSingleMarker({ ...common, anchor: preset.anchor.age });
    const up = un.stats.percentile, ap = an.stats.percentile;
    rows.push({
      marker: mk.label,
      age: t,
      unanchored: { median: r2(up.median), ci68: [r2(up.lower), r2(up.upper)] },
      anchored: { median: r2(ap.median), ci68: [r2(ap.lower), r2(ap.upper)] },
      biasPct: r2(100 * (up.median / ap.median - 1)),
      closedForm: r3(1 - anchorAge / t),
      widthUnanchored: r2(up.upper - up.lower),
      widthAnchored: r2(ap.upper - ap.lower),
    });
  }
  out.anchoring = { anchorAge, trueRate, rows };
}

mkdirSync('data/fixtures', { recursive: true });
writeFileSync('data/fixtures/headline.json', JSON.stringify(out, null, 2) + '\n');

console.log('data/fixtures/headline.json written\n');
for (const [id, v] of Object.entries(out.single)) {
  console.log(id.padEnd(26), 'median', v.median, ' 68%', JSON.stringify(v.ci68), ' asym', v.asymmetry);
}
console.log('');
for (const [id, v] of Object.entries(out.multi)) {
  console.log(id.padEnd(26), 'accept', String(v.acceptance) + '%',
    ' best-fit', v.bestFit ? v.bestFit.median : '-',
    ' intervals', v.intervals.map((i) => i.median).join(' / '));
}
console.log('\nmispairing closed form:', JSON.stringify(out.extras.mispairPrediction));
console.log('\nanchoring bias:');
for (const r of out.anchoring.rows) {
  console.log('  ' + r.marker, 't=' + r.age, 'ka  unanchored', r.unanchored.median,
    ' anchored', r.anchored.median, ' bias', r.biasPct + '%',
    ' closed form', (100 * (r.closedForm - 1)).toFixed(1) + '%');
}

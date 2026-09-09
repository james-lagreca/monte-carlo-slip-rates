/**
 * Engine self-checks.
 *
 * Pure and DOM-free, so the same list runs two ways: `node tools/verify.js`
 * from a terminal, and verify.html in a browser. One definition, two front
 * ends, no test framework and nothing to install.
 *
 * The checks that matter most are the ones with a closed-form answer a student
 * can work out on paper:
 *
 *   - cdf(invCdf(p)) = p exactly, for the piecewise-linear family
 *   - the quantiles of a constant offset divided by a Gaussian age
 *   - the monotonicity acceptance rate, Phi((mu2-mu1)/sqrt(s1^2+s2^2))
 *   - the open-interval bias, 1 - t_anchor/t_marker
 *
 * If one of those fails, the teaching on the corresponding page is wrong, not
 * just the code.
 */

import {
  makeRng, mulberry32, piecewiseLinear, normalCdf, normalInvCdf,
  makeDistribution, pertShape, quantiles, percentileInterval,
  runSingleMarker, runIncremental,
} from '../js/engine/index.js';

const SEED = 'teaching';

/**
 * @param {object} opts
 * @param {boolean} opts.heavy  include the slow sampling checks
 * @returns {Array<{name, group, expected, actual, tolerance, pass, note}>}
 */
export function runChecks({ heavy = true } = {}) {
  const out = [];
  const add = (group, name, expected, actual, tolerance, note = '') => {
    const ok = Number.isFinite(tolerance)
      ? Math.abs(actual - expected) <= tolerance
      : expected === actual;
    out.push({ group, name, expected, actual, tolerance, pass: ok, note });
  };
  const addBool = (group, name, value, note = '') => {
    out.push({ group, name, expected: true, actual: value, tolerance: null, pass: value === true, note });
  };

  /* ---- 1. Random number generation ---- */

  {
    const a = mulberry32(42);
    const first = [a(), a(), a()];
    const b = mulberry32(42);
    const second = [b(), b(), b()];
    addBool('rng', 'mulberry32 is deterministic for a given seed',
      first.every((v, i) => v === second[i]));

    const r1 = makeRng(SEED), r2 = makeRng(SEED);
    let same = true;
    for (let i = 0; i < 500; i++) if (r1.uniform01() !== r2.uniform01()) { same = false; break; }
    addBool('rng', 'makeRng reproduces bitwise from a text seed', same);

    const r3 = makeRng('teaching'), r4 = makeRng('different');
    addBool('rng', 'different seeds give different streams', r3.uniform01() !== r4.uniform01());
  }

  if (heavy) {
    const rng = makeRng(SEED);
    const N = 400000;
    let s = 0, s2 = 0;
    for (let i = 0; i < N; i++) { const v = rng.uniform01(); s += v; s2 += v * v; }
    const m = s / N;
    add('rng', 'uniform mean is 1/2', 0.5, m, 2e-3);
    add('rng', 'uniform variance is 1/12', 1 / 12, s2 / N - m * m, 2e-3);

    let ns = 0, ns2 = 0;
    for (let i = 0; i < N; i++) { const v = rng.normal(); ns += v; ns2 += v * v; }
    const nm = ns / N;
    add('rng', 'normal mean is 0', 0, nm, 5e-3);
    add('rng', 'normal variance is 1', 1, ns2 / N - nm * nm, 5e-3);

    for (const shape of [0.5, 1, 2.5, 10]) {
      let gs = 0, gs2 = 0;
      const M = 200000;
      for (let i = 0; i < M; i++) { const v = rng.gamma(shape); gs += v; gs2 += v * v; }
      const gm = gs / M;
      add('rng', 'gamma(' + shape + ') mean is ' + shape, shape, gm, Math.max(0.02, shape * 0.01));
      add('rng', 'gamma(' + shape + ') variance is ' + shape, shape, gs2 / M - gm * gm, Math.max(0.05, shape * 0.03));
    }
  }

  /* ---- 2. Special functions ---- */

  add('special', 'Phi(0) = 1/2', 0.5, normalCdf(0), 1e-15);
  add('special', 'Phi(1.96)', 0.9750021048517795, normalCdf(1.96), 1e-12);
  {
    let worst = 0;
    for (let i = 1; i < 2000; i++) {
      const p = i / 2000;
      worst = Math.max(worst, Math.abs(normalCdf(normalInvCdf(p)) - p));
    }
    add('special', 'Phi(Phi^-1(p)) = p across [0,1]', 0, worst, 1e-13);
  }

  /* ---- 3. Piecewise-linear inverse transform: the deterministic check ---- */

  {
    // A discretised Gaussian, then invert its CDF exactly.
    const xs = [], ps = [];
    for (let i = 0; i <= 400; i++) {
      const v = 5 - 1.6 + i * (3.2 / 400);
      xs.push(v);
      ps.push(Math.exp(-0.5 * Math.pow((v - 5) / 0.4, 2)));
    }
    const d = piecewiseLinear(xs, ps);
    let worst = 0;
    for (let i = 1; i < 2000; i++) {
      const p = i / 2000;
      worst = Math.max(worst, Math.abs(d.cdf(d.invCdf(p)) - p));
    }
    add('piecewise', 'cdf(invCdf(p)) = p, no sampling noise', 0, worst, 1e-12,
      'The load-bearing exactness check. Deterministic, so a failure is a real bug.');
    add('piecewise', 'empirical round-trip recovers the mean', 5, d.mean(), 1e-4);
    add('piecewise', 'triangular exact mean (0, 1, 3)', 4 / 3,
      piecewiseLinear([0, 1, 3], [0, 1, 0]).mean(), 1e-12);
  }

  /* ---- 4. Distribution moments against closed forms ---- */

  {
    const cases = [
      ['pert', { type: 'pert', min: 10.5, mode: 12, max: 13.5 }, 12, Math.sqrt((12 - 10.5) * (13.5 - 12) / 7)],
      ['boxcar', { type: 'boxcar', min: 3, max: 5 }, 4, 2 / Math.sqrt(12)],
      ['triangular', { type: 'triangular', min: 3.8, mode: 5, max: 5.6 }, (3.8 + 5 + 5.6) / 3, null],
      ['gauss', { type: 'gauss', mean: 4, sd: 0.9 }, 4, 0.9],
    ];
    for (const [name, spec, mu, sigma] of cases) {
      const d = makeDistribution(spec);
      add('distributions', name + ' analytic mean', mu, d.mean, 1e-9);
      if (sigma !== null) add('distributions', name + ' analytic sd', sigma, d.sd, 1e-9);
    }
    const sh = pertShape(10.5, 12, 13.5);
    add('distributions', 'PERT alpha + beta = 6 always', 6, sh.alpha + sh.beta, 1e-12);
  }

  if (heavy) {
    const rng = makeRng(SEED);
    const N = 300000;
    const specs = [
      ['pert', { type: 'pert', min: 10.5, mode: 12, max: 13.5 }],
      ['trapezoid', { type: 'trapezoid', min: 9, lo: 11, hi: 13, max: 15 }],
      ['triangular', { type: 'triangular', min: 3.8, mode: 5, max: 5.6 }],
    ];
    for (const [name, spec] of specs) {
      const d = makeDistribution(spec);
      let s = 0, s2 = 0;
      for (let i = 0; i < N; i++) { const v = d.sample(rng); s += v; s2 += v * v; }
      const m = s / N;
      add('distributions', name + ' sampled mean matches analytic', d.mean, m, Math.max(0.01, d.sd * 0.02));
      add('distributions', name + ' sampled sd matches analytic', d.sd, Math.sqrt(s2 / N - m * m), Math.max(0.01, d.sd * 0.03));
    }
  }

  /* ---- 5. Ratio quantiles: a constant offset over a Gaussian age ---- */

  if (heavy) {
    // With D fixed, SR = D/T is a strictly decreasing function of T, so
    //   q_p(SR) = D / q_{1-p}(T) = D / (mu + sigma Phi^-1(1-p)).
    // A closed form the whole Method 1 page rests on.
    const D = 12, mu = 4, sigma = 0.4;
    const res = runSingleMarker({
      displacement: { type: 'fixed', value: D },
      age: { type: 'gauss', mean: mu, sd: sigma },
      n: 400000, seed: SEED,
    });
    for (const p of [0.16, 0.5, 0.84]) {
      const expected = D / (mu + sigma * normalInvCdf(1 - p));
      const actual = quantiles(res.rates, [p])[0];
      add('method1', 'ratio quantile p=' + p + ' matches closed form',
        expected, actual, Math.abs(expected) * 3e-3);
    }
  }

  /* ---- 6. The open-interval bias: 1 - t_anchor / t_marker ---- */

  if (heavy) {
    // Anchoring divides by (t - t_anchor) instead of t, so the unanchored rate
    // is low by exactly the factor (1 - t_anchor/t). Checked on four markers.
    const anchorAge = 0.40;
    const trueRate = 3.0;
    for (const t of [1.60, 3.10, 4.80, 7.40]) {
      const D = trueRate * (t - anchorAge);
      const common = {
        displacement: { type: 'fixed', value: D },
        age: { type: 'fixed', value: t },
        n: 2000, seed: SEED,
      };
      const un = runSingleMarker(common);
      const an = runSingleMarker({ ...common, anchor: { type: 'fixed', value: anchorAge } });
      const ratio = un.stats.percentile.median / an.stats.percentile.median;
      add('anchoring', 'bias at t=' + t + ' ka equals 1 - t_MRE/t',
        1 - anchorAge / t, ratio, 1e-9);
    }
  }

  /* ---- 7. Monotonicity acceptance against the closed form ---- */

  if (heavy) {
    // One pair of Gaussian ages, displacements ordered with certainty, so the
    // only way to fail the condition is an age inversion:
    //   P(accept) = Phi((mu2 - mu1) / sqrt(s1^2 + s2^2))
    const trials = [
      { mu1: 3.0, s1: 0.3, mu2: 3.0, s2: 0.3 },
      { mu1: 3.0, s1: 0.3, mu2: 3.3, s2: 0.3 },
      { mu1: 3.30, s1: 0.30, mu2: 2.90, s2: 0.30 },
    ];
    for (const t of trials) {
      const r = runIncremental({
        markers: [
          { id: 'a', displacement: { type: 'fixed', value: 5 }, age: { type: 'gauss', mean: t.mu1, sd: t.s1 } },
          { id: 'b', displacement: { type: 'fixed', value: 10 }, age: { type: 'gauss', mean: t.mu2, sd: t.s2 } },
        ],
        n: 40000, seed: SEED,
      });
      const expected = normalCdf((t.mu2 - t.mu1) / Math.sqrt(t.s1 * t.s1 + t.s2 * t.s2));
      add('method2', 'acceptance for N(' + t.mu1 + ',' + t.s1 + ') then N(' + t.mu2 + ',' + t.s2 + ')',
        expected, r.acceptance, 0.01,
        'Closed form: Phi((mu2-mu1)/sqrt(s1^2+s2^2)).');
    }
  }

  /* ---- 8. Incremental recovers a known slip history ---- */

  if (heavy) {
    // Forward-modelled from exactly 3.00 mm/yr. If the estimator cannot
    // recover the answer it was built from, nothing else on the site is safe.
    const r = runIncremental({
      anchor: { label: 'MRE', age: { type: 'boxcar', min: 0.25, max: 0.55 } },
      markers: [
        { id: 'm1', displacement: { type: 'pert', min: 3.0, mode: 3.6, max: 4.2 }, age: { type: 'gauss', mean: 1.60, sd: 0.15 } },
        { id: 'm2', displacement: { type: 'pert', min: 7.0, mode: 8.1, max: 9.2 }, age: { type: 'gauss', mean: 3.10, sd: 0.22 } },
        { id: 'm3', displacement: { type: 'pert', min: 11.6, mode: 13.2, max: 14.8 }, age: { type: 'gauss', mean: 4.80, sd: 0.30 } },
        { id: 'm4', displacement: { type: 'pert', min: 18.8, mode: 21.0, max: 23.2 }, age: { type: 'gauss', mean: 7.40, sd: 0.45 } },
      ],
      n: 20000, seed: SEED,
    });
    add('method2', 'well-behaved data accept at 100%', 1, r.acceptance, 1e-9);
    add('method2', 'best-fit recovers the 3.00 mm/yr it was built from',
      3.0, r.bestFitStats.percentile.median, 0.05);
    for (const iv of r.intervals) {
      add('method2', 'interval ' + iv.label + ' recovers 3.00 mm/yr',
        3.0, iv.stats.percentile.median, 0.08);
    }

    const again = runIncremental({
      anchor: { label: 'MRE', age: { type: 'boxcar', min: 0.25, max: 0.55 } },
      markers: [
        { id: 'm1', displacement: { type: 'pert', min: 3.0, mode: 3.6, max: 4.2 }, age: { type: 'gauss', mean: 1.60, sd: 0.15 } },
        { id: 'm2', displacement: { type: 'pert', min: 7.0, mode: 8.1, max: 9.2 }, age: { type: 'gauss', mean: 3.10, sd: 0.22 } },
        { id: 'm3', displacement: { type: 'pert', min: 11.6, mode: 13.2, max: 14.8 }, age: { type: 'gauss', mean: 4.80, sd: 0.30 } },
        { id: 'm4', displacement: { type: 'pert', min: 18.8, mode: 21.0, max: 23.2 }, age: { type: 'gauss', mean: 7.40, sd: 0.45 } },
      ],
      n: 20000, seed: SEED,
    });
    addBool('method2', 'same seed gives bitwise identical paths',
      again.agePaths.length === r.agePaths.length &&
      again.agePaths.every((v, i) => v === r.agePaths[i]));
  }

  /* ---- 9. Summary shapes ---- */

  {
    // For a symmetric sample the three summaries should agree.
    const rng = makeRng(SEED);
    const vals = new Float64Array(200000);
    for (let i = 0; i < vals.length; i++) vals[i] = 10 + 2 * rng.normal();
    const pct = percentileInterval(vals, 68.27);
    add('summaries', 'percentile interval on a Gaussian is mean +/- sd', 2, pct.plusError, 0.05);
    add('summaries', 'percentile interval is symmetric on a Gaussian', 1, pct.asymmetry, 0.02);
  }

  return out;
}

/** Compact pass/fail counts. */
export function summariseChecks(results) {
  const failed = results.filter((r) => !r.pass);
  return { total: results.length, passed: results.length - failed.length, failed: failed.length, failures: failed };
}

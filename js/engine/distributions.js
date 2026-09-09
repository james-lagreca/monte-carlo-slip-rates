/**
 * The distribution vocabulary.
 *
 * Choosing an input PDF is a scientific claim about what you know. The shapes
 * here are the ones used in the incremental-slip-rate literature, and they
 * match those built by RISeR's makePDF.py (Zinke, 2019-2021):
 *
 *   gauss       mean, sd            a measurement with symmetric error
 *   boxcar      min, max            bracketing constraints and nothing more
 *   triangular  min, mode, max      a preferred value between hard bounds
 *   trapezoid   min, lo, hi, max    two restorations both defensible: the flat
 *                                   top spans them
 *   pert        min, mode, max      like triangular but smooth, and it takes
 *                                   the mode seriously
 *   empirical   (value, prob) pairs how a calibrated radiocarbon age arrives
 *   fixed       value               a constant, for an anchor at zero offset
 */

import { piecewiseLinear } from './piecewise.js';
import { normalCdf, normalInvCdf } from './special.js';

/** RISeR builds Gaussians on a +/- 4 sigma support. We match that. */
export const GAUSS_SUPPORT_SIGMA = 4;

export function makeDistribution(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('makeDistribution: spec required');
  const type = String(spec.type || '').toLowerCase();

  switch (type) {
    case 'fixed':      return fixedDist(spec.value);
    case 'gauss':
    case 'gaussian':
    case 'normal':     return gaussDist(spec.mean, spec.sd);
    case 'boxcar':
    case 'uniform':    return boxcarDist(spec.min, spec.max);
    case 'triangular':
    case 'triangle':
    case 'tri':        return triangularDist(spec.min, spec.mode, spec.max);
    case 'trapezoid':
    case 'trapezoidal':
    case 'trap':       return trapezoidDist(spec.min, spec.lo, spec.hi, spec.max);
    case 'pert':       return pertDist(spec.min, spec.mode, spec.max);
    case 'empirical':  return empiricalDist(spec.points);
    default:
      throw new Error('makeDistribution: unknown type ' + spec.type);
  }
}

function fixedDist(value) {
  const v = num(value, 'fixed.value');
  return {
    type: 'fixed', label: fmt(v), min: v, max: v,
    mean: v, sd: 0,
    sample: () => v,
    pdf: (x) => (x === v ? Infinity : 0),
    cdf: (x) => (x < v ? 0 : 1),
    invCdf: () => v,
    warnings: [],
  };
}

function gaussDist(mean, sd) {
  const mu = num(mean, 'gauss.mean');
  const s = num(sd, 'gauss.sd');
  if (!(s > 0)) throw new Error('gauss.sd must be positive');
  const lo = mu - GAUSS_SUPPORT_SIGMA * s;
  const hi = mu + GAUSS_SUPPORT_SIGMA * s;
  // Renormalise over the truncated support, as a +/-4 sigma PDF file would be.
  const Flo = normalCdf(-GAUSS_SUPPORT_SIGMA);
  const Fhi = normalCdf(GAUSS_SUPPORT_SIGMA);
  const mass = Fhi - Flo;

  const warnings = [];
  if (lo <= 0) {
    warnings.push(
      'The support reaches ' + fmt(lo) + ', at or below zero. If this is an age, ' +
      'dividing by it will produce arbitrarily large rates. Consider a bounded shape.'
    );
  }

  return {
    type: 'gauss',
    label: 'N(' + fmt(mu) + ', ' + fmt(s) + ')',
    min: lo, max: hi, mean: mu, sd: s,
    /** Rejection outside +/-4 sigma keeps the sampler consistent with the support. */
    sample(rng) {
      for (let i = 0; i < 200; i++) {
        const z = rng.normal();
        if (z >= -GAUSS_SUPPORT_SIGMA && z <= GAUSS_SUPPORT_SIGMA) return mu + s * z;
      }
      return mu; // unreachable in practice
    },
    pdf: (x) => (x < lo || x > hi ? 0
      : Math.exp(-0.5 * Math.pow((x - mu) / s, 2)) / (s * Math.sqrt(2 * Math.PI) * mass)),
    cdf: (x) => (x <= lo ? 0 : x >= hi ? 1 : (normalCdf((x - mu) / s) - Flo) / mass),
    invCdf: (p) => mu + s * normalInvCdf(Flo + p * mass),
    warnings,
  };
}

function boxcarDist(min, max) {
  const a = num(min, 'boxcar.min'), b = num(max, 'boxcar.max');
  if (!(b > a)) throw new Error('boxcar.max must exceed boxcar.min');
  return {
    type: 'boxcar',
    label: 'U(' + fmt(a) + ', ' + fmt(b) + ')',
    min: a, max: b,
    mean: (a + b) / 2,
    sd: (b - a) / Math.sqrt(12),
    sample: (rng) => a + (b - a) * rng.uniform01(),
    pdf: (x) => (x < a || x > b ? 0 : 1 / (b - a)),
    cdf: (x) => (x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a)),
    invCdf: (p) => a + p * (b - a),
    warnings: [],
  };
}

function triangularDist(min, mode, max) {
  const a = num(min, 'triangular.min');
  const m = num(mode, 'triangular.mode');
  const b = num(max, 'triangular.max');
  if (!(b > a)) throw new Error('triangular.max must exceed triangular.min');
  if (m < a || m > b) throw new Error('triangular.mode must lie between min and max');
  const h = 2 / (b - a);
  const base = (m === a) ? piecewiseLinear([a, b], [h, 0])
             : (m === b) ? piecewiseLinear([a, b], [0, h])
             : piecewiseLinear([a, m, b], [0, h, 0]);
  const mean = (a + m + b) / 3;
  const variance = (a * a + m * m + b * b - a * m - a * b - m * b) / 18;
  return wrapPiecewise(base, 'triangular',
    'Tri(' + fmt(a) + ', ' + fmt(m) + ', ' + fmt(b) + ')', mean, Math.sqrt(variance));
}

function trapezoidDist(min, lo, hi, max) {
  const a = num(min, 'trapezoid.min'), c = num(lo, 'trapezoid.lo');
  const d = num(hi, 'trapezoid.hi'), b = num(max, 'trapezoid.max');
  const v = [a, c, d, b];
  for (let i = 1; i < 4; i++) {
    if (v[i] < v[i - 1]) throw new Error('trapezoid values must be ordered min <= lo <= hi <= max');
  }
  if (!(b > a)) throw new Error('trapezoid.max must exceed trapezoid.min');
  // Deduplicate coincident nodes so the support stays strictly increasing.
  const xs = [], ps = [];
  const raw = [[a, 0], [c, 1], [d, 1], [b, 0]];
  for (let i = 0; i < raw.length; i++) {
    const x = raw[i][0], p = raw[i][1];
    if (xs.length && Math.abs(x - xs[xs.length - 1]) < 1e-12) {
      ps[ps.length - 1] = Math.max(ps[ps.length - 1], p);
    } else {
      xs.push(x);
      ps.push(p);
    }
  }
  const base = piecewiseLinear(xs, ps);
  const mean = base.mean();
  return wrapPiecewise(base, 'trapezoid',
    'Trap(' + fmt(a) + ', ' + fmt(c) + ', ' + fmt(d) + ', ' + fmt(b) + ')',
    mean, piecewiseSd(base, mean));
}

/**
 * Beta-PERT. This is what a field geologist means by a minimum, preferred and
 * maximum offset estimate: bounded, unimodal, and smooth. It is the shape used
 * for restored offsets throughout the incremental slip-rate literature.
 *
 *   alpha = 1 + 4 (mode - min) / (max - min)
 *   beta  = 1 + 4 (max - mode) / (max - min)
 *
 * The 4 is the standard PERT shape parameter, so alpha + beta = 6 always.
 * Analytic moments:  mu = (min + 4 mode + max) / 6
 *                    sd = sqrt((mu - min)(max - mu) / 7)
 */
export function pertShape(min, mode, max) {
  const alpha = 1 + 4 * (mode - min) / (max - min);
  const beta = 1 + 4 * (max - mode) / (max - min);
  return { alpha, beta };
}

function pertDist(min, mode, max) {
  const a = num(min, 'pert.min'), m = num(mode, 'pert.mode'), b = num(max, 'pert.max');
  if (!(b > a)) throw new Error('pert.max must exceed pert.min');
  if (m < a || m > b) throw new Error('pert.mode must lie between min and max');
  const shape = pertShape(a, m, b);
  const alpha = shape.alpha, beta = shape.beta;
  const mean = (a + 4 * m + b) / 6;
  const sd = Math.sqrt((mean - a) * (b - mean) / 7);
  const lnB = lnBeta(alpha, beta);

  return {
    type: 'pert',
    label: 'PERT(' + fmt(a) + ', ' + fmt(m) + ', ' + fmt(b) + ')',
    min: a, max: b, mean, sd, alpha, beta,
    // --- teach:start pert-sample ---
    sample(rng) {
      return a + (b - a) * rng.beta(alpha, beta);
    },
    // --- teach:end pert-sample ---
    pdf(x) {
      if (x <= a || x >= b) return 0;
      const t = (x - a) / (b - a);
      return Math.exp((alpha - 1) * Math.log(t) + (beta - 1) * Math.log(1 - t) - lnB) / (b - a);
    },
    cdf(x) {
      if (x <= a) return 0;
      if (x >= b) return 1;
      return regularisedIncompleteBeta((x - a) / (b - a), alpha, beta);
    },
    invCdf(p) {
      if (p <= 0) return a;
      if (p >= 1) return b;
      // Bisection on the CDF. PERT alpha and beta are small and well behaved.
      let lo = 0, hi = 1;
      for (let i = 0; i < 80; i++) {
        const mid = 0.5 * (lo + hi);
        if (regularisedIncompleteBeta(mid, alpha, beta) < p) lo = mid; else hi = mid;
      }
      return a + (b - a) * 0.5 * (lo + hi);
    },
    warnings: [],
  };
}

function empiricalDist(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('empirical.points needs at least two [value, probability] pairs');
  }
  const sorted = points.slice().sort((u, v) => u[0] - v[0]);
  const base = piecewiseLinear(sorted.map((q) => q[0]), sorted.map((q) => q[1]));
  const mean = base.mean();
  return wrapPiecewise(base, 'empirical', 'empirical (' + sorted.length + ' nodes)',
    mean, piecewiseSd(base, mean));
}

/* ---------- helpers ---------- */

function wrapPiecewise(base, type, label, mean, sd) {
  return {
    type, label,
    min: base.min, max: base.max, mean, sd,
    sample: (rng) => base.invCdf(rng.uniform01()),
    pdf: base.pdf, cdf: base.cdf, invCdf: base.invCdf,
    nodes: base.nodes,
    warnings: [],
  };
}

/** Standard deviation of a piecewise-linear density, by fine quadrature. */
function piecewiseSd(base, mean) {
  const N = 4000;
  const lo = base.min, hi = base.max, h = (hi - lo) / N;
  let acc = 0;
  for (let i = 0; i <= N; i++) {
    const x = lo + i * h;
    const w = (i === 0 || i === N) ? 0.5 : 1;
    acc += w * base.pdf(x) * Math.pow(x - mean, 2);
  }
  return Math.sqrt(acc * h);
}

function lnGamma(z) {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
             -176.61502916214059, 12.507343278686905, -0.13857109526572012,
             9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function lnBeta(a, b) { return lnGamma(a) + lnGamma(b) - lnGamma(a + b); }

/** Regularised incomplete beta I_x(a,b), by the Lentz continued fraction. */
function regularisedIncompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x < (a + 1) / (a + b + 2)) {
    return Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta(a, b)) * betaCf(x, a, b) / a;
  }
  return 1 - Math.exp(b * Math.log(1 - x) + a * Math.log(x) - lnBeta(b, a)) * betaCf(1 - x, b, a) / b;
}

function betaCf(x, a, b) {
  const tiny = 1e-300;
  let f = 1, c = 1, d = 0;
  for (let m = 0; m <= 300; m++) {
    let numerator;
    if (m === 0) {
      numerator = 1;
    } else if (m % 2 === 0) {
      const k = m / 2;
      numerator = (k * (b - k) * x) / ((a + 2 * k - 1) * (a + 2 * k));
    } else {
      const k = (m - 1) / 2;
      numerator = -((a + k) * (a + b + k) * x) / ((a + 2 * k) * (a + 2 * k + 1));
    }
    d = 1 + numerator * d; if (Math.abs(d) < tiny) d = tiny; d = 1 / d;
    c = 1 + numerator / c; if (Math.abs(c) < tiny) c = tiny;
    const delta = c * d;
    f *= delta;
    if (Math.abs(1 - delta) < 1e-15) break;
  }
  return f - 1;
}

function num(v, name) {
  const x = Number(v);
  if (!Number.isFinite(x)) throw new Error(name + ' must be a finite number');
  return x;
}

function fmt(v) {
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
}

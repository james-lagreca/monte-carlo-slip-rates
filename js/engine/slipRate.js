/**
 * Method 1: the slip rate of a single dated marker.
 *
 *   SR = D / (t - t_anchor)
 *
 * with D and t both distributions rather than numbers. Draw a displacement,
 * draw an age, divide, repeat. The result is a distribution of rates.
 *
 * Two things this module exists to make visible:
 *
 * 1. The ratio of two distributions is not the ratio of two numbers with an
 *    error bar bolted on. Divide by an age whose lower tail approaches zero
 *    and the rate acquires a long right tail that no plus-or-minus can carry.
 *
 * 2. The anchor. Following Hatem et al. (2024), the denominator is the time
 *    since the most recent event, not the full age of the marker. Strain has
 *    accumulated since that earthquake but no surface displacement has been
 *    registered at the site, so dividing by the marker's whole age charges the
 *    rate for time in which nothing could have been recorded. That
 *    systematically under-estimates, and worst for the youngest markers.
 *
 * Units: ages in ka, displacement in m, rates in mm/yr. Note that 1 m/ka is
 * 1 mm/yr exactly, so metres divided by ka is already mm/yr. There is no unit
 * conversion anywhere in this file, and that is not an oversight.
 */

import { makeRng } from './rng.js';
import { makeDistribution } from './distributions.js';
import { summarise, DEFAULT_CONFIDENCE } from './stats.js';

/**
 * @param {object} opts
 * @param {object} opts.displacement  distribution spec, in metres
 * @param {object} opts.age           distribution spec, in ka
 * @param {object|null} opts.anchor   distribution spec for the MRE age in ka,
 *                                    or null to divide by the full marker age
 * @param {number} opts.n             number of realisations
 * @param {string|number} opts.seed
 * @param {number} opts.minDuration   durations at or below this are discarded
 */
export function runSingleMarker({
  displacement,
  age,
  anchor = null,
  n = 100000,
  seed = 'teaching',
  minDuration = 0.01,
  confidence = DEFAULT_CONFIDENCE,
  bins = 200,
  bandwidthScale = 1,
} = {}) {
  const rng = makeRng(seed);
  const dDist = makeDistribution(displacement);
  const tDist = makeDistribution(age);
  const aDist = anchor ? makeDistribution(anchor) : null;

  const rates = new Float64Array(n);
  const dDraws = new Float64Array(n);
  const tDraws = new Float64Array(n);
  let kept = 0;
  let discarded = 0;

  // --- teach:start method1 ---
  for (let i = 0; i < n; i++) {
    const d = dDist.sample(rng);            // metres
    const t = tDist.sample(rng);            // ka
    const t0 = aDist ? aDist.sample(rng) : 0;
    const duration = t - t0;                // ka since the anchor
    if (!(duration > minDuration)) { discarded++; continue; }
    rates[kept] = d / duration;             // m/ka, which is mm/yr
    dDraws[kept] = d;
    tDraws[kept] = t;
    kept++;
  }
  // --- teach:end method1 ---

  const used = rates.subarray(0, kept);
  const stats = summarise(used, { confidence, bins, bandwidthScale });

  return {
    rates: used,
    displacementDraws: dDraws.subarray(0, kept),
    ageDraws: tDraws.subarray(0, kept),
    kept,
    discarded,
    attempted: n,
    anchored: Boolean(aDist),
    distributions: { displacement: dDist, age: tDist, anchor: aDist },
    warnings: [...dDist.warnings, ...tDist.warnings, ...(aDist ? aDist.warnings : [])],
    stats,
  };
}

/**
 * The answer you get without Monte Carlo: divide the central values, then
 * propagate the errors to first order.
 *
 *   SR    = D / T
 *   sigma = SR * sqrt((sigma_D/D)^2 + (sigma_T/T)^2)
 *
 * This is what the site compares against. It is not a straw man; it is what
 * most published single-marker rates are, and for a well-dated marker it is
 * very nearly right. It fails when the age is poorly known, and it fails in a
 * specific direction: it is symmetric when the truth is not, and its upper
 * bound is too low.
 */
export function naivePropagation({ displacement, age, anchor = null }) {
  const dDist = makeDistribution(displacement);
  const tDist = makeDistribution(age);
  const aDist = anchor ? makeDistribution(anchor) : null;

  const D = dDist.mean;
  const sD = dDist.sd;
  const T = tDist.mean - (aDist ? aDist.mean : 0);
  // Variances add when the anchor age is subtracted.
  const sT = Math.sqrt(tDist.sd * tDist.sd + (aDist ? aDist.sd * aDist.sd : 0));

  const rate = D / T;
  const rel = Math.sqrt((sD / D) * (sD / D) + (sT / T) * (sT / T));
  const sigma = rate * rel;
  return {
    rate,
    sigma,
    lower: rate - sigma,
    upper: rate + sigma,
    displacementMean: D,
    displacementSd: sD,
    durationMean: T,
    durationSd: sT,
  };
}

/**
 * How the estimate settles as the sample grows. Used for the running-median
 * sparkline that answers "how many realisations is enough".
 */
export function convergenceTrace(rates, steps = 60) {
  const n = rates.length;
  const out = [];
  const sorted = [];
  let nextAt = Math.max(10, Math.floor(n / steps));
  for (let i = 0; i < n; i++) {
    insertSorted(sorted, rates[i]);
    if (i + 1 >= nextAt || i === n - 1) {
      const m = sorted.length;
      const median = m % 2 ? sorted[(m - 1) / 2] : 0.5 * (sorted[m / 2 - 1] + sorted[m / 2]);
      out.push({ n: i + 1, median });
      nextAt = Math.floor((i + 1) * 1.25) + 1;
    }
  }
  return out;
}

function insertSorted(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1; else hi = mid;
  }
  arr.splice(lo, 0, v);
}

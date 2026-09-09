/**
 * Method 2: incremental slip rates from several dated markers.
 *
 * A flight of dated markers records a slip history, not a rate. The method,
 * after Gold and Cowgill (2011) and Zinke et al. (2017, 2019), is rejection
 * sampling:
 *
 *   1. Draw an age and a displacement for every marker, independently.
 *   2. Keep the realisation only if the ages and the displacements are BOTH
 *      strictly increasing. This is the Bayesian condition. It encodes two
 *      pieces of physics: the fault does not slip backwards, and an older
 *      marker cannot carry less offset than a younger one.
 *   3. Otherwise throw the whole realisation away and draw again.
 *   4. From each accepted path, take the rate over each interval between
 *      successive markers, and a best-fit rate through the whole path.
 *
 * The accepted paths, drawn together, are the path fan. Its width is the
 * uncertainty, and its shape carries information no single number does.
 *
 * The acceptance rate is a result, not a nuisance. A high acceptance rate says
 * the markers agree with each other. A low one says they do not, and the
 * arithmetic cannot repair that: it can only report it. This module therefore
 * returns the acceptance rate as a first-class output, next to the rates.
 *
 * Ported from RISeR's SupportFunctions/MCresampling.py, which is the reference
 * implementation.
 */

import { makeRng } from './rng.js';
import { makeDistribution } from './distributions.js';
import { summarise, DEFAULT_CONFIDENCE } from './stats.js';

/**
 * @param {object} opts
 * @param {Array}  opts.markers   youngest and least-offset first. Each entry is
 *                                { id, label, displacement: spec, age: spec }.
 * @param {object|null} opts.anchor  optional zero-offset point, normally the
 *                                most recent event: { age: spec }.
 * @param {number} opts.n         target number of accepted paths
 * @param {boolean} opts.enforceMonotonic  turn off to see what the condition
 *                                is doing. The paths become unphysical.
 * @param {number|null} opts.maxRate  discard paths with any interval rate
 *                                above this, in mm/yr. RISeR calls this maxRate.
 * @param {number} opts.attemptLimit  hard stop, so a hopeless dataset cannot
 *                                spin forever. RISeR uses 4x the target.
 */
export function runIncremental({
  markers,
  anchor = null,
  n = 10000,
  seed = 'teaching',
  enforceMonotonic = true,
  maxRate = null,
  attemptLimit = null,
  confidence = DEFAULT_CONFIDENCE,
  bins = 200,
  bandwidthScale = 1,
} = {}) {
  if (!Array.isArray(markers) || markers.length < 2) {
    throw new Error('runIncremental: need at least two markers');
  }
  const rng = makeRng(seed);
  const limit = attemptLimit === null ? Math.max(200 * n, 2000000) : attemptLimit;

  // The anchor is a marker pinned at zero displacement.
  const nodes = [];
  if (anchor) {
    nodes.push({
      id: anchor.id || 'anchor',
      label: anchor.label || 'MRE',
      isAnchor: true,
      ageDist: makeDistribution(anchor.age),
      dspDist: makeDistribution({ type: 'fixed', value: 0 }),
    });
  }
  for (const m of markers) {
    nodes.push({
      id: m.id,
      label: m.label || m.id,
      isAnchor: false,
      ageDist: makeDistribution(m.age),
      dspDist: makeDistribution(m.displacement),
    });
  }

  const m = nodes.length;
  const nIntervals = m - 1;

  const agePaths = new Float64Array(n * m);
  const dspPaths = new Float64Array(n * m);
  const intervalRates = [];
  for (let i = 0; i < nIntervals; i++) intervalRates.push(new Float64Array(n));
  const bestFit = new Float64Array(n);

  const ages = new Float64Array(m);
  const dsps = new Float64Array(m);

  let accepted = 0;
  let attempts = 0;
  let rejectedMonotonic = 0;
  let rejectedMaxRate = 0;
  /** Kept so a page can show one concrete rejected realisation and name the reason. */
  let firstRejection = null;

  // --- teach:start accept-reject ---
  while (accepted < n && attempts < limit) {
    attempts++;

    // Draw every marker independently.
    for (let j = 0; j < m; j++) {
      ages[j] = nodes[j].ageDist.sample(rng);
      dsps[j] = nodes[j].dspDist.sample(rng);
    }

    // The Bayesian condition: ages and displacements both strictly increasing.
    let ok = true;
    let badPair = -1;
    let reason = '';
    if (enforceMonotonic) {
      for (let j = 1; j < m; j++) {
        if (!(ages[j] > ages[j - 1])) {
          ok = false; badPair = j; reason = 'age inversion';
          break;
        }
        if (!(dsps[j] > dsps[j - 1])) {
          ok = false; badPair = j; reason = 'negative slip';
          break;
        }
      }
    }

    if (!ok) {
      rejectedMonotonic++;
      if (firstRejection === null) {
        firstRejection = {
          ages: Array.from(ages), dsps: Array.from(dsps),
          pair: [badPair - 1, badPair], reason,
        };
      }
      continue;
    }

    // Optional cap, so a near-zero interval cannot dominate the summary.
    if (maxRate !== null) {
      let over = false;
      for (let j = 1; j < m; j++) {
        const dt = ages[j] - ages[j - 1];
        if (dt > 0 && (dsps[j] - dsps[j - 1]) / dt > maxRate) { over = true; break; }
      }
      if (over) { rejectedMaxRate++; continue; }
    }

    // Accept. Record the path and its interval rates.
    const base = accepted * m;
    for (let j = 0; j < m; j++) {
      agePaths[base + j] = ages[j];
      dspPaths[base + j] = dsps[j];
    }
    for (let j = 1; j < m; j++) {
      const dt = ages[j] - ages[j - 1];
      intervalRates[j - 1][accepted] = dt > 0 ? (dsps[j] - dsps[j - 1]) / dt : NaN;
    }
    bestFit[accepted] = originAnchoredSlope(ages, dsps, m);
    accepted++;
  }
  // --- teach:end accept-reject ---

  const acceptance = attempts > 0 ? accepted / attempts : 0;
  const exhausted = accepted < n;

  const intervals = [];
  for (let i = 0; i < nIntervals; i++) {
    const values = intervalRates[i].subarray(0, accepted);
    intervals.push({
      index: i,
      from: nodes[i].label,
      to: nodes[i + 1].label,
      label: nodes[i].label + ' to ' + nodes[i + 1].label,
      rates: values,
      stats: accepted > 1 ? summarise(values, { confidence, bins, bandwidthScale }) : null,
    });
  }

  return {
    nodes: nodes.map((nd) => ({
      id: nd.id, label: nd.label, isAnchor: nd.isAnchor,
      age: nd.ageDist, displacement: nd.dspDist,
    })),
    markerCount: m,
    accepted,
    attempts,
    acceptance,
    rejectedMonotonic,
    rejectedMaxRate,
    exhausted,
    firstRejection,
    enforceMonotonic,
    maxRate,
    /** Flat arrays, path-major: path k occupies [k*m, (k+1)*m). */
    agePaths: agePaths.subarray(0, accepted * m),
    dspPaths: dspPaths.subarray(0, accepted * m),
    intervals,
    bestFit: bestFit.subarray(0, accepted),
    bestFitStats: accepted > 1
      ? summarise(bestFit.subarray(0, accepted), { confidence, bins, bandwidthScale })
      : null,
  };
}

/**
 * Least-squares slope through the origin, where the origin is the youngest
 * point on the path. Fitting through the origin rather than with a free
 * intercept is the choice that makes this a rate rather than a trend: the
 * fault had accumulated zero offset at the start of the window.
 */
function originAnchoredSlope(ages, dsps, m) {
  const t0 = ages[0];
  const d0 = dsps[0];
  let num = 0, den = 0;
  for (let j = 0; j < m; j++) {
    const t = ages[j] - t0;
    const d = dsps[j] - d0;
    num += t * d;
    den += t * t;
  }
  return den > 0 ? num / den : NaN;
}

/**
 * The median path, taken node by node. Drawn over the fan so the eye has
 * something to follow. It is a summary of the fan, not itself an accepted
 * realisation.
 */
export function medianPath(result) {
  const { agePaths, dspPaths, accepted, markerCount: m } = result;
  const out = [];
  const buf = new Float64Array(accepted);
  for (let j = 0; j < m; j++) {
    for (let k = 0; k < accepted; k++) buf[k] = agePaths[k * m + j];
    const age = medianOf(buf);
    for (let k = 0; k < accepted; k++) buf[k] = dspPaths[k * m + j];
    const dsp = medianOf(buf);
    out.push({ age, displacement: dsp });
  }
  return out;
}

function medianOf(values) {
  const s = Float64Array.from(values);
  s.sort();
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
}

/**
 * Closed-form acceptance probability for one Gaussian-dated pair.
 *
 *   P(t2 > t1) = Phi((mu2 - mu1) / sqrt(s1^2 + s2^2))
 *
 * When one pair dominates the rejections, this predicts the observed
 * acceptance rate, and a student can compute it on paper. That is the point of
 * exposing it: the acceptance rate is not a black box.
 */
export function pairAcceptanceProbability(mu1, s1, mu2, s2, normalCdf) {
  return normalCdf((mu2 - mu1) / Math.sqrt(s1 * s1 + s2 * s2));
}

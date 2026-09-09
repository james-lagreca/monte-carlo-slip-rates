/**
 * Summarising a Monte Carlo result.
 *
 * A slip-rate distribution is a ratio of two uncertain quantities, so it is
 * skewed, and the summary you choose changes the number that goes in the
 * paper. Three summaries are implemented here, matching what RISeR offers:
 *
 *   percentile (IQR)  order statistics, no tuning, reproducible, but the
 *                     interval is dragged out by the long tail
 *   HPD               the narrowest set holding the required probability;
 *                     tracks the mode, handles multimodality by reporting
 *                     clusters, but depends on how you binned and smoothed
 *   mean +/- sd       wrong for a skewed distribution, shown only as a foil
 *
 * The house recommendation, and what the site lands on: report the median
 * with a percentile interval, show the HPD when the PDF is multimodal, say
 * which one you used, and always plot the PDF.
 */

/** RISeR reports at 68.27%, the Gaussian one-sigma equivalent, not "1 sigma". */
export const DEFAULT_CONFIDENCE = 68.27;

/**
 * Min and max of a large array.
 * Written as a loop on purpose: Math.max(...arr) throws RangeError on a
 * few hundred thousand samples, which is exactly the size we work at.
 */
export function extent(values) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

export function mean(values) {
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i];
  return s / values.length;
}

export function sd(values, mu = null) {
  const m = mu === null ? mean(values) : mu;
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - m;
    s += d * d;
  }
  return Math.sqrt(s / values.length);
}

/** Coefficient of variation, the dimensionless spread. */
export function cov(values) {
  const m = mean(values);
  return m === 0 ? NaN : sd(values, m) / m;
}

/**
 * Linear-interpolated quantiles, matching numpy.percentile's default.
 * Sorts a copy, so callers keep their draw order.
 */
export function quantiles(values, ps) {
  const sorted = Float64Array.from(values);
  sorted.sort();
  return ps.map((p) => quantileSorted(sorted, p));
}

export function quantileSorted(sorted, p) {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (p <= 0) return sorted[0];
  if (p >= 1) return sorted[n - 1];
  const pos = p * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * Median with a percentile confidence interval.
 * Returns the asymmetric errors too, because that is how these get reported:
 * "3.00 +0.89 -0.57", never "3.00 +/- 0.73".
 */
export function percentileInterval(values, confidence = DEFAULT_CONFIDENCE) {
  const f = confidence / 100;
  const sorted = Float64Array.from(values);
  sorted.sort();
  const lower = quantileSorted(sorted, 0.5 - f / 2);
  const median = quantileSorted(sorted, 0.5);
  const upper = quantileSorted(sorted, 0.5 + f / 2);
  return {
    method: 'percentile',
    confidence,
    median,
    lower,
    upper,
    minusError: median - lower,
    plusError: upper - median,
    /** Above 1 means a right-skewed interval. A useful one-number skew flag. */
    asymmetry: (median - lower) === 0 ? NaN : (upper - median) / (median - lower),
  };
}

/**
 * Histogram on an even grid, normalised to a density so the area is 1.
 * HPD needs an even grid, which is why the pipeline is histogram-then-smooth
 * rather than working from raw samples.
 */
export function histogram(values, { bins = 200, lo = null, hi = null } = {}) {
  let a = lo, b = hi;
  if (a === null || b === null) {
    const e = extent(values);
    if (a === null) a = e[0];
    if (b === null) b = e[1];
  }
  if (!(b > a)) { b = a + 1; }
  const counts = new Float64Array(bins);
  const width = (b - a) / bins;
  let inRange = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < a || v > b) continue;
    let k = Math.floor((v - a) / width);
    if (k === bins) k = bins - 1;
    counts[k] += 1;
    inRange++;
  }
  const x = new Float64Array(bins);
  const density = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    x[k] = a + (k + 0.5) * width;
    density[k] = inRange > 0 ? counts[k] / (inRange * width) : 0;
  }
  return { x, density, counts, width, lo: a, hi: b, n: values.length, inRange };
}

/** Silverman's rule of thumb, in data units. */
export function silvermanBandwidth(values) {
  const s = sd(values);
  const q = quantiles(values, [0.25, 0.75]);
  const iqr = q[1] - q[0];
  const scale = iqr > 0 ? Math.min(s, iqr / 1.34) : s;
  return 0.9 * scale * Math.pow(values.length, -0.2);
}

/**
 * Gaussian-kernel smoothing of a binned density: a binned KDE.
 * O(bins * kernel) rather than O(samples * bins), and it leaves the even grid
 * that HPD requires.
 */
export function smoothDensity(hist, bandwidth) {
  const { x, density, width } = hist;
  const bins = density.length;
  if (!(bandwidth > 0)) return { x, density: Float64Array.from(density), width, bandwidth: 0 };
  const sigmaBins = bandwidth / width;
  const half = Math.max(1, Math.ceil(4 * sigmaBins));
  const kernel = new Float64Array(2 * half + 1);
  let ksum = 0;
  for (let i = -half; i <= half; i++) {
    const w = Math.exp(-0.5 * (i / sigmaBins) * (i / sigmaBins));
    kernel[i + half] = w;
    ksum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;

  const out = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    let acc = 0;
    for (let j = -half; j <= half; j++) {
      const idx = k + j;
      if (idx < 0 || idx >= bins) continue;
      acc += density[idx] * kernel[j + half];
    }
    out[k] = acc;
  }
  // Renormalise: truncating the kernel at the edges loses a little mass.
  let area = 0;
  for (let k = 0; k < bins; k++) area += out[k] * width;
  if (area > 0) for (let k = 0; k < bins; k++) out[k] /= area;
  return { x, density: out, width, bandwidth };
}

/**
 * Highest posterior density interval.
 *
 * Ported from RISeR's PDFanalysis.HPDpdf. Take bins in order of descending
 * density until the accumulated probability reaches the confidence level; the
 * selected bins are the HPD set. Report both the outer bounds and the
 * contiguous clusters, because a bimodal rate PDF has a genuinely disjoint
 * HPD and hiding that behind a single interval would be dishonest.
 */
export function hpdInterval(x, density, width, confidence = DEFAULT_CONFIDENCE) {
  const target = confidence / 100;
  const bins = density.length;
  const order = Array.from({ length: bins }, (_, i) => i);
  order.sort((i, j) => density[j] - density[i]);

  const selected = new Uint8Array(bins);
  let acc = 0;
  let peak = order.length ? x[order[0]] : NaN;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    if (density[i] <= 0) break;
    selected[i] = 1;
    acc += density[i] * width;
    if (acc >= target) break;
  }

  // Walk left to right collecting contiguous runs.
  const clusters = [];
  let start = -1;
  for (let i = 0; i < bins; i++) {
    if (selected[i] && start === -1) start = i;
    if ((!selected[i] || i === bins - 1) && start !== -1) {
      const end = selected[i] ? i : i - 1;
      let mass = 0;
      for (let k = start; k <= end; k++) mass += density[k] * width;
      clusters.push({
        lower: x[start] - width / 2,
        upper: x[end] + width / 2,
        mass,
      });
      start = -1;
    }
  }

  const lower = clusters.length ? clusters[0].lower : NaN;
  const upper = clusters.length ? clusters[clusters.length - 1].upper : NaN;
  return {
    method: 'hpd',
    confidence,
    peak,
    lower,
    upper,
    clusters,
    multimodal: clusters.length > 1,
    containedMass: acc,
  };
}

/**
 * Convenience: summarise a sample of rates every way at once.
 * `binHint` and `bandwidthScale` are exposed so the site can put them on
 * sliders and show that the HPD bounds move while the percentile bounds do not.
 */
export function summarise(values, {
  confidence = DEFAULT_CONFIDENCE,
  bins = 200,
  bandwidthScale = 1,
  clipQuantile = 0.999,
} = {}) {
  const pct = percentileInterval(values, confidence);
  // Heavy right tails would otherwise put every sample in the first bin.
  const [rawLo] = extent(values);
  const hi = quantiles(values, [clipQuantile])[0];
  const hist = histogram(values, { bins, lo: Math.min(rawLo, pct.lower), hi });
  const bw = silvermanBandwidth(values) * bandwidthScale;
  const smooth = smoothDensity(hist, bw);
  const hpd = hpdInterval(smooth.x, smooth.density, smooth.width, confidence);
  const mu = mean(values);
  return {
    n: values.length,
    mean: mu,
    sd: sd(values, mu),
    percentile: pct,
    hpd,
    density: smooth,
    histogram: hist,
    bandwidth: bw,
    clippedAt: hi,
    /** True when the plot cannot show the whole tail without squashing. */
    tailClipped: extent(values)[1] > hi,
    tailMax: extent(values)[1],
  };
}

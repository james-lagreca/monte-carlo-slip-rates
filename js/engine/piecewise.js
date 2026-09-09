/**
 * Piecewise-linear probability density functions, with an EXACT inverse CDF.
 *
 * This is the workhorse behind the triangular, trapezoidal and empirical
 * distributions, and behind loading a calibrated radiocarbon age straight out
 * of OxCal.
 *
 * RISeR (Zinke, 2019-2021) discretises the CDF and interpolates it linearly to
 * invert. We invert in closed form instead. Between two nodes the density is
 * linear, so the CDF is quadratic, and a quadratic can be solved exactly. The
 * payoff is that `cdf(invCdf(p)) === p` to machine precision, which turns the
 * sampler's correctness into a deterministic test with no sampling noise.
 */

/**
 * Build a distribution from nodes (x, density). Densities need not be
 * normalised; they are rescaled so the trapezoidal integral is 1.
 *
 * @param {number[]} xs strictly increasing support points
 * @param {number[]} ps non-negative relative densities at those points
 */
export function piecewiseLinear(xs, ps) {
  if (xs.length !== ps.length) throw new Error('piecewiseLinear: xs and ps differ in length');
  if (xs.length < 2) throw new Error('piecewiseLinear: need at least two nodes');
  for (let i = 1; i < xs.length; i++) {
    if (!(xs[i] > xs[i - 1])) throw new Error('piecewiseLinear: xs must be strictly increasing');
  }
  for (let i = 0; i < ps.length; i++) {
    if (!(ps[i] >= 0) || !Number.isFinite(ps[i])) throw new Error('piecewiseLinear: densities must be finite and non-negative');
  }

  const n = xs.length;

  // Trapezoidal area, then normalise.
  let area = 0;
  for (let i = 0; i < n - 1; i++) area += 0.5 * (ps[i] + ps[i + 1]) * (xs[i + 1] - xs[i]);
  if (!(area > 0)) throw new Error('piecewiseLinear: total probability is zero');

  const x = Float64Array.from(xs);
  const p = Float64Array.from(ps, (v) => v / area);

  // Cumulative probability at each node.
  const F = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) {
    F[i + 1] = F[i] + 0.5 * (p[i] + p[i + 1]) * (x[i + 1] - x[i]);
  }
  F[n - 1] = 1; // pin the top against accumulated rounding

  function pdf(v) {
    if (v <= x[0] || v >= x[n - 1]) return 0;
    const i = segmentFor(v);
    const t = (v - x[i]) / (x[i + 1] - x[i]);
    return p[i] + t * (p[i + 1] - p[i]);
  }

  function cdf(v) {
    if (v <= x[0]) return 0;
    if (v >= x[n - 1]) return 1;
    const i = segmentFor(v);
    const dx = x[i + 1] - x[i];
    const d = v - x[i];
    const k = (p[i + 1] - p[i]) / dx;
    return F[i] + p[i] * d + 0.5 * k * d * d;
  }

  /**
   * Exact inverse CDF. Solve  (k/2)d^2 + p0*d - (r - F0) = 0  for d.
   */
  function invCdf(r) {
    if (!(r >= 0 && r <= 1)) throw new Error('invCdf: probability must be in [0, 1]');
    if (r <= 0) return x[0];
    if (r >= 1) return x[n - 1];

    // Binary search for the segment holding r.
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (F[mid] <= r) lo = mid; else hi = mid;
    }
    const i = lo;
    const dx = x[i + 1] - x[i];
    const p0 = p[i];
    const k = (p[i + 1] - p0) / dx;
    const target = r - F[i];

    let d;
    if (Math.abs(k) < 1e-14) {
      // Uniform segment.
      d = target / p0;
    } else {
      const disc = p0 * p0 + 2 * k * target;
      d = (-p0 + Math.sqrt(Math.max(disc, 0))) / k;
    }
    // Guard against rounding pushing us outside the segment.
    if (d < 0) d = 0;
    if (d > dx) d = dx;
    return x[i] + d;
  }

  function segmentFor(v) {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x[mid] <= v) lo = mid; else hi = mid;
    }
    return lo;
  }

  return {
    kind: 'piecewise',
    min: x[0],
    max: x[n - 1],
    nodes: { x, p, F },
    pdf,
    cdf,
    invCdf,
    /** Draw one value by inverse transform. */
    sample: (rng) => invCdf(rng.uniform01()),
    mean() {
      // Exact first moment of a piecewise-linear density.
      let m = 0;
      for (let i = 0; i < n - 1; i++) {
        const x0 = x[i], x1 = x[i + 1], p0 = p[i], p1 = p[i + 1];
        const h = x1 - x0;
        m += h * ((2 * p1 + p0) * x1 + (p1 + 2 * p0) * x0) / 6;
      }
      return m;
    },
  };
}

/**
 * Parse a RISeR `makePDF.py` output file: two whitespace-separated columns of
 * value and probability, with optional `#` comment lines. Files that your
 * existing RISeR install already emits load through here unmodified.
 */
export function parseRiserPdf(text) {
  const xs = [], ps = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/[\s,]+/);
    if (parts.length < 2) continue;
    const v = Number(parts[0]);
    const q = Number(parts[1]);
    if (!Number.isFinite(v) || !Number.isFinite(q)) continue;
    xs.push(v);
    ps.push(q);
  }
  return piecewiseLinear(xs, ps);
}

/**
 * Seedable pseudo-random number generation.
 *
 * Everything downstream draws from one of these generators, so a run is
 * reproducible from its seed alone. The rule that makes that true: build a
 * FRESH generator at the start of every run and always draw in the same order.
 * A module-level shared generator would make "same seed" false as soon as two
 * figures on a page rendered in a different order.
 */

/**
 * Hash an arbitrary string into four 32-bit seeds.
 * Lets a student type a word into the seed box instead of a number.
 */
export function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/**
 * mulberry32: five lines, 32-bit state, period 2^32.
 * A 10,000-path run consumes well under 10^6 draws, so the period is a
 * non-issue here, and the brevity matters because students read this file.
 */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** sfc32: 128-bit state, for anyone who wants a longer period. */
export function sfc32(a, b, c, d) {
  return function () {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * A random source with the derived distributions attached.
 * `seed` may be a string or a number.
 */
export function makeRng(seed = 'teaching') {
  const seeds = cyrb128(String(seed));
  const uniform01 = mulberry32(seeds[0]);

  // Box-Muller with a cached second variate. Note that this makes the number
  // of uniforms consumed per normal draw non-constant, so seed reproducibility
  // holds for identical control settings, not across different ones. Building a
  // fresh Rng per run makes that a non-problem.
  let spare = null;
  function normal() {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0, s = 0;
    do {
      u = uniform01() * 2 - 1;
      v = uniform01() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * mul;
    return u * mul;
  }

  /**
   * Marsaglia and Tsang (2000) squeeze method for Gamma(shape, 1).
   * Used only as the engine behind Beta, which is the engine behind PERT.
   */
  function gamma(shape) {
    if (shape < 1) {
      // Johnk boost for shape < 1. PERT never reaches this branch, since its
      // alpha and beta are both >= 1 by construction; kept for generality.
      return gamma(shape + 1) * Math.pow(uniform01(), 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do { x = normal(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = uniform01();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  function beta(a, b) {
    const x = gamma(a);
    const y = gamma(b);
    return x / (x + y);
  }

  return {
    uniform01,
    uniform: (lo, hi) => lo + (hi - lo) * uniform01(),
    normal,
    gauss: (mean, sd) => mean + sd * normal(),
    gamma,
    beta,
    /** Pick an index from a normalised cumulative weight array. */
    pickIndex(cumWeights) {
      const r = uniform01();
      let lo = 0, hi = cumWeights.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumWeights[mid] < r) lo = mid + 1; else hi = mid;
      }
      return lo;
    },
  };
}

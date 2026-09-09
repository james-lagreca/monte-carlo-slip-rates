/**
 * Special functions: the standard normal CDF and its inverse.
 *
 * These exist so the site can print a closed-form prediction next to a Monte
 * Carlo result and have the two agree. Two places rely on them:
 *   - the monotonicity acceptance rate, P(t2 > t1) = Phi((mu2-mu1)/sqrt(s1^2+s2^2))
 *   - the ratio quantiles for a constant offset over a Gaussian age
 * Both are computable on paper, which is the point.
 */

/**
 * Cumulative distribution function of the standard normal.
 * Hart's rational approximation as given by West (2005), accurate to close to
 * double precision across the whole range.
 */
export function normalCdf(z) {
  const x = Math.abs(z);
  let c;
  if (x > 37) {
    c = 0;
  } else {
    const e = Math.exp(-x * x / 2);
    if (x < 7.07106781186547) {
      let b = 3.52624965998911e-02 * x + 0.700383064443688;
      b = b * x + 6.37396220353165;
      b = b * x + 33.912866078383;
      b = b * x + 112.079291497871;
      b = b * x + 221.213596169931;
      b = b * x + 220.206867912376;
      let d = 8.83883476483184e-02 * x + 1.75566716318264;
      d = d * x + 16.064177579207;
      d = d * x + 86.7807322029461;
      d = d * x + 296.564248779674;
      d = d * x + 637.333633378831;
      d = d * x + 793.826512519948;
      d = d * x + 440.413735824752;
      c = e * b / d;
    } else {
      let f = x + 0.65;
      f = x + 4 / f;
      f = x + 3 / f;
      f = x + 2 / f;
      f = x + 1 / f;
      c = e / (f * 2.506628274631);
    }
  }
  return z > 0 ? 1 - c : c;
}

/**
 * Inverse standard normal CDF (the probit function).
 * Acklam's rational approximation, then one Halley refinement step against
 * `normalCdf`, which takes it to full double precision.
 */
export function normalInvCdf(p) {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    throw new Error('normalInvCdf: probability must be in [0, 1]');
  }
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r, x;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
         ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  // One Halley step.
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
  x = x - u / (1 + x * u / 2);
  return x;
}

/** Standard normal probability density. */
export function normalPdf(z) {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

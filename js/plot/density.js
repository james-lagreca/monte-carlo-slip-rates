/**
 * Rate-distribution figures: the smoothed PDF, its confidence band, and the
 * comparisons the teaching depends on.
 */

import { setupCanvas, drawFrame, token, polyline, inPlotLabel, DASH } from './core.js';

/**
 * Draw a rate PDF with its interval shaded.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} summary  the object returned by engine summarise()
 * @param {object} opts
 * @param {'percentile'|'hpd'|'both'} opts.method
 * @param {object|null} opts.naive     naivePropagation() result, drawn as a foil
 * @param {number|null} opts.truth     the ground truth, when the data are forward-modelled
 * @param {string} opts.xLabel
 */
export function drawRatePdf(canvas, summary, opts = {}) {
  const { ctx, width, height } = setupCanvas(canvas);
  const method = opts.method || 'percentile';
  const dens = summary.density;
  const n = dens.density.length;

  let yMax = 0;
  for (let i = 0; i < n; i++) if (dens.density[i] > yMax) yMax = dens.density[i];
  if (!(yMax > 0)) yMax = 1;

  const xLo = opts.xMin != null ? opts.xMin : dens.x[0] - dens.width / 2;
  const xHi = opts.xMax != null ? opts.xMax : dens.x[n - 1] + dens.width / 2;

  const f = drawFrame(ctx, width, height, {
    xDomain: [xLo, xHi],
    yDomain: [0, yMax * 1.12],
    xLabel: opts.xLabel || 'Slip rate (mm/yr)',
    yLabel: 'Probability density',
    yTicks: [],
  });

  const cData = token('--c-data', '#3B5B80');
  const cPref = token('--c-pref', '#2E6E4E');
  const cNaive = token('--c-naive', '#A6524B');
  const cInk = token('--ink', '#1E2A32');

  // Shaded interval, drawn under the curve.
  const shade = (lo, hi, colour, alpha) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(f.x(Math.max(lo, xLo)), f.y(0));
    for (let i = 0; i < n; i++) {
      if (dens.x[i] < lo || dens.x[i] > hi) continue;
      ctx.lineTo(f.x(dens.x[i]), f.y(dens.density[i]));
    }
    ctx.lineTo(f.x(Math.min(hi, xHi)), f.y(0));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  if (method === 'percentile' || method === 'both') {
    shade(summary.percentile.lower, summary.percentile.upper, cData, 0.22);
  }
  if (method === 'hpd' || method === 'both') {
    for (const c of summary.hpd.clusters) shade(c.lower, c.upper, cPref, 0.22);
  }

  // The density curve.
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([f.x(dens.x[i]), f.y(dens.density[i])]);
  polyline(ctx, pts, { color: cInk, width: 1.8 });

  // Median.
  const med = summary.percentile.median;
  if (med >= xLo && med <= xHi) {
    polyline(ctx, [[f.x(med), f.y(0)], [f.x(med), f.y(yMax * 1.02)]],
      { color: cData, width: 1.6 });
    inPlotLabel(ctx, 'median ' + med.toFixed(2), f.x(med) + 5, f.y(yMax * 1.04), cData);
  }

  // Ground truth, when there is one.
  if (opts.truth != null && opts.truth >= xLo && opts.truth <= xHi) {
    polyline(ctx, [[f.x(opts.truth), f.y(0)], [f.x(opts.truth), f.y(yMax * 1.08)]],
      { color: cPref, width: 1.6, dash: DASH.truth });
    inPlotLabel(ctx, 'true ' + opts.truth.toFixed(2), f.x(opts.truth) + 5, f.y(yMax * 1.10), cPref);
  }

  // The naive plus-or-minus, drawn as a bar so the contrast is unmissable.
  if (opts.naive) {
    const yBar = f.y(yMax * 0.5);
    const lo = Math.max(opts.naive.lower, xLo);
    const hi = Math.min(opts.naive.upper, xHi);
    ctx.save();
    ctx.strokeStyle = cNaive;
    ctx.lineWidth = 2.2;
    ctx.setLineDash(DASH.naive);
    ctx.beginPath();
    ctx.moveTo(f.x(lo), yBar);
    ctx.lineTo(f.x(hi), yBar);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const v of [lo, hi]) {
      ctx.beginPath();
      ctx.moveTo(f.x(v), yBar - 6);
      ctx.lineTo(f.x(v), yBar + 6);
      ctx.stroke();
    }
    ctx.restore();
    inPlotLabel(ctx, 'naive ±', f.x(hi) + 6, yBar, cNaive);
  }

  // Say so when the tail runs off the plot, rather than squashing everything.
  if (summary.tailClipped) {
    inPlotLabel(ctx,
      'tail continues to ' + formatBig(summary.tailMax),
      f.plot.left + f.plot.width - 4, f.plot.top + 10, token('--c-behead', '#A32732'), 'right');
  }

  return f;
}

/**
 * Two PDFs on one axis, for anchored against unanchored.
 * Colours chosen for a lightness difference, not hue alone.
 */
export function drawTwoPdfs(canvas, a, b, opts = {}) {
  const { ctx, width, height } = setupCanvas(canvas);
  const dens = [a.density, b.density];
  let yMax = 0, xLo = Infinity, xHi = -Infinity;
  for (const d of dens) {
    for (let i = 0; i < d.density.length; i++) if (d.density[i] > yMax) yMax = d.density[i];
    xLo = Math.min(xLo, d.x[0]);
    xHi = Math.max(xHi, d.x[d.x.length - 1]);
  }
  if (opts.xMin != null) xLo = opts.xMin;
  if (opts.xMax != null) xHi = opts.xMax;

  const f = drawFrame(ctx, width, height, {
    xDomain: [xLo, xHi],
    yDomain: [0, yMax * 1.15],
    xLabel: opts.xLabel || 'Slip rate (mm/yr)',
    yLabel: 'Probability density',
    yTicks: [],
  });

  const specs = [
    { s: a, color: token(opts.colorA || '--c-naive', '#A6524B'), dash: DASH.naive, label: opts.labelA || 'A' },
    { s: b, color: token(opts.colorB || '--c-sub', '#27406E'), dash: [], label: opts.labelB || 'B' },
  ];
  for (const sp of specs) {
    const d = sp.s.density;
    const pts = [];
    for (let i = 0; i < d.density.length; i++) pts.push([f.x(d.x[i]), f.y(d.density[i])]);
    polyline(ctx, pts, { color: sp.color, width: 1.9, dash: sp.dash });
    const med = sp.s.percentile.median;
    inPlotLabel(ctx, sp.label + ' ' + med.toFixed(2), f.x(med), f.y(peakAt(d, med)) - 10, sp.color, 'center');
  }

  if (opts.truth != null) {
    polyline(ctx, [[f.x(opts.truth), f.y(0)], [f.x(opts.truth), f.y(yMax * 1.1)]],
      { color: token('--c-pref', '#2E6E4E'), width: 1.5, dash: DASH.truth });
    inPlotLabel(ctx, 'true ' + opts.truth, f.x(opts.truth) + 5, f.y(yMax * 1.12), token('--c-pref', '#2E6E4E'));
  }
  return f;
}

function peakAt(d, x) {
  let best = 0;
  for (let i = 0; i < d.x.length; i++) {
    if (Math.abs(d.x[i] - x) < d.width * 2 && d.density[i] > best) best = d.density[i];
  }
  return best;
}

/** Input PDFs, drawn small, so the student sees what is being divided. */
export function drawInputPdf(canvas, dist, opts = {}) {
  const { ctx, width, height } = setupCanvas(canvas);
  const N = 260;
  const lo = dist.min, hi = dist.max;
  const xs = [], ys = [];
  let yMax = 0;
  for (let i = 0; i <= N; i++) {
    const x = lo + (hi - lo) * i / N;
    const p = dist.pdf(x);
    xs.push(x); ys.push(Number.isFinite(p) ? p : 0);
    if (p > yMax && Number.isFinite(p)) yMax = p;
  }
  if (!(yMax > 0)) yMax = 1;

  const f = drawFrame(ctx, width, height, {
    xDomain: [lo, hi],
    yDomain: [0, yMax * 1.15],
    xLabel: opts.xLabel || '',
    yLabel: '',
    yTicks: [],
    margin: { top: 14, right: 14, bottom: 36, left: 22 },
  });

  const color = token(opts.color || '--c-data', '#3B5B80');
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(f.x(lo), f.y(0));
  for (let i = 0; i <= N; i++) ctx.lineTo(f.x(xs[i]), f.y(ys[i]));
  ctx.lineTo(f.x(hi), f.y(0));
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const pts = [];
  for (let i = 0; i <= N; i++) pts.push([f.x(xs[i]), f.y(ys[i])]);
  polyline(ctx, pts, { color, width: 1.8 });

  if (opts.label) inPlotLabel(ctx, opts.label, f.plot.left + 4, f.plot.top + 8, color);
  return f;
}

function formatBig(v) {
  if (v >= 1e6) return v.toExponential(1);
  if (v >= 1000) return Math.round(v).toLocaleString('en-GB');
  return v.toFixed(0);
}

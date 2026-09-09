/**
 * Plotting primitives: scales, HiDPI canvas setup, and house-style axes.
 *
 * The axes deliberately match the publication figures: bottom and left spine
 * only, ticks pointing out, no grid, no legend box. Series are labelled where
 * they are drawn rather than in a key, because the manuscript palette is
 * near-iso-luminant and a colour swatch alone will not separate two lines for
 * a reader with a colour vision deficiency.
 */

/* ---------- scales ---------- */

export function linearScale(domain, range) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = (d1 - d0) || 1;
  const fn = (v) => r0 + (v - d0) / span * (r1 - r0);
  fn.invert = (p) => d0 + (p - r0) / ((r1 - r0) || 1) * span;
  fn.domain = domain;
  fn.range = range;
  return fn;
}

export function logScale(domain, range) {
  const d0 = Math.max(domain[0], 1e-12);
  const d1 = Math.max(domain[1], d0 * 10);
  const l0 = Math.log10(d0), l1 = Math.log10(d1);
  const [r0, r1] = range;
  const fn = (v) => r0 + (Math.log10(Math.max(v, d0)) - l0) / (l1 - l0) * (r1 - r0);
  fn.invert = (p) => Math.pow(10, l0 + (p - r0) / ((r1 - r0) || 1) * (l1 - l0));
  fn.domain = [d0, d1];
  fn.range = range;
  fn.isLog = true;
  return fn;
}

/** Round tick values, roughly `count` of them. */
export function niceTicks(lo, hi, count = 6) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  }
  return out;
}

export function logTicks(lo, hi) {
  const out = [];
  const e0 = Math.floor(Math.log10(lo));
  const e1 = Math.ceil(Math.log10(hi));
  for (let e = e0; e <= e1; e++) {
    const v = Math.pow(10, e);
    if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
  }
  return out;
}

/* ---------- canvas ---------- */

/**
 * Size a canvas for the device pixel ratio and return a context whose
 * coordinates are CSS pixels. The width attribute in the HTML sets the
 * drawing width; CSS scales it to the container.
 */
export function setupCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.getAttribute('width') ? Number(canvas.getAttribute('width')) : canvas.clientWidth;
  const cssH = canvas.getAttribute('height') ? Number(canvas.getAttribute('height')) : canvas.clientHeight;
  if (canvas.width !== Math.round(cssW * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return { ctx, width: cssW, height: cssH, dpr };
}

/** Read a CSS custom property, so the palette lives in one place. */
export function token(name, fallback = '#000') {
  if (typeof getComputedStyle !== 'function') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v ? v.trim() : fallback;
}

export const DASH = {
  solid: [],
  truth: [6, 4],
  naive: [2, 3],
  alt: [9, 3, 2, 3],
};

/* ---------- axes ---------- */

export const MARGIN = { top: 18, right: 18, bottom: 42, left: 58 };

/**
 * Draw the frame. Returns the scales so the caller can plot into it.
 *
 * @param {object} opts
 * @param {[number,number]} opts.xDomain
 * @param {[number,number]} opts.yDomain
 * @param {string} opts.xLabel
 * @param {string} opts.yLabel
 * @param {boolean} opts.xLog
 */
export function drawFrame(ctx, width, height, opts) {
  const m = { ...MARGIN, ...(opts.margin || {}) };
  const ink = token('--ink', '#1E2A32');
  const soft = token('--ink-soft', '#54636D');
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  const x = opts.xLog
    ? logScale(opts.xDomain, [m.left, m.left + plotW])
    : linearScale(opts.xDomain, [m.left, m.left + plotW]);
  const y = opts.yLog
    ? logScale(opts.yDomain, [m.top + plotH, m.top])
    : linearScale(opts.yDomain, [m.top + plotH, m.top]);

  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = ink;
  ctx.fillStyle = soft;
  ctx.font = '11px "IBM Plex Mono", monospace';

  // Bottom and left spine only. No grid, no box.
  ctx.beginPath();
  ctx.moveTo(m.left, m.top);
  ctx.lineTo(m.left, m.top + plotH);
  ctx.lineTo(m.left + plotW, m.top + plotH);
  ctx.stroke();

  const xTicks = opts.xTicks || (opts.xLog ? logTicks(x.domain[0], x.domain[1]) : niceTicks(opts.xDomain[0], opts.xDomain[1], 6));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of xTicks) {
    const px = x(t);
    if (px < m.left - 0.5 || px > m.left + plotW + 0.5) continue;
    ctx.beginPath();
    ctx.moveTo(px, m.top + plotH);
    ctx.lineTo(px, m.top + plotH + 4);
    ctx.stroke();
    ctx.fillText(formatTick(t), px, m.top + plotH + 7);
  }

  const yTicks = opts.yTicks || (opts.yLog ? logTicks(y.domain[0], y.domain[1]) : niceTicks(opts.yDomain[0], opts.yDomain[1], 5));
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of yTicks) {
    const py = y(t);
    if (py < m.top - 0.5 || py > m.top + plotH + 0.5) continue;
    ctx.beginPath();
    ctx.moveTo(m.left - 4, py);
    ctx.lineTo(m.left, py);
    ctx.stroke();
    ctx.fillText(formatTick(t), m.left - 7, py);
  }

  ctx.fillStyle = ink;
  ctx.font = '12px "IBM Plex Sans", sans-serif';
  if (opts.xLabel) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(opts.xLabel, m.left + plotW / 2, height - 4);
  }
  if (opts.yLabel) {
    ctx.save();
    ctx.translate(12, m.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(opts.yLabel, 0, 0);
    ctx.restore();
  }
  ctx.restore();

  return { x, y, plot: { left: m.left, top: m.top, width: plotW, height: plotH }, margin: m };
}

export function formatTick(v) {
  const a = Math.abs(v);
  if (v === 0) return '0';
  if (a >= 10000 || a < 0.001) return v.toExponential(0).replace('e+', 'e');
  if (a >= 100) return String(Math.round(v));
  if (a >= 10) return String(Number(v.toFixed(1)));
  if (a >= 1) return String(Number(v.toFixed(2)));
  return String(Number(v.toFixed(3)));
}

/** A label placed next to the series it names, with a legible halo. */
export function inPlotLabel(ctx, text, px, py, color, align = 'left') {
  ctx.save();
  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = token('--white', '#fff');
  ctx.strokeText(text, px, py);
  ctx.fillStyle = color;
  ctx.fillText(text, px, py);
  ctx.restore();
}

/** Dashed or solid line through a series of [x, y] points already in pixels. */
export function polyline(ctx, points, { color, width = 1.6, dash = [] } = {}) {
  if (!points.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();
  ctx.restore();
}

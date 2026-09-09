/**
 * The path fan: thousands of accepted displacement-against-age paths drawn on
 * one axis. This is the signature figure of the incremental slip-rate genre.
 *
 * Two render modes, because they fail differently:
 *
 *   alpha    Stroke the paths in batches of a few hundred. Cheap, and it
 *            animates. The batching is not an optimisation detail: putting
 *            every path in ONE beginPath means the whole thing is rasterised
 *            and composited once, so overlapping strokes stop accumulating
 *            alpha and the density information is lost. Chunking keeps the
 *            accumulation while cutting stroke calls by a few hundred times.
 *
 *   density  Rasterise into an integer count grid, then map counts through a
 *            ramp. Slower to write but exact, and it is what makes the figure
 *            look like the published ones.
 */

import { setupCanvas, drawFrame, token, polyline, inPlotLabel, DASH } from './core.js';

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} result   the object returned by runIncremental()
 * @param {object} opts
 * @param {'alpha'|'density'} opts.mode
 * @param {number} opts.maxPaths      cap on how many paths to draw
 * @param {Array|null} opts.medianPath
 * @param {number|null} opts.truthRate  draw a known slip history for comparison
 * @param {boolean} opts.animate
 * @returns {{cancel: Function}} handle so a re-render can stop the previous one
 */
export function drawPathFan(canvas, result, opts = {}) {
  const { ctx, width, height } = setupCanvas(canvas);
  const m = result.markerCount;
  const nPaths = result.accepted;
  const maxPaths = Math.min(opts.maxPaths || 4000, nPaths);
  const mode = opts.mode || 'alpha';

  const reduceMotion = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // A hidden tab never fires requestAnimationFrame, so growing the fan in
  // frames there would leave it blank. Draw in one pass instead.
  const hidden = typeof document !== 'undefined' && document.hidden;
  const animate = opts.animate !== false && !reduceMotion && !hidden && mode === 'alpha';

  // Domain from the marker distributions, not the draws, so the axes stay put
  // while a slider moves and the fan can be compared frame to frame.
  let tLo = Infinity, tHi = -Infinity, dLo = 0, dHi = -Infinity;
  for (const nd of result.nodes) {
    tLo = Math.min(tLo, nd.age.min);
    tHi = Math.max(tHi, nd.age.max);
    dHi = Math.max(dHi, nd.displacement.max);
  }
  if (opts.tMax != null) tHi = opts.tMax;
  if (opts.dMax != null) dHi = opts.dMax;
  tLo = Math.max(0, Math.min(tLo, 0) === 0 ? 0 : tLo);
  const pad = (tHi - tLo) * 0.04;

  const f = drawFrame(ctx, width, height, {
    xDomain: [Math.max(0, tLo - pad), tHi + pad],
    yDomain: [dLo, dHi * 1.06],
    xLabel: opts.xLabel || 'Age (ka)',
    yLabel: opts.yLabel || 'Cumulative displacement (m)',
  });

  const cInk = token('--ink', '#1E2A32');
  const cData = token('--c-data', '#3B5B80');
  const cPref = token('--c-pref', '#2E6E4E');
  const cIncr = token('--c-incr', '#6E6E6E');

  let cancelled = false;

  function drawOverlays() {
    // Marker observation boxes: the data, before any modelling.
    ctx.save();
    ctx.strokeStyle = cData;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    for (const nd of result.nodes) {
      if (nd.isAnchor) continue;
      const x0 = f.x(nd.age.min), x1 = f.x(nd.age.max);
      const y0 = f.y(nd.displacement.min), y1 = f.y(nd.displacement.max);
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
    ctx.restore();
    for (const nd of result.nodes) {
      if (nd.isAnchor) continue;
      inPlotLabel(ctx, nd.label, f.x(nd.age.mean), f.y(nd.displacement.max) - 9, cData, 'center');
    }

    if (opts.truthRate != null) {
      const t0 = opts.truthOnset != null ? opts.truthOnset : 0;
      const tEnd = f.x.domain[1];
      polyline(ctx, [
        [f.x(t0), f.y(0)],
        [f.x(tEnd), f.y(opts.truthRate * (tEnd - t0))],
      ], { color: cPref, width: 1.8, dash: DASH.truth });
      inPlotLabel(ctx, 'true ' + opts.truthRate.toFixed(2) + ' mm/yr',
        f.x(tEnd) - 6, f.y(opts.truthRate * (tEnd - t0)) - 10, cPref, 'right');
    }

    if (opts.medianPath && opts.medianPath.length) {
      const pts = opts.medianPath.map((p) => [f.x(p.age), f.y(p.displacement)]);
      polyline(ctx, pts, { color: cInk, width: 2.2 });
      inPlotLabel(ctx, 'median path', pts[pts.length - 1][0] - 6, pts[pts.length - 1][1] + 12, cInk, 'right');
    }
  }

  if (mode === 'density') {
    renderDensity(ctx, f, result, maxPaths, m, width, height);
    drawOverlays();
    return { cancel() {} };
  }

  // Alpha mode.
  ctx.save();
  ctx.strokeStyle = cIncr;
  ctx.globalAlpha = alphaFor(maxPaths);
  ctx.lineWidth = 0.7;
  ctx.lineJoin = 'round';

  const BATCH = 400;
  let drawn = 0;
  const stride = Math.max(1, Math.floor(nPaths / maxPaths));

  function drawBatch() {
    if (cancelled) return;
    const end = Math.min(drawn + BATCH, maxPaths);
    ctx.beginPath();
    for (let k = drawn; k < end; k++) {
      const p = k * stride;
      const base = p * m;
      ctx.moveTo(f.x(result.agePaths[base]), f.y(result.dspPaths[base]));
      for (let j = 1; j < m; j++) {
        ctx.lineTo(f.x(result.agePaths[base + j]), f.y(result.dspPaths[base + j]));
      }
    }
    ctx.stroke();
    drawn = end;
    if (drawn < maxPaths) {
      if (animate) requestAnimationFrame(drawBatch);
      else drawBatch();
    } else {
      ctx.restore();
      drawOverlays();
    }
  }
  drawBatch();

  return { cancel() { cancelled = true; } };
}

function alphaFor(n) {
  if (n <= 200) return 0.18;
  if (n <= 1000) return 0.08;
  if (n <= 4000) return 0.04;
  return 0.02;
}

/**
 * Exact density field. Walk each segment with a DDA into a count grid, then
 * map counts through a ramp and blit once.
 */
function renderDensity(ctx, f, result, maxPaths, m, width, height) {
  const x0 = Math.round(f.plot.left), y0 = Math.round(f.plot.top);
  const w = Math.round(f.plot.width), h = Math.round(f.plot.height);
  if (w <= 0 || h <= 0) return;
  const counts = new Uint32Array(w * h);
  const stride = Math.max(1, Math.floor(result.accepted / maxPaths));

  for (let k = 0; k < maxPaths; k++) {
    const base = k * stride * m;
    for (let j = 1; j < m; j++) {
      const ax = f.x(result.agePaths[base + j - 1]) - x0;
      const ay = f.y(result.dspPaths[base + j - 1]) - y0;
      const bx = f.x(result.agePaths[base + j]) - x0;
      const by = f.y(result.dspPaths[base + j]) - y0;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))));
      for (let s = 0; s <= steps; s++) {
        const px = Math.round(ax + (bx - ax) * s / steps);
        const py = Math.round(ay + (by - ay) * s / steps);
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        counts[py * w + px]++;
      }
    }
  }

  let peak = 0;
  for (let i = 0; i < counts.length; i++) if (counts[i] > peak) peak = counts[i];
  if (peak === 0) return;

  const img = ctx.createImageData(w, h);
  const rgb = hexToRgb(token('--c-incr', '#6E6E6E'));
  for (let i = 0; i < counts.length; i++) {
    if (!counts[i]) continue;
    // Square root ramp: keeps the sparse edges of the fan visible.
    const t = Math.sqrt(counts[i] / peak);
    const o = i * 4;
    img.data[o] = rgb[0];
    img.data[o + 1] = rgb[1];
    img.data[o + 2] = rgb[2];
    img.data[o + 3] = Math.min(255, Math.round(40 + 215 * t));
  }
  ctx.putImageData(img, x0, y0);
}

function hexToRgb(hex) {
  const h = hex.replace('#', '').trim();
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * One rejected realisation, with the offending pair circled and named.
 * The single most clarifying thing on the incremental page: it turns the
 * accept/reject condition from a line of code into something you can see.
 */
export function drawRejectedPath(canvas, result, opts = {}) {
  const rej = result.firstRejection;
  const { ctx, width, height } = setupCanvas(canvas);
  const m = result.markerCount;

  let tHi = 0, dHi = 0;
  for (const nd of result.nodes) {
    tHi = Math.max(tHi, nd.age.max);
    dHi = Math.max(dHi, nd.displacement.max);
  }

  const f = drawFrame(ctx, width, height, {
    xDomain: [0, tHi * 1.05],
    yDomain: [0, dHi * 1.1],
    xLabel: 'Age (ka)',
    yLabel: 'Displacement (m)',
    margin: { top: 16, right: 16, bottom: 40, left: 50 },
  });

  const cData = token('--c-data', '#3B5B80');
  const cBad = token('--c-behead', '#A32732');

  ctx.save();
  ctx.strokeStyle = cData;
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  for (const nd of result.nodes) {
    if (nd.isAnchor) continue;
    const ax = f.x(nd.age.min), bx = f.x(nd.age.max);
    const ay = f.y(nd.displacement.min), by = f.y(nd.displacement.max);
    ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
  }
  ctx.restore();

  if (!rej) {
    inPlotLabel(ctx, 'no realisation was rejected', f.plot.left + f.plot.width / 2,
      f.plot.top + f.plot.height / 2, token('--ink-soft', '#54636D'), 'center');
    return;
  }

  const pts = [];
  for (let j = 0; j < m; j++) pts.push([f.x(rej.ages[j]), f.y(rej.dsps[j])]);
  polyline(ctx, pts, { color: cBad, width: 2 });

  ctx.save();
  ctx.fillStyle = cBad;
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Ring the offending pair.
  ctx.strokeStyle = cBad;
  ctx.lineWidth = 1.8;
  for (const idx of rej.pair) {
    if (idx < 0 || idx >= pts.length) continue;
    ctx.beginPath();
    ctx.arc(pts[idx][0], pts[idx][1], 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  const mid = rej.pair.map((i) => pts[Math.max(0, Math.min(i, pts.length - 1))]);
  const lx = (mid[0][0] + mid[1][0]) / 2;
  const ly = (mid[0][1] + mid[1][1]) / 2;
  inPlotLabel(ctx, 'rejected: ' + rej.reason, lx + 14, ly, cBad);
  return f;
}

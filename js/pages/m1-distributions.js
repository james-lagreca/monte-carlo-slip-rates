/**
 * Distribution vocabulary page controller.
 */

import { makeDistribution, makeRng, runSingleMarker, histogram } from '../engine/index.js';
import { setupCanvas, drawFrame, token, polyline, inPlotLabel, DASH } from '../plot/core.js';
import { $, el, setReadout, describeCanvas, fillTable, debounce } from '../ui/dom.js';

/** Which sliders each shape uses, and what to call them. */
const SHAPES = {
  gauss:      { keys: ['mean', 'sd'], labels: ['Mean', 'Standard deviation'], defaults: [12, 0.8] },
  boxcar:     { keys: ['min', 'max'], labels: ['Minimum', 'Maximum'], defaults: [10.5, 13.5] },
  triangular: { keys: ['min', 'mode', 'max'], labels: ['Minimum', 'Preferred', 'Maximum'], defaults: [10.5, 12, 13.5] },
  trapezoid:  { keys: ['min', 'lo', 'hi', 'max'], labels: ['Minimum', 'Lower shoulder', 'Upper shoulder', 'Maximum'], defaults: [9, 11, 13, 15] },
  pert:       { keys: ['min', 'mode', 'max'], labels: ['Minimum', 'Preferred', 'Maximum'], defaults: [10.5, 12, 13.5] },
};

const typeSel = $('#type');
const sliders = [1, 2, 3, 4].map((i) => ({
  wrap: $('#wrap-p' + i), input: $('#p' + i), label: $('#lab-p' + i), value: $('#val-p' + i),
}));

function syncControls(resetValues) {
  const shape = SHAPES[typeSel.value];
  sliders.forEach((s, i) => {
    const used = i < shape.keys.length;
    s.wrap.style.display = used ? '' : 'none';
    if (!used) return;
    s.label.textContent = shape.labels[i];
    // The sigma slider needs a different range from the value sliders.
    const isSigma = typeSel.value === 'gauss' && i === 1;
    s.input.min = isSigma ? 0.05 : 0;
    s.input.max = isSigma ? 4 : 20;
    s.input.step = isSigma ? 0.05 : 0.1;
    if (resetValues) s.input.value = shape.defaults[i];
  });
}

function currentSpec() {
  const type = typeSel.value;
  const shape = SHAPES[type];
  const spec = { type };
  shape.keys.forEach((k, i) => { spec[k] = Number(sliders[i].input.value); });
  // Keep the ordered shapes ordered, so a drag cannot throw.
  if (type === 'triangular' || type === 'pert') {
    spec.min = Math.min(spec.min, spec.max);
    spec.max = Math.max(spec.min + 0.1, spec.max);
    spec.mode = Math.min(Math.max(spec.mode, spec.min), spec.max);
  }
  if (type === 'trapezoid') {
    const v = [spec.min, spec.lo, spec.hi, spec.max].sort((a, b) => a - b);
    [spec.min, spec.lo, spec.hi, spec.max] = v;
    if (spec.max - spec.min < 0.1) spec.max = spec.min + 0.1;
  }
  if (type === 'boxcar') {
    const lo = Math.min(spec.min, spec.max), hi = Math.max(spec.min, spec.max);
    spec.min = lo; spec.max = hi < lo + 0.1 ? lo + 0.1 : hi;
  }
  return spec;
}

function render() {
  syncControls(false);
  const shape = SHAPES[typeSel.value];
  const spec = currentSpec();
  shape.keys.forEach((k, i) => {
    sliders[i].value.textContent = Number(spec[k]).toFixed(2);
  });

  let dist;
  try {
    dist = makeDistribution(spec);
  } catch (err) {
    $('#warnings').innerHTML = '<div class="callout warn"><p>' + err.message + '</p></div>';
    return;
  }

  drawCurve($('#pdf'), dist, 'pdf');
  drawCurve($('#cdf'), dist, 'cdf');

  setReadout('ro-label', dist.label);
  setReadout('ro-mean', dist.mean.toFixed(3));
  setReadout('ro-sd', dist.sd.toFixed(3));
  setReadout('ro-support', dist.min.toFixed(2) + ' to ' + dist.max.toFixed(2));

  const warn = $('#warnings');
  warn.innerHTML = '';
  for (const w of dist.warnings) {
    warn.appendChild(el('div', { class: 'callout warn' }, [
      el('span', { class: 'tag', text: 'Watch this' }),
      el('p', { text: w }),
    ]));
  }
}

/** Draw the density or the cumulative curve, with real draws overlaid. */
function drawCurve(canvas, dist, which) {
  const { ctx, width, height } = setupCanvas(canvas);
  const N = 300;
  const lo = dist.min, hi = dist.max;
  const xs = [], ys = [];
  let yMax = 0;
  for (let i = 0; i <= N; i++) {
    const x = lo + (hi - lo) * i / N;
    const v = which === 'pdf' ? dist.pdf(x) : dist.cdf(x);
    xs.push(x);
    ys.push(Number.isFinite(v) ? v : 0);
    if (Number.isFinite(v) && v > yMax) yMax = v;
  }
  if (!(yMax > 0)) yMax = 1;

  const f = drawFrame(ctx, width, height, {
    xDomain: [lo, hi],
    yDomain: [0, which === 'pdf' ? yMax * 1.15 : 1.05],
    xLabel: 'Value',
    yLabel: which === 'pdf' ? 'Density' : 'Cumulative probability',
    yTicks: which === 'pdf' ? [] : [0, 0.25, 0.5, 0.75, 1],
  });

  const color = token('--c-data', '#3B5B80');

  // Overlay the histogram of actual draws, which proves the sampler matches.
  if (which === 'pdf' && $('#show-draws').checked) {
    const rng = makeRng('teaching');
    const draws = new Float64Array(40000);
    for (let i = 0; i < draws.length; i++) draws[i] = dist.sample(rng);
    const h = histogram(draws, { bins: 44, lo, hi });
    ctx.save();
    ctx.fillStyle = token('--c-incr', '#6E6E6E');
    ctx.globalAlpha = 0.22;
    for (let i = 0; i < h.density.length; i++) {
      const x0 = f.x(h.x[i] - h.width / 2);
      const x1 = f.x(h.x[i] + h.width / 2);
      const y = f.y(h.density[i]);
      ctx.fillRect(x0, y, Math.max(1, x1 - x0), f.y(0) - y);
    }
    ctx.restore();
    inPlotLabel(ctx, '40,000 draws', f.plot.left + f.plot.width - 6, f.plot.top + 10,
      token('--c-incr', '#6E6E6E'), 'right');
  }

  const pts = xs.map((x, i) => [f.x(x), f.y(ys[i])]);
  polyline(ctx, pts, { color, width: 2 });

  if (which === 'cdf') {
    // Show one inverse-transform lookup, which is what sampling actually does.
    const p = 0.63;
    const v = dist.invCdf(p);
    polyline(ctx, [[f.plot.left, f.y(p)], [f.x(v), f.y(p)]],
      { color: token('--c-naive', '#A6524B'), width: 1.4, dash: DASH.naive });
    polyline(ctx, [[f.x(v), f.y(p)], [f.x(v), f.y(0)]],
      { color: token('--c-naive', '#A6524B'), width: 1.4, dash: DASH.naive });
    inPlotLabel(ctx, 'draw ' + p + ' → ' + v.toFixed(2), f.x(v) + 6, f.y(p) - 10,
      token('--c-naive', '#A6524B'));
  }

  describeCanvas(canvas, (which === 'pdf' ? 'Probability density' : 'Cumulative distribution')
    + ' for ' + dist.label + '. Mean ' + dist.mean.toFixed(2)
    + ', standard deviation ' + dist.sd.toFixed(2) + '.');
}

/**
 * Two displacement shapes matched on mean and standard deviation, divided by
 * the same age. If shape did not matter these would coincide.
 */
function renderComparison() {
  // Trapezoid(9, 11, 13, 15): mean 12, sd computed by the engine.
  const trap = { type: 'trapezoid', min: 9, lo: 11, hi: 13, max: 15 };
  const trapDist = makeDistribution(trap);
  const gauss = { type: 'gauss', mean: trapDist.mean, sd: trapDist.sd };
  const age = { type: 'gauss', mean: 4.0, sd: 0.3 };

  const a = runSingleMarker({ displacement: trap, age, n: 200000, seed: 'teaching' });
  const b = runSingleMarker({ displacement: gauss, age, n: 200000, seed: 'teaching' });

  const canvas = $('#compare');
  const { ctx, width, height } = setupCanvas(canvas);
  const dens = [a.stats.density, b.stats.density];
  let yMax = 0, xLo = Infinity, xHi = -Infinity;
  for (const d of dens) {
    for (let i = 0; i < d.density.length; i++) if (d.density[i] > yMax) yMax = d.density[i];
    xLo = Math.min(xLo, d.x[0]);
    xHi = Math.max(xHi, d.x[d.x.length - 1]);
  }
  const f = drawFrame(ctx, width, height, {
    xDomain: [xLo, xHi], yDomain: [0, yMax * 1.15],
    xLabel: 'Slip rate (mm/yr)', yLabel: 'Probability density', yTicks: [],
  });
  const specs = [
    { s: a.stats, color: token('--c-data', '#3B5B80'), dash: [], label: 'trapezoid' },
    { s: b.stats, color: token('--c-naive', '#A6524B'), dash: DASH.naive, label: 'Gaussian' },
  ];
  for (const sp of specs) {
    const d = sp.s.density;
    const pts = [];
    for (let i = 0; i < d.density.length; i++) pts.push([f.x(d.x[i]), f.y(d.density[i])]);
    polyline(ctx, pts, { color: sp.color, width: 2, dash: sp.dash });
  }
  inPlotLabel(ctx, 'trapezoid', f.x(xLo + (xHi - xLo) * 0.18), f.y(yMax * 0.55), specs[0].color);
  inPlotLabel(ctx, 'Gaussian', f.x(xLo + (xHi - xLo) * 0.78), f.y(yMax * 0.35), specs[1].color);

  const pa = a.stats.percentile, pb = b.stats.percentile;
  const wa = pa.upper - pa.lower, wb = pb.upper - pb.lower;
  const diffPct = 100 * Math.abs(wa - wb) / ((wa + wb) / 2);
  $('#cap-compare').innerHTML = 'Both displacement distributions have mean '
    + trapDist.mean.toFixed(2) + ' m and standard deviation ' + trapDist.sd.toFixed(3)
    + ' m, and both are divided by the same age of 4.00 ± 0.30 ka. '
    + 'The medians agree to ' + Math.abs(pa.median - pb.median).toFixed(3)
    + ' mm/yr and the 68 per cent intervals differ in width by '
    + diffPct.toFixed(1) + ' per cent.';
  describeCanvas(canvas, 'Two rate distributions from displacement shapes matched on mean and '
    + 'standard deviation. Trapezoid median ' + pa.median.toFixed(2)
    + ', Gaussian median ' + pb.median.toFixed(2) + '.');

  fillTable($('#compare-table'),
    ['Displacement shape', 'Median (mm/yr)', '68% interval', 'Width', '95% upper'],
    [
      ['Trapezoid(9, 11, 13, 15)', pa.median.toFixed(3),
        pa.lower.toFixed(3) + ' to ' + pa.upper.toFixed(3),
        (pa.upper - pa.lower).toFixed(3), quant(a, 0.975)],
      ['Gaussian, matched moments', pb.median.toFixed(3),
        pb.lower.toFixed(3) + ' to ' + pb.upper.toFixed(3),
        (pb.upper - pb.lower).toFixed(3), quant(b, 0.975)],
    ]);
}

function quant(res, p) {
  const s = Float64Array.from(res.rates);
  s.sort();
  return s[Math.floor(p * (s.length - 1))].toFixed(3);
}

const rerender = debounce(render, 50);
typeSel.addEventListener('change', () => { syncControls(true); render(); });
for (const s of sliders) s.input.addEventListener('input', rerender);
$('#show-draws').addEventListener('change', render);
window.addEventListener('resize', debounce(() => { render(); renderComparison(); }, 250));

syncControls(true);
render();
renderComparison();

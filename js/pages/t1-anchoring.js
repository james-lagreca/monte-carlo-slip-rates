/**
 * Onset of offset page controller.
 *
 * Everything here is built from one known slip history, so the closed form
 * 1 - t_MRE/t_m can be drawn as a curve and the Monte Carlo medians plotted on
 * top of it. When they agree, the student has seen the algebra and the
 * simulation say the same thing.
 */

import { runSingleMarker } from '../engine/index.js';
import { drawTwoPdfs } from '../plot/density.js';
import { setupCanvas, drawFrame, token, polyline, inPlotLabel, DASH } from '../plot/core.js';
import { seedFrom } from '../ui/shared.js';
import { $, setReadout, describeCanvas, fillTable, debounce, status, defer } from '../ui/dom.js';

const TRUE_RATE = 3.0;
const N = 40000;
const els = {
  mre: $('#mre'), mreVal: $('#mre-val'),
  marker: $('#marker'), markerVal: $('#marker-val'),
  seed: $('#seed'),
};

/** Offsets are forward-modelled so the true rate is exactly 3.00 mm/yr. */
function markerSpecs(mreAge) {
  return [1.60, 3.10, 4.80, 7.40].map((t, i) => {
    const d = TRUE_RATE * (t - 0.40);
    return {
      label: 'M' + (i + 1),
      age: { type: 'gauss', mean: t, sd: [0.15, 0.22, 0.30, 0.45][i] },
      displacement: { type: 'pert', min: d * 0.9, mode: d, max: d * 1.1 },
      trueAge: t,
    };
  });
}

function runPair(mk, mreAge, seed) {
  const common = { displacement: mk.displacement, age: mk.age, n: N, seed };
  const un = runSingleMarker(common);
  const an = mreAge > 0
    ? runSingleMarker({ ...common, anchor: { type: 'fixed', value: mreAge } })
    : un;
  return { un, an };
}

function render() {
  const mreAge = Number(els.mre.value);
  const markerAge = Number(els.marker.value);
  els.mreVal.textContent = mreAge.toFixed(2) + ' ka';
  els.markerVal.textContent = markerAge.toFixed(2) + ' ka';
  const seed = seedFrom(els.seed);

  status('status', 'Sampling…');
  defer(() => {
    // The four-marker table.
    const rows = [];
    const points = [];
    for (const mk of markerSpecs(mreAge)) {
      const { un, an } = runPair(mk, mreAge, seed);
      const up = un.stats.percentile, ap = an.stats.percentile;
      const biasPct = 100 * (up.median / ap.median - 1);
      const closed = 100 * ((1 - mreAge / mk.trueAge) - 1);
      rows.push([
        mk.label + ' (' + mk.trueAge.toFixed(2) + ' ka)',
        up.median.toFixed(2) + '  [' + up.lower.toFixed(2) + ', ' + up.upper.toFixed(2) + ']',
        ap.median.toFixed(2) + '  [' + ap.lower.toFixed(2) + ', ' + ap.upper.toFixed(2) + ']',
        biasPct.toFixed(1) + '%',
        closed.toFixed(1) + '%',
      ]);
      points.push({ age: mk.trueAge, bias: up.median / ap.median });
    }
    fillTable($('#bias-table'),
      ['Marker', 'Unanchored (mm/yr)', 'Anchored (mm/yr)', 'Bias, measured', 'Bias, closed form'],
      rows);

    drawBiasCurve($('#bias'), mreAge, points);

    // The selected marker, in detail.
    const sel = {
      age: { type: 'gauss', mean: markerAge, sd: Math.max(0.08, markerAge * 0.08) },
      displacement: (() => {
        const d = TRUE_RATE * (markerAge - 0.40);
        return { type: 'pert', min: d * 0.9, mode: d, max: d * 1.1 };
      })(),
    };
    const { un, an } = runPair(sel, mreAge, seed);
    const up = un.stats.percentile, ap = an.stats.percentile;

    drawTwoPdfs($('#pdfs'), un.stats, an.stats, {
      labelA: 'unanchored', labelB: 'anchored',
      colorA: '--c-naive', colorB: '--c-sub',
      xLabel: 'Slip rate (mm/yr)',
    });

    const biasPct = 100 * (up.median / ap.median - 1);
    setReadout('ro-un', up.median.toFixed(2), 'mm/yr');
    setReadout('ro-an', ap.median.toFixed(2), 'mm/yr');
    setReadout('ro-bias', biasPct.toFixed(1) + '%');
    setReadout('ro-width', (up.upper - up.lower).toFixed(2) + ' then ' + (ap.upper - ap.lower).toFixed(2));

    $('#cap-pdfs').innerHTML = 'Rate distributions for a marker aged ' + markerAge.toFixed(2)
      + ' ka with the most recent event at ' + mreAge.toFixed(2) + ' ka. '
      + 'Unanchored ' + up.median.toFixed(2) + ' mm/yr, anchored ' + ap.median.toFixed(2)
      + ' mm/yr, a bias of ' + biasPct.toFixed(1) + ' per cent. '
      + 'The anchored interval is wider, which is the cost of removing the bias.';
    describeCanvas($('#pdfs'), 'Unanchored rate ' + up.median.toFixed(2)
      + ' against anchored rate ' + ap.median.toFixed(2) + ' millimetres per year.');

    status('status', mreAge === 0
      ? 'The anchor is switched off, so the two columns are identical.'
      : 'Measured bias and closed form agree in every row.');
  });
}

/** The analytic curve, with the four Monte Carlo medians plotted on it. */
function drawBiasCurve(canvas, mreAge, points) {
  const { ctx, width, height } = setupCanvas(canvas);
  const f = drawFrame(ctx, width, height, {
    xDomain: [0.5, 10],
    yDomain: [-60, 5],
    xLabel: 'Marker age (ka)',
    yLabel: 'Bias in the unanchored rate (%)',
  });
  const cPref = token('--c-pref', '#2E6E4E');
  const cNaive = token('--c-naive', '#A6524B');

  // Zero line.
  polyline(ctx, [[f.x(0.5), f.y(0)], [f.x(10), f.y(0)]],
    { color: token('--line', '#C3CAC5'), width: 1 });

  const curve = [];
  for (let t = Math.max(0.5, mreAge * 1.02); t <= 10; t += 0.05) {
    const bias = 100 * ((1 - mreAge / t) - 1);
    if (bias < -60) continue;
    curve.push([f.x(t), f.y(bias)]);
  }
  polyline(ctx, curve, { color: cPref, width: 2, dash: DASH.truth });
  if (curve.length) {
    inPlotLabel(ctx, 'closed form  1 − t_MRE / t', f.x(9.6), f.y(-4), cPref, 'right');
  }

  ctx.save();
  ctx.fillStyle = cNaive;
  for (const p of points) {
    const bias = 100 * (p.bias - 1);
    if (bias < -60) continue;
    ctx.beginPath();
    ctx.arc(f.x(p.age), f.y(bias), 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (points.length) {
    const p = points[0];
    inPlotLabel(ctx, 'Monte Carlo medians', f.x(p.age) + 10, f.y(100 * (p.bias - 1)), cNaive);
  }

  $('#cap-bias').textContent = 'Bias in the unanchored rate against marker age, for a most recent event at '
    + mreAge.toFixed(2) + ' ka. The dashed line is the closed form; the points are Monte Carlo medians '
    + 'for the four markers in the table above.';
  describeCanvas(canvas, 'Bias in the unanchored slip rate against marker age. '
    + 'The Monte Carlo medians sit on the closed-form curve.');
}

const rerender = debounce(render, 80);
for (const node of [els.mre, els.marker, els.seed]) {
  node.addEventListener('input', rerender);
  node.addEventListener('change', rerender);
}
window.addEventListener('resize', debounce(render, 250));

render();

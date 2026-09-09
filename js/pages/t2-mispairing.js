/**
 * Mispairing page controller.
 *
 * The slider moves one marker's dated age. Everything else is held fixed, so
 * the acceptance rate and the exploding interval are attributable to that one
 * change and nothing else.
 */

import { runIncremental, medianPath, normalCdf, quantiles } from '../engine/index.js';
import { drawPathFan } from '../plot/pathFan.js';
import { setupCanvas, drawFrame, token, polyline, inPlotLabel, DASH, logScale } from '../plot/core.js';
import { loadPreset, seedFrom } from '../ui/shared.js';
import { $, setReadout, describeCanvas, fillTable, debounce, status, defer, formatBig } from '../ui/dom.js';

const N_STEPS = [1000, 5000, 10000];
const TRUE_RATE = 3.0;
const M2_AGE = 3.30, M2_SD = 0.30, M3_SD = 0.30;

const els = {
  age3: $('#age3'), age3Val: $('#age3-val'),
  n: $('#n'), nVal: $('#n-val'),
  seed: $('#seed'),
  showTruth: $('#show-truth'),
};

let base = null;
let fanHandle = null;

function markersFor(age3) {
  const m = JSON.parse(JSON.stringify(base.markers));
  m[2].age.mean = age3;
  return m;
}

function render() {
  if (!base) return;
  const age3 = Number(els.age3.value);
  const n = N_STEPS[Number(els.n.value)];
  els.age3Val.textContent = age3.toFixed(2) + ' ka';
  els.nVal.textContent = n.toLocaleString('en-GB');
  const seed = seedFrom(els.seed);

  status('status', 'Sampling…');
  defer(() => {
    const res = runIncremental({
      markers: markersFor(age3), anchor: null, n, seed,
    });

    const acc = 100 * res.acceptance;
    const predicted = 100 * normalCdf((age3 - M2_AGE) / Math.sqrt(M2_SD * M2_SD + M3_SD * M3_SD));

    setReadout('ro-accept', acc.toFixed(acc < 10 ? 2 : 1) + '%');
    setReadout('ro-predicted', predicted.toFixed(predicted < 10 ? 2 : 1) + '%');

    const bad = res.intervals[1];
    if (bad && bad.stats) {
      const p = bad.stats.percentile;
      setReadout('ro-bad', formatBig(p.median, 1), 'mm/yr');
    } else {
      setReadout('ro-bad', '-');
    }
    setReadout('ro-best', res.bestFitStats
      ? res.bestFitStats.percentile.median.toFixed(2) : '-', 'mm/yr');

    if (fanHandle) fanHandle.cancel();
    fanHandle = drawPathFan($('#fan'), res, {
      maxPaths: 3000,
      medianPath: res.accepted > 0 ? medianPath(res) : null,
      truthRate: els.showTruth.checked ? TRUE_RATE : null,
      truthOnset: 0,
      tMax: 9,
    });

    $('#cap-fan').innerHTML = 'Accepted paths with M3 dated at <b>' + age3.toFixed(2) + ' ka</b>. '
      + 'Acceptance ' + acc.toFixed(acc < 10 ? 2 : 1) + ' per cent'
      + (age3 < M2_AGE
        ? ', because monotonicity can only accept draws in which the M2 and M3 ages swap back.'
        : '.')
      + (els.showTruth.checked ? ' The dashed green line is the true 3.00 mm/yr history.' : '');
    describeCanvas($('#fan'), 'Path fan with M3 dated at ' + age3.toFixed(2)
      + ' ka. Acceptance rate ' + acc.toFixed(1) + ' per cent.');

    // The interval PDF, on a log axis.
    if (bad && bad.stats) drawLogPdf($('#badpdf'), bad, age3);

    const rows = res.intervals.filter((iv) => iv.stats).map((iv) => {
      const p = iv.stats.percentile;
      return [
        iv.label,
        formatBig(p.median, 2),
        formatBig(p.lower, 2) + ' to ' + formatBig(p.upper, 2),
        formatBig(quantiles(iv.rates, [0.975])[0], 1),
        formatBig(iv.stats.tailMax, 0),
      ];
    });
    fillTable($('#interval-table'),
      ['Interval', 'Median (mm/yr)', '68% interval', '97.5th percentile', 'Largest sampled'], rows);

    status('status', Math.abs(acc - predicted) < 1.5
      ? 'Observed acceptance ' + acc.toFixed(2) + ' per cent against a closed-form prediction of '
        + predicted.toFixed(2) + ' per cent.'
      : 'Observed acceptance ' + acc.toFixed(2) + ' per cent. Other pairs are contributing rejections too, '
        + 'so the single-pair closed form is only an upper bound here.');
  });
}

/** The exploding interval needs a log axis. A linear one hides everything. */
function drawLogPdf(canvas, interval, age3) {
  const { ctx, width, height } = setupCanvas(canvas);
  const rates = interval.rates;
  const q = quantiles(rates, [0.005, 0.16, 0.5, 0.84, 0.995]);
  const lo = Math.max(0.05, q[0] * 0.6);
  const hi = Math.max(q[4] * 1.6, lo * 20);

  // Histogram in log space.
  const bins = 90;
  const l0 = Math.log10(lo), l1 = Math.log10(hi);
  const counts = new Float64Array(bins);
  let kept = 0;
  for (let i = 0; i < rates.length; i++) {
    const v = rates[i];
    if (!(v > 0) || v < lo || v > hi) continue;
    let k = Math.floor((Math.log10(v) - l0) / (l1 - l0) * bins);
    if (k === bins) k = bins - 1;
    counts[k]++; kept++;
  }
  let peak = 0;
  for (let i = 0; i < bins; i++) if (counts[i] > peak) peak = counts[i];
  if (!(peak > 0)) peak = 1;

  const f = drawFrame(ctx, width, height, {
    xDomain: [lo, hi],
    xLog: true,
    yDomain: [0, 1.15],
    yTicks: [],
    xLabel: 'Interval slip rate (mm/yr), log scale',
    yLabel: 'Relative frequency',
  });

  const cBad = token('--c-behead', '#A32732');
  ctx.save();
  ctx.fillStyle = cBad;
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < bins; i++) {
    if (!counts[i]) continue;
    const a = Math.pow(10, l0 + (i / bins) * (l1 - l0));
    const b = Math.pow(10, l0 + ((i + 1) / bins) * (l1 - l0));
    const x0 = f.x(a), x1 = f.x(b);
    const y = f.y(counts[i] / peak);
    ctx.fillRect(x0, y, Math.max(1, x1 - x0), f.y(0) - y);
  }
  ctx.restore();

  const med = q[2];
  polyline(ctx, [[f.x(med), f.y(0)], [f.x(med), f.y(1.05)]], { color: cBad, width: 1.8 });
  inPlotLabel(ctx, 'median ' + formatBig(med, 1), f.x(med) + 6, f.y(1.08), cBad);

  const cPref = token('--c-pref', '#2E6E4E');
  if (TRUE_RATE >= lo && TRUE_RATE <= hi) {
    polyline(ctx, [[f.x(TRUE_RATE), f.y(0)], [f.x(TRUE_RATE), f.y(1.05)]],
      { color: cPref, width: 1.8, dash: DASH.truth });
    inPlotLabel(ctx, 'true 3.00', f.x(TRUE_RATE) - 6, f.y(1.08), cPref, 'right');
  }

  $('#cap-badpdf').innerHTML = 'Rate for the <b>' + interval.label + '</b> interval with M3 dated at '
    + age3.toFixed(2) + ' ka, on a logarithmic axis. Median ' + formatBig(med, 1)
    + ' mm/yr against a true rate of 3.00. The 97.5th percentile is '
    + formatBig(quantiles(rates, [0.975])[0], 1) + ' mm/yr.';
  describeCanvas(canvas, 'Interval rate distribution on a log axis. Median '
    + formatBig(med, 1) + ' millimetres per year against a true rate of 3.');
}

/** Sweep the slider range once, so the cliff is visible as a curve. */
function drawAcceptanceCurve() {
  const canvas = $('#curve');
  const { ctx, width, height } = setupCanvas(canvas);
  const f = drawFrame(ctx, width, height, {
    xDomain: [2.5, 5.5],
    yDomain: [0, 105],
    xLabel: 'Dated age of M3 (ka)',
    yLabel: 'Acceptance rate (%)',
  });

  const cData = token('--c-data', '#3B5B80');
  const cPref = token('--c-pref', '#2E6E4E');

  const measured = [];
  for (let a = 2.5; a <= 5.5001; a += 0.125) {
    const r = runIncremental({ markers: markersFor(a), anchor: null, n: 600, seed: 'curve' });
    measured.push([f.x(a), f.y(100 * r.acceptance)]);
  }
  const predicted = [];
  for (let a = 2.5; a <= 5.5001; a += 0.05) {
    const p = 100 * normalCdf((a - M2_AGE) / Math.sqrt(M2_SD * M2_SD + M3_SD * M3_SD));
    predicted.push([f.x(a), f.y(p)]);
  }

  polyline(ctx, predicted, { color: cPref, width: 1.8, dash: DASH.truth });
  polyline(ctx, measured, { color: cData, width: 2 });
  inPlotLabel(ctx, 'closed form for the M2/M3 pair', f.x(5.45), f.y(88), cPref, 'right');
  inPlotLabel(ctx, 'measured', f.x(3.0), f.y(38), cData);

  polyline(ctx, [[f.x(M2_AGE), f.y(0)], [f.x(M2_AGE), f.y(100)]],
    { color: token('--line', '#C3CAC5'), width: 1 });
  inPlotLabel(ctx, 'M2 dated 3.30', f.x(M2_AGE) + 5, f.y(12), token('--ink-soft', '#54636D'));

  $('#cap-curve').textContent = 'Acceptance rate against the dated age of M3, holding everything else fixed. '
    + 'The measured curve tracks the closed-form prediction for the M2 and M3 age pair until other pairs '
    + 'start contributing rejections at the right-hand end.';
  describeCanvas(canvas, 'Acceptance rate against the dated age of M3, rising from single digits to '
    + 'near 100 per cent as the mispairing is removed.');
}

const rerender = debounce(render, 90);
for (const node of [els.age3, els.n, els.seed, els.showTruth]) {
  node.addEventListener('input', rerender);
  node.addEventListener('change', rerender);
}
window.addEventListener('resize', debounce(() => { render(); drawAcceptanceCurve(); }, 260));

(async function init() {
  base = await loadPreset('multi-mispaired');
  render();
  defer(drawAcceptanceCurve);
})();

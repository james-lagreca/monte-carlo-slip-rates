/**
 * Landing page: one slider on the age uncertainty, so the reader sees a
 * symmetric rate distribution turn skewed before reading a word about why.
 */

import { runSingleMarker, naivePropagation } from '../engine/index.js';
import { drawRatePdf } from '../plot/density.js';
import { $, setReadout, describeCanvas, fillTable, debounce, status } from '../ui/dom.js';

const DISPLACEMENT = { type: 'pert', min: 10.5, mode: 12.0, max: 13.5 };
const canvas = $('#teaser');
const sigmaInput = $('#sigma');
const sigmaVal = $('#sigma-val');

function render() {
  const sd = Number(sigmaInput.value);
  sigmaVal.textContent = sd.toFixed(2) + ' ka';

  const age = { type: 'gauss', mean: 4.0, sd };
  const res = runSingleMarker({
    displacement: DISPLACEMENT, age, n: 60000, seed: 'teaching',
  });
  const naive = naivePropagation({ displacement: DISPLACEMENT, age });
  const p = res.stats.percentile;

  drawRatePdf(canvas, res.stats, {
    naive,
    truth: 3.0,
    xMin: 1.4,
    xMax: 6.4,
    xLabel: 'Slip rate (mm/yr)',
  });

  setReadout('ro-median', p.median.toFixed(2), 'mm/yr');
  setReadout('ro-ci', p.lower.toFixed(2) + ' to ' + p.upper.toFixed(2));
  setReadout('ro-naive', naive.lower.toFixed(2) + ' to ' + naive.upper.toFixed(2));
  setReadout('ro-asym', p.asymmetry.toFixed(2));

  describeCanvas(canvas,
    'Slip rate distribution. Median ' + p.median.toFixed(2)
    + ', 68 per cent interval ' + p.lower.toFixed(2) + ' to ' + p.upper.toFixed(2)
    + ' millimetres per year, for an age uncertainty of ' + sd.toFixed(2) + ' ka.');

  $('#teaser-cap').innerHTML = 'Rate distribution for a displacement of PERT(10.5, 12.0, 13.5) m over an age of 4.00 ± '
    + sd.toFixed(2) + ' ka. The dashed green line is the true rate of 3.00 mm/yr. '
    + 'The red-brown bar is what first-order error propagation would report.';

  fillTable($('#teaser-table'),
    ['Quantity', 'Value'],
    [
      ['Age uncertainty (1 sigma, ka)', sd.toFixed(2)],
      ['Median rate (mm/yr)', p.median.toFixed(3)],
      ['68% lower', p.lower.toFixed(3)],
      ['68% upper', p.upper.toFixed(3)],
      ['Minus error', p.minusError.toFixed(3)],
      ['Plus error', p.plusError.toFixed(3)],
      ['Asymmetry (plus over minus)', p.asymmetry.toFixed(3)],
      ['Mean rate (mm/yr)', res.stats.mean.toFixed(3)],
      ['Naive estimate (mm/yr)', naive.rate.toFixed(3) + ' ± ' + naive.sigma.toFixed(3)],
    ]);

  status('status', p.asymmetry > 1.2
    ? 'The interval is now clearly asymmetric. A single ± cannot describe it.'
    : 'The interval is close to symmetric, so ± is still a fair summary.');
}

const rerender = debounce(render, 80);
sigmaInput.addEventListener('input', rerender);
window.addEventListener('resize', debounce(render, 200));
render();

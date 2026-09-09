/**
 * Method 1 page controller.
 */

import { runSingleMarker, naivePropagation, quantiles } from '../engine/index.js';
import { drawRatePdf, drawInputPdf } from '../plot/density.js';
import { fillPresetSelect, loadPreset, renderProvenance, mountSource, seedFrom } from '../ui/shared.js';
import { $, el, setReadout, describeCanvas, fillTable, debounce, status, formatRate } from '../ui/dom.js';

mountSource($('#src-m1'), './js/engine/slipRate.js', 'method1');

const N_STEPS = [1000, 10000, 50000, 200000];
const els = {
  preset: $('#preset'),
  n: $('#n'),
  nVal: $('#n-val'),
  seed: $('#seed'),
  showNaive: $('#show-naive'),
  showTruth: $('#show-truth'),
};

async function render() {
  const id = els.preset.value;
  if (!id) return;
  const preset = await loadPreset(id);

  renderProvenance($('#provenance'), preset);

  const n = N_STEPS[Number(els.n.value)];
  els.nVal.textContent = n.toLocaleString('en-GB');
  status('status', 'Drawing ' + n.toLocaleString('en-GB') + ' realisations…');

  const res = runSingleMarker({
    displacement: preset.displacement,
    age: preset.age,
    anchor: preset.anchor,
    n,
    seed: seedFrom(els.seed),
  });
  const naive = naivePropagation({
    displacement: preset.displacement, age: preset.age, anchor: preset.anchor,
  });
  const p = res.stats.percentile;
  const q95 = quantiles(res.rates, [0.025, 0.975]);
  const truth = preset.truth ? preset.truth.slipRate : null;

  // Input PDFs.
  drawInputPdf($('#pdf-d'), res.distributions.displacement, {
    color: '--c-data', label: res.distributions.displacement.label, xLabel: 'Displacement (m)',
  });
  drawInputPdf($('#pdf-t'), res.distributions.age, {
    color: '--c-sub', label: res.distributions.age.label, xLabel: 'Age (ka)',
  });
  $('#cap-d').textContent = 'Displacement: ' + res.distributions.displacement.label
    + ', mean ' + res.distributions.displacement.mean.toFixed(2) + ' m.';
  $('#cap-t').textContent = 'Age: ' + res.distributions.age.label
    + ', mean ' + res.distributions.age.mean.toFixed(2) + ' ka.';
  describeCanvas($('#pdf-d'), 'Displacement distribution, '
    + res.distributions.displacement.label + ', mean '
    + res.distributions.displacement.mean.toFixed(2) + ' metres, standard deviation '
    + res.distributions.displacement.sd.toFixed(2) + '.');
  describeCanvas($('#pdf-t'), 'Age distribution, '
    + res.distributions.age.label + ', mean '
    + res.distributions.age.mean.toFixed(2) + ' ka, standard deviation '
    + res.distributions.age.sd.toFixed(2) + '.');

  // Rate PDF.
  drawRatePdf($('#rate'), res.stats, {
    naive: els.showNaive.checked ? naive : null,
    truth: els.showTruth.checked ? truth : null,
    xLabel: 'Slip rate (mm/yr)',
  });

  setReadout('ro-median', p.median.toFixed(2), 'mm/yr');
  setReadout('ro-ci68', p.lower.toFixed(2) + ' to ' + p.upper.toFixed(2));
  setReadout('ro-ci95', q95[0].toFixed(2) + ' to ' + q95[1].toFixed(2));
  setReadout('ro-report', formatRate(res.stats));
  setReadout('ro-naive', naive.lower.toFixed(2) + ' to ' + naive.upper.toFixed(2));
  setReadout('ro-asym', p.asymmetry.toFixed(2));

  describeCanvas($('#rate'),
    'Slip rate distribution for ' + preset.title + '. Median ' + p.median.toFixed(2)
    + ' millimetres per year, 68 per cent interval ' + p.lower.toFixed(2)
    + ' to ' + p.upper.toFixed(2) + '.');

  $('#cap-rate').innerHTML = 'Slip rate for <b>' + preset.title + '</b>. '
    + 'Median ' + p.median.toFixed(2) + ' mm/yr, shaded band the 68.27 per cent interval.'
    + (els.showNaive.checked ? ' The red-brown bar is first-order error propagation.' : '')
    + (truth != null && els.showTruth.checked ? ' The dashed green line is the true rate of ' + truth.toFixed(2) + ' mm/yr.' : '');

  // Warnings from the distributions, e.g. a Gaussian age reaching zero.
  const warn = $('#warnings');
  warn.innerHTML = '';
  for (const w of res.warnings) {
    warn.appendChild(el('div', { class: 'callout warn' }, [
      el('span', { class: 'tag', text: 'Check this input' }),
      el('p', { text: w }),
    ]));
  }
  if (res.discarded > 0) {
    warn.appendChild(el('div', { class: 'callout warn' }, [
      el('span', { class: 'tag', text: 'Discarded realisations' }),
      el('p', {
        text: res.discarded.toLocaleString('en-GB') + ' of ' + res.attempted.toLocaleString('en-GB')
          + ' realisations produced a duration at or below zero and were discarded. '
          + 'That is the age distribution reaching back past the anchor, and it biases what survives.',
      }),
    ]));
  }

  fillTable($('#rate-table'), ['Quantity', 'Value'], [
    ['Realisations kept', res.kept.toLocaleString('en-GB')],
    ['Median (mm/yr)', p.median.toFixed(3)],
    ['68% lower', p.lower.toFixed(3)],
    ['68% upper', p.upper.toFixed(3)],
    ['95% lower', q95[0].toFixed(3)],
    ['95% upper', q95[1].toFixed(3)],
    ['Mean (mm/yr)', res.stats.mean.toFixed(3)],
    ['Asymmetry', p.asymmetry.toFixed(3)],
    ['HPD lower', res.stats.hpd.lower.toFixed(3)],
    ['HPD upper', res.stats.hpd.upper.toFixed(3)],
    ['HPD clusters', String(res.stats.hpd.clusters.length)],
    ['Naive rate (mm/yr)', naive.rate.toFixed(3)],
    ['Naive sigma', naive.sigma.toFixed(3)],
  ]);

  // The comparison that is the point of the page.
  const shortfall = p.upper - naive.upper;
  const parts = [];
  parts.push('Monte Carlo gives ' + formatRate(res.stats) + ' mm/yr. '
    + 'First-order propagation gives ' + naive.rate.toFixed(2) + ' ± ' + naive.sigma.toFixed(2)
    + ', that is ' + naive.lower.toFixed(2) + ' to ' + naive.upper.toFixed(2) + '.');
  if (Math.abs(shortfall) < 0.05) {
    parts.push('The two agree to within 0.05 mm/yr. With an age this good, propagation is fine and Monte Carlo is telling you so.');
  } else {
    parts.push('The naive upper bound is ' + Math.abs(shortfall).toFixed(2) + ' mm/yr '
      + (shortfall > 0 ? 'too low' : 'too high') + '. '
      + 'It is also symmetric when the true interval is −' + p.minusError.toFixed(2)
      + ' / +' + p.plusError.toFixed(2) + '. Reporting it would understate how fast this fault could be slipping.');
  }
  if (res.stats.hpd.clusters.length > 1) {
    parts.push('This rate distribution has ' + res.stats.hpd.clusters.length
      + ' separate high-density regions. A single interval of any kind hides that.');
  }
  $('#compare-text').textContent = parts.join(' ');

  status('status', 'Done. ' + res.kept.toLocaleString('en-GB') + ' realisations kept.');
}

const rerender = debounce(render, 60);
for (const node of [els.preset, els.n, els.seed, els.showNaive, els.showTruth]) {
  node.addEventListener('input', rerender);
  node.addEventListener('change', rerender);
}
window.addEventListener('resize', debounce(render, 220));

(async function init() {
  await fillPresetSelect(els.preset, 'single', 'single-well-behaved');
  await render();
})();

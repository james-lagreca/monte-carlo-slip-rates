/**
 * Reporting page controller.
 *
 * The point of the page is a single observation the reader has to make for
 * themselves: dragging the binning sliders moves the HPD bounds and leaves the
 * percentile bounds alone. Everything else here is in service of that.
 */

import { runSingleMarker, summarise } from '../engine/index.js';
import { drawRatePdf } from '../plot/density.js';
import { fillPresetSelect, loadPreset } from '../ui/shared.js';
import { $, $$, el, setReadout, describeCanvas, fillTable, debounce, status, defer } from '../ui/dom.js';

const CONFIDENCES = [68.27, 90, 95, 99];
const els = {
  preset: $('#preset'),
  conf: $('#conf'), confVal: $('#conf-val'),
  bins: $('#bins'), binsVal: $('#bins-val'),
  bw: $('#bw'), bwVal: $('#bw-val'),
};

let rates = null;
let currentPreset = null;

/** Draw the samples once per preset, so the sliders only change the summary. */
async function resample() {
  const id = els.preset.value;
  if (!id) return;
  currentPreset = await loadPreset(id);
  const res = runSingleMarker({
    displacement: currentPreset.displacement,
    age: currentPreset.age,
    anchor: currentPreset.anchor,
    n: 200000,
    seed: 'teaching',
  });
  rates = res.rates;
}

function render() {
  if (!rates) return;
  const confidence = CONFIDENCES[Number(els.conf.value)];
  const bins = Number(els.bins.value);
  const bandwidthScale = Number(els.bw.value);

  els.confVal.textContent = confidence + '%';
  els.binsVal.textContent = String(bins);
  els.bwVal.textContent = bandwidthScale.toFixed(2) + '×';

  const stats = summarise(rates, { confidence, bins, bandwidthScale });
  const method = ($$('input[name=method]').find((r) => r.checked) || {}).value || 'percentile';

  drawRatePdf($('#pdf'), stats, {
    method,
    truth: currentPreset.truth ? currentPreset.truth.slipRate : null,
    xLabel: 'Slip rate (mm/yr)',
  });

  const p = stats.percentile, h = stats.hpd;
  const wP = p.upper - p.lower;
  const wH = h.upper - h.lower;
  const narrower = 100 * (1 - wH / wP);

  setReadout('ro-pct', p.lower.toFixed(2) + ' to ' + p.upper.toFixed(2));
  setReadout('ro-hpd', h.lower.toFixed(2) + ' to ' + h.upper.toFixed(2));
  setReadout('ro-width', (narrower >= 0 ? narrower.toFixed(1) : '(wider)') + (narrower >= 0 ? '%' : ''));
  setReadout('ro-mean', (stats.mean - stats.sd).toFixed(2) + ' to ' + (stats.mean + stats.sd).toFixed(2));

  $('#cap-pdf').innerHTML = 'Rate distribution for <b>' + currentPreset.title + '</b> at '
    + confidence + ' per cent confidence, with ' + bins + ' bins and a smoothing factor of '
    + bandwidthScale.toFixed(2) + '. '
    + (h.multimodal
      ? 'The HPD interval is reported as ' + h.clusters.length + ' separate clusters.'
      : 'Shaded band is the selected interval.');

  describeCanvas($('#pdf'), 'Rate distribution. Percentile interval ' + p.lower.toFixed(2)
    + ' to ' + p.upper.toFixed(2) + ', highest posterior density interval '
    + h.lower.toFixed(2) + ' to ' + h.upper.toFixed(2) + ' millimetres per year.');

  const rows = [
    ['Median', p.median.toFixed(3), '-', '-'],
    ['Mean', stats.mean.toFixed(3), '-', '-'],
    ['Percentile interval', p.lower.toFixed(3) + ' to ' + p.upper.toFixed(3), wP.toFixed(3), 'no tuning'],
    ['HPD interval', h.lower.toFixed(3) + ' to ' + h.upper.toFixed(3), wH.toFixed(3),
      'depends on bins and smoothing'],
    ['Mean ± sd', (stats.mean - stats.sd).toFixed(3) + ' to ' + (stats.mean + stats.sd).toFixed(3),
      (2 * stats.sd).toFixed(3), 'symmetric, so wrong here'],
  ];
  h.clusters.forEach((c, i) => {
    rows.push(['HPD cluster ' + (i + 1), c.lower.toFixed(3) + ' to ' + c.upper.toFixed(3),
      (c.upper - c.lower).toFixed(3), (100 * c.mass).toFixed(1) + '% of probability']);
  });
  fillTable($('#table'), ['Summary', 'Value or interval', 'Width', 'Note'], rows);

  const note = $('#cluster-note');
  note.innerHTML = '';
  if (h.multimodal) {
    note.appendChild(el('div', { class: 'callout warn' }, [
      el('span', { class: 'tag', text: 'This distribution is multimodal' }),
      el('p', {
        text: 'The HPD method has found ' + h.clusters.length + ' separate clusters: '
          + h.clusters.map((c) => c.lower.toFixed(2) + ' to ' + c.upper.toFixed(2)).join(', and ')
          + ' mm/yr. The percentile interval of ' + p.lower.toFixed(2) + ' to ' + p.upper.toFixed(2)
          + ' spans the gap between them and so asserts that the middle is plausible.',
      }),
    ]));
  }

  status('status', 'Percentile width ' + wP.toFixed(3) + ', HPD width ' + wH.toFixed(3)
    + '. Change the bins or smoothing and only the HPD figure moves.');
}

const rerender = debounce(render, 60);
for (const node of [els.conf, els.bins, els.bw]) node.addEventListener('input', rerender);
for (const r of $$('input[name=method]')) r.addEventListener('change', render);
els.preset.addEventListener('change', async () => { await resample(); render(); });
window.addEventListener('resize', debounce(render, 250));

(async function init() {
  await fillPresetSelect(els.preset, 'single', 'single-poorly-dated');
  defer(async () => { await resample(); render(); });
})();

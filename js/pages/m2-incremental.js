/**
 * Method 2 page controller.
 */

import { runIncremental, medianPath } from '../engine/index.js';
import { drawPathFan, drawRejectedPath } from '../plot/pathFan.js';
import { drawRatePdf } from '../plot/density.js';
import { fillPresetSelect, loadPreset, renderProvenance, mountSource, seedFrom } from '../ui/shared.js';
import { $, el, setReadout, describeCanvas, fillTable, debounce, status, formatBig, defer } from '../ui/dom.js';

mountSource($('#src-m2'), './js/engine/incremental.js', 'accept-reject');

const N_STEPS = [1000, 5000, 10000, 20000];
const CAPS = [null, 10, 20, 50, 100];

const els = {
  preset: $('#preset'),
  n: $('#n'), nVal: $('#n-val'),
  maxrate: $('#maxrate'), maxrateVal: $('#maxrate-val'),
  seed: $('#seed'),
  monotonic: $('#monotonic'),
  anchor: $('#anchor'),
  density: $('#density'),
};

let fanHandle = null;

async function render() {
  const id = els.preset.value;
  if (!id) return;
  const preset = await loadPreset(id);
  renderProvenance($('#provenance'), preset);

  const n = N_STEPS[Number(els.n.value)];
  const cap = CAPS[Number(els.maxrate.value)];
  els.nVal.textContent = n.toLocaleString('en-GB');
  els.maxrateVal.textContent = cap === null ? 'off' : cap + ' mm/yr';

  const useAnchor = els.anchor.checked && preset.anchor;
  status('status', 'Sampling…');

  defer(() => {
    const res = runIncremental({
      markers: preset.markers,
      anchor: useAnchor ? preset.anchor : null,
      n,
      seed: seedFrom(els.seed),
      enforceMonotonic: els.monotonic.checked,
      maxRate: cap,
    });

    if (fanHandle) fanHandle.cancel();
    fanHandle = drawPathFan($('#fan'), res, {
      mode: els.density.checked ? 'density' : 'alpha',
      maxPaths: 4000,
      medianPath: res.accepted > 0 ? medianPath(res) : null,
      truthRate: preset.truth ? preset.truth.slipRate : null,
      truthOnset: preset.truth && preset.truth.onset != null ? preset.truth.onset : 0,
    });

    const acc = 100 * res.acceptance;
    setReadout('ro-accept', acc.toFixed(acc < 10 ? 2 : 1) + '%');
    setReadout('ro-attempts', res.attempts.toLocaleString('en-GB'));
    if (res.bestFitStats) {
      const b = res.bestFitStats.percentile;
      setReadout('ro-bestfit', b.median.toFixed(2), 'mm/yr');
      setReadout('ro-bestci', b.lower.toFixed(2) + ' to ' + b.upper.toFixed(2));
    } else {
      setReadout('ro-bestfit', '-');
      setReadout('ro-bestci', '-');
    }

    // Acceptance gauge, coloured by what the number means.
    const gauge = $('#gauge');
    gauge.classList.remove('low', 'mid');
    if (acc < 10) gauge.classList.add('low');
    else if (acc < 50) gauge.classList.add('mid');
    $('#gauge-fill').style.width = Math.max(0.5, acc).toFixed(1) + '%';
    $('#gauge-cap').textContent = res.accepted.toLocaleString('en-GB') + ' paths accepted from '
      + res.attempts.toLocaleString('en-GB') + ' attempts. '
      + res.rejectedMonotonic.toLocaleString('en-GB') + ' failed monotonicity'
      + (res.rejectedMaxRate ? ', ' + res.rejectedMaxRate.toLocaleString('en-GB') + ' exceeded the rate cap' : '')
      + '.' + (res.exhausted ? ' Sampling hit its attempt limit before reaching the target.' : '');

    describeCanvas($('#fan'),
      'Path fan for ' + preset.title + '. ' + res.accepted.toLocaleString('en-GB')
      + ' accepted paths, acceptance rate ' + acc.toFixed(1) + ' per cent.');

    $('#cap-fan').innerHTML = 'Accepted displacement-age paths for <b>' + preset.title + '</b>. '
      + 'Acceptance ' + acc.toFixed(acc < 10 ? 2 : 1) + ' per cent.'
      + (els.monotonic.checked ? '' : ' <b>Monotonicity is off</b>, so these paths include histories in which the fault slipped backwards.')
      + (preset.truth ? ' The dashed green line is the true history of ' + preset.truth.slipRate.toFixed(2) + ' mm/yr.' : '');

    // The rejected realisation.
    drawRejectedPath($('#reject'), res);
    $('#cap-reject').textContent = res.firstRejection
      ? 'One rejected realisation. The ringed pair failed the test: ' + res.firstRejection.reason
        + '. The whole realisation is discarded, not just the offending marker.'
      : 'No realisation was rejected with these settings, so there is nothing to show here.';
    describeCanvas($('#reject'), res.firstRejection
      ? 'A rejected realisation, failing on ' + res.firstRejection.reason
      : 'No realisation was rejected.');

    // Interval small multiples.
    const box = $('#intervals');
    box.innerHTML = '';
    const rows = [];
    for (const iv of res.intervals) {
      if (!iv.stats) continue;
      const p = iv.stats.percentile;
      const wrap = el('div', { class: 'sm' });
      wrap.appendChild(el('h4', { text: iv.label }));
      const c = el('canvas', { width: 300, height: 150 });
      wrap.appendChild(c);
      wrap.appendChild(el('div', {
        class: 'val',
        text: p.median.toFixed(2) + '  [' + p.lower.toFixed(2) + ', ' + p.upper.toFixed(2) + ']',
        style: 'color:' + (p.median > 40 ? 'var(--c-behead)' : 'var(--ink)'),
      }));
      box.appendChild(wrap);
      drawRatePdf(c, iv.stats, {
        truth: preset.truth ? preset.truth.slipRate : null,
        xLabel: 'mm/yr',
      });
      describeCanvas(c, 'Rate distribution for interval ' + iv.label
        + '. Median ' + p.median.toFixed(2) + ' millimetres per year.');
      rows.push([
        iv.label, p.median.toFixed(2),
        p.lower.toFixed(2) + ' to ' + p.upper.toFixed(2),
        formatBig(iv.stats.tailMax),
      ]);
    }
    fillTable($('#interval-table'),
      ['Interval', 'Median (mm/yr)', '68% interval', 'Largest sampled'], rows);

    status('status', 'Done. ' + res.accepted.toLocaleString('en-GB') + ' paths from '
      + res.attempts.toLocaleString('en-GB') + ' attempts.');
  });
}

const rerender = debounce(render, 80);
for (const node of Object.values(els)) {
  if (!node || !node.addEventListener) continue;
  node.addEventListener('input', rerender);
  node.addEventListener('change', rerender);
}
window.addEventListener('resize', debounce(render, 250));

(async function init() {
  await fillPresetSelect(els.preset, 'multi', 'multi-well-behaved');
  await render();
})();

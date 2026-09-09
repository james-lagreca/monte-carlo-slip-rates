/**
 * Browser front end for the engine self-checks.
 *
 * It imports the same tools/checks.js that `node tools/verify.js` runs, so the
 * two cannot disagree about what passing means.
 */

import { runChecks, summariseChecks } from '../../tools/checks.js';
import { $, el, setReadout, status, defer } from '../ui/dom.js';

function fmt(v) {
  if (typeof v !== 'number') return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a < 1e-4 || a >= 1e6) return v.toExponential(3);
  return String(Number(v.toPrecision(8)));
}

function run(heavy) {
  status('status', 'Running…');
  setReadout('ro-pass', '-');
  setReadout('ro-fail', '-');
  setReadout('ro-time', '-');
  $('#results').innerHTML = '';

  defer(() => {
    const t0 = performance.now();
    let results;
    try {
      results = runChecks({ heavy });
    } catch (err) {
      status('status', 'A check threw before it could report: ' + err.message);
      return;
    }
    const elapsed = (performance.now() - t0) / 1000;
    const { total, passed, failed } = summariseChecks(results);

    setReadout('ro-pass', passed + ' / ' + total);
    setReadout('ro-fail', String(failed));
    setReadout('ro-time', elapsed.toFixed(1), 's');

    const box = $('#results');
    let group = null;
    let panel = null;
    let tbody = null;
    for (const r of results) {
      if (r.group !== group) {
        group = r.group;
        panel = el('div', { class: 'panel' });
        panel.appendChild(el('h2', { text: group }));
        const table = el('table', { class: 'checks-table' });
        table.appendChild(el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Check' }),
            el('th', { class: 'n', text: 'Expected' }),
            el('th', { class: 'n', text: 'Actual' }),
            el('th', { class: 'n', text: 'Result' }),
          ]),
        ]));
        tbody = el('tbody');
        table.appendChild(tbody);
        panel.appendChild(table);
        box.appendChild(panel);
      }
      const showNums = r.tolerance !== null && Number.isFinite(r.tolerance);
      tbody.appendChild(el('tr', {}, [
        el('td', { class: 'name', text: r.name }),
        el('td', { class: 'n', text: showNums ? fmt(r.expected) : '-' }),
        el('td', { class: 'n', text: showNums ? fmt(r.actual) : '-' }),
        el('td', { class: 'n ' + (r.pass ? 'ok' : 'fail'), text: r.pass ? 'pass' : 'FAIL' }),
      ]));
      if (!r.pass && r.note) {
        tbody.appendChild(el('tr', {}, [
          el('td', { colspan: '4', text: r.note, style: 'color:var(--c-behead);font-size:12px' }),
        ]));
      }
    }

    status('status', failed === 0
      ? 'All ' + total + ' checks passed in ' + elapsed.toFixed(1) + ' seconds.'
      : failed + ' of ' + total + ' checks FAILED. The site is showing results the engine cannot justify.');
  });
}

$('#run').addEventListener('click', () => run(true));
$('#run-fast').addEventListener('click', () => run(false));
defer(() => run(true));

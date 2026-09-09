#!/usr/bin/env node
/**
 * Run the engine self-checks from a terminal.
 *
 *   node tools/verify.js            full run
 *   node tools/verify.js --fast     skip the slow sampling checks
 *
 * Exits non-zero if anything fails, so CI can gate on it. There is nothing to
 * install: the engine has no dependencies and no build step.
 */

import { runChecks, summariseChecks } from './checks.js';

const fast = process.argv.includes('--fast');
const started = Date.now();
const results = runChecks({ heavy: !fast });
const { total, passed, failed, failures } = summariseChecks(results);

let currentGroup = null;
for (const r of results) {
  if (r.group !== currentGroup) {
    currentGroup = r.group;
    process.stdout.write('\n# ' + currentGroup + '\n');
  }
  const mark = r.pass ? 'ok  ' : 'FAIL';
  let detail = '';
  if (r.tolerance !== null && Number.isFinite(r.tolerance)) {
    detail = '  expected ' + fmt(r.expected) + ', got ' + fmt(r.actual) +
             (r.pass ? '' : '  (tolerance ' + r.tolerance + ')');
  }
  process.stdout.write(mark + ' ' + r.name + detail + '\n');
  if (!r.pass && r.note) process.stdout.write('     note: ' + r.note + '\n');
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
process.stdout.write('\n' + passed + '/' + total + ' checks passed in ' + elapsed + 's');
process.stdout.write(fast ? '  (fast mode: sampling checks skipped)\n' : '\n');

if (failed > 0) {
  process.stdout.write('\n' + failed + ' FAILED:\n');
  for (const f of failures) process.stdout.write('  - ' + f.group + ' / ' + f.name + '\n');
  process.exit(1);
}

function fmt(v) {
  if (typeof v !== 'number') return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a < 1e-4 || a >= 1e6) return v.toExponential(3);
  return String(Number(v.toPrecision(8)));
}

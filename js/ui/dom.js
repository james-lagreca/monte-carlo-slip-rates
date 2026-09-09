/**
 * Small DOM helpers shared by the page controllers.
 *
 * Native controls only: a real input, a real label, a real select. Nothing
 * here builds a div that pretends to be a slider, so keyboard support, screen
 * reader support and browser zoom all work without being reimplemented.
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** Format a median with an asymmetric interval, the way these get reported. */
export function formatRate(summary, dp = 2) {
  const p = summary.percentile ? summary.percentile : summary;
  return p.median.toFixed(dp) + ' +' + p.plusError.toFixed(dp) + ' -' + p.minusError.toFixed(dp);
}

export function formatInterval(summary, dp = 2) {
  const p = summary.percentile ? summary.percentile : summary;
  return '[' + p.lower.toFixed(dp) + ', ' + p.upper.toFixed(dp) + ']';
}

/** Big numbers appear when an interval rate explodes. Keep them readable. */
export function formatBig(v, dp = 1) {
  if (!Number.isFinite(v)) return '-';
  if (Math.abs(v) >= 1e6) return v.toExponential(1);
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('en-GB');
  return v.toFixed(dp);
}

/** Write into a .readout box created in the HTML. */
export function setReadout(id, value, unit) {
  const box = document.getElementById(id);
  if (!box) return;
  const v = box.querySelector('.v');
  if (!v) return;
  v.textContent = value;
  if (unit !== undefined) {
    let u = v.querySelector('.u');
    if (!u) { u = el('span', { class: 'u' }); v.appendChild(u); }
    u.textContent = ' ' + unit;
  }
}

/**
 * Keep a canvas describable. The label is rewritten with the current result,
 * so a screen reader user gets the number rather than the word "chart".
 */
export function describeCanvas(canvas, text) {
  if (!canvas) return;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', text);
}

/** Announce a slow operation without stealing focus. */
export function status(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

/** Build a results table inside a details element, so the numbers are always available. */
export function fillTable(container, headers, rows) {
  if (!container) return;
  container.innerHTML = '';
  const table = el('table');
  const thead = el('thead');
  thead.appendChild(el('tr', {}, headers.map((h, i) =>
    el('th', { class: i === 0 ? '' : 'n', text: h }))));
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const r of rows) {
    tbody.appendChild(el('tr', {}, r.map((c, i) =>
      el('td', { class: i === 0 ? '' : 'n', text: String(c) }))));
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

/** Debounce a slider handler so dragging does not queue a hundred runs. */
export function debounce(fn, ms = 120) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Run heavy work after the browser has had a chance to paint the status line.
 *
 * Deliberately setTimeout and not requestAnimationFrame: rAF does not fire at
 * all in a hidden or background tab, so an rAF-gated render would leave the
 * page stuck on its loading message until the reader came back to it.
 */
export function defer(fn) {
  setTimeout(fn, 0);
}

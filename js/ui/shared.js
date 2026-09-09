/**
 * Shared page furniture: navigation, preset loading, and the source viewer.
 *
 * Every path here is relative. The site is served from a project sub-path on
 * GitHub Pages, so a leading slash would resolve to the user site root and
 * 404. This is the single most common way a project Pages site breaks, and it
 * presents as "works locally, blank when deployed".
 */

import { el } from './dom.js';

/* ---------- presets ---------- */

let manifestCache = null;

export async function loadManifest() {
  if (!manifestCache) {
    const res = await fetch('./data/presets/index.json');
    if (!res.ok) throw new Error('could not load the preset manifest');
    manifestCache = await res.json();
  }
  return manifestCache;
}

const presetCache = new Map();

export async function loadPreset(id) {
  if (!presetCache.has(id)) {
    const res = await fetch('./data/presets/' + id + '.json');
    if (!res.ok) throw new Error('could not load preset ' + id);
    presetCache.set(id, await res.json());
  }
  return presetCache.get(id);
}

export async function loadFixtures() {
  const res = await fetch('./data/fixtures/headline.json');
  if (!res.ok) return null;
  return res.json();
}

/** Fill a <select> from the manifest, filtered by kind. */
export async function fillPresetSelect(select, kind, initial) {
  const manifest = await loadManifest();
  const items = manifest.filter((m) => m.kind === kind);
  select.innerHTML = '';
  const synth = items.filter((m) => m.synthetic);
  const pub = items.filter((m) => !m.synthetic);
  const addGroup = (label, list) => {
    if (!list.length) return;
    const g = el('optgroup', { label });
    for (const m of list) g.appendChild(el('option', { value: m.id, text: m.title }));
    select.appendChild(g);
  };
  addGroup('Synthetic teaching cases', synth);
  addGroup('Published bracket data', pub);
  if (initial) select.value = initial;
  return items;
}

/** Show what a preset teaches, and where its numbers came from. */
export function renderProvenance(node, preset) {
  if (!node) return;
  node.innerHTML = '';
  node.appendChild(el('span', {
    class: 'badge ' + (preset.synthetic ? 'synthetic' : 'published'),
    text: preset.synthetic ? 'synthetic' : 'published brackets',
  }));
  node.appendChild(el('p', { text: preset.teaches, style: 'margin:8px 0 4px' }));
  node.appendChild(el('p', {
    text: preset.provenance,
    style: 'font-size:13px;color:var(--ink-soft);margin:0',
  }));
}

/* ---------- source viewer ---------- */

/**
 * Show the code that actually ran, by fetching the engine file and cutting out
 * the region between its teach markers. It is not a transcription, so it
 * cannot drift away from what executed.
 */
export async function mountSource(container, path, marker) {
  if (!container) return;
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error('fetch failed');
    const text = await res.text();
    const startTag = '// --- teach:start ' + marker + ' ---';
    const endTag = '// --- teach:end ' + marker + ' ---';
    const a = text.indexOf(startTag);
    const b = text.indexOf(endTag);
    if (a === -1 || b === -1) throw new Error('markers not found');
    const body = text.slice(a + startTag.length, b).replace(/^\n+|\s+$/g, '');
    const dedented = dedent(body);
    container.innerHTML = '';
    container.appendChild(el('pre', { class: 'src' }, [
      el('code', { text: dedented }),
    ]));
    container.appendChild(el('p', {
      class: 'path',
      style: 'font-family:var(--font-mono);font-size:11.5px;color:var(--ink-faint);margin-top:8px',
      text: 'from ' + path.replace('./', ''),
    }));
  } catch (err) {
    container.innerHTML = '';
    container.appendChild(el('p', {
      style: 'font-size:13px;color:var(--ink-soft)',
      html: 'The source viewer needs the page to be served over http. Open the file at <code>'
        + path.replace('./', '') + '</code> to read it directly.',
    }));
  }
}

function dedent(text) {
  const lines = text.split('\n');
  let min = Infinity;
  for (const l of lines) {
    if (!l.trim()) continue;
    min = Math.min(min, l.length - l.trimStart().length);
  }
  if (!Number.isFinite(min) || min === 0) return text;
  return lines.map((l) => l.slice(min)).join('\n');
}

/* ---------- seeds ---------- */

/** Read the seed box, falling back to a stable default. */
export function seedFrom(input) {
  const v = input && input.value ? input.value.trim() : '';
  return v || 'teaching';
}

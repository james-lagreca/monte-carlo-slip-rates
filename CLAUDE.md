# CLAUDE.md — Monte Carlo slip rates teaching site

## What this is

A GitHub Pages teaching site on Monte Carlo and incremental fault slip-rate
estimation, for postgraduate methods training. Vanilla HTML, CSS and ES
modules. No build step, no dependencies, no npm install. Every file in the
repo is served as it sits on disk.

## Conventions

- **Every path in HTML and JS must be relative** (`./css/tokens.css`, not
  `/css/tokens.css`). The site is served from a project sub-path on Pages, so a
  leading slash resolves to the user-site root and 404s. This is the single
  most common way a project Pages site breaks and it presents as "works
  locally, blank when deployed".
- **`js/engine/` imports nothing outside `js/engine/`.** No `document`, no
  `window`, no `fetch`. That is what lets `node tools/verify.js` run the same
  code the browser runs, with no framework and no build.
- Dependency direction is one way: `pages/*` → `ui/*` → DOM; `pages/*` →
  `plot/*` → `engine/*`. Nothing in `engine/` reaches upward.
- Units: ages in **ka**, displacement in **m**, rates in **mm/yr**. 1 m/ka is
  1 mm/yr exactly, so there is no unit conversion anywhere in the codebase.
  Do not add one.
- Seeding: build a **fresh RNG per run** from the seed and always draw in the
  same order. A module-level shared generator would make "same seed" false as
  soon as two figures rendered in a different order.
- Never use `requestAnimationFrame` to gate work that must complete. It does
  not fire in a hidden or background tab. `ui/dom.js` `defer()` uses
  `setTimeout` for this reason, and `plot/pathFan.js` falls back to a single
  synchronous pass when `document.hidden`.
- **Navigation and footer live in the HTML, not in JavaScript.** They used to
  be injected by a `mountChrome()` helper, which meant a no-JS reader landed on
  a page with no way off it. The cost is that adding a page means editing the
  nav in nine files. That is the right trade for a teaching site.
- Never use `Math.max(...arr)` on sample arrays. It throws `RangeError` at a
  few hundred thousand elements, which is the size we work at. Use
  `engine/stats.js` `extent()`.

## Prose style

Follows the house rules in `~/.claude/skills/manuscript-writing/references/style.md`:

- Plain punctuation. **No em-dash asides.** En-dashes only inside numeric
  ranges (`6.0–7.7 mm/yr`).
- Observations before interpretations.
- **Never invent a citation or a value.** Where a citation is only partly
  verified, say so on the page rather than filling in a plausible volume
  number. `references.html` currently flags Gold and Cowgill (2011) as needing
  its full title and DOI completed from the paper.

## Numbers on the pages are measured, not written

`tools/make_fixtures.mjs` runs every preset and writes
`data/fixtures/headline.json`. The no-JS poster text in each page quotes those
measured values. **If you change a preset, run all three tools** —
`make_presets.mjs`, `make_fixtures.mjs`, `verify.js` — and update any prose
that quotes a number. The teaching only works while the numbers and the words
agree.

## Deliberate departure from the teaching-demos convention

`05_Side_Projects/18_Earthquake_Teaching_Demos` uses one self-contained HTML
file per page with everything inline, and its `CLAUDE.md` says to keep it that
way. This site does not, on purpose: the Monte Carlo engine is shared across
six pages and is itself the thing being taught. Inlining it six times would
make `node tools/verify.js` impossible and would let the six copies drift.

The visual language is otherwise the same: drafting-paper ground, 28 px grid,
Space Grotesk with IBM Plex Sans and Mono, 1.5 px ink borders, 10 px radius,
`4px 4px 0` offset shadows, canvases with a fixed `width` attribute scaled by
CSS. Plot **series** colours come from the manuscript figure palette instead,
so a figure here and the same figure in a paper are the same colours.

## Colour rule

The manuscript palette is near-iso-luminant, which is correct for print figures
separated into panels and wrong for lines overlaid on one axis. Worst pairs are
`--c-behead` against `--c-data` at 1.03:1, and `--c-naive` against `--c-pref`,
which is a red-green deutan pair.

**Never distinguish series by hue alone.** Every series carries a colour, a
distinct dash pattern from `plot/core.js` `DASH`, and a direct in-plot label
rather than a legend entry.

## Verification

`tools/checks.js` is pure and DOM-free and is consumed by both
`tools/verify.js` (node) and `verify.html` (browser). Add checks there, not in
either front end.

The four load-bearing checks have closed-form oracles: the exact inverse
transform, ratio quantiles, the monotonicity acceptance rate, and the
open-interval bias. Those are stronger than comparing against another library,
which is why there is no scipy oracle despite the original plan calling for one.

## Common tasks

- **New preset**: add it in `tools/make_presets.mjs`, re-run that then
  `make_fixtures.mjs`, and add it to the relevant page's `fillPresetSelect`
  kind (`single` or `multi`). The manifest is generated, do not hand-edit it.
- **New page**: copy the head block, the `<nav class="crumbs">` block and the
  `<footer class="site">` block from an existing page, add a controller in
  `js/pages/`, and add the new link to the nav in **every** page. The nav and
  footer are static markup on purpose, so a reader without JavaScript can still
  navigate. There is no chrome injector; do not reintroduce one.
- **Teaching code snippet**: wrap the region in
  `// --- teach:start <name> ---` and `// --- teach:end <name> ---` in the
  engine file, then call `mountSource(node, './js/engine/<file>.js', '<name>')`.
  The page fetches the real file, so the snippet cannot drift from what ran.

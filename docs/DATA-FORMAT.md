# Preset format

A preset is one JSON file in `data/presets/`, listed in the generated
`index.json` manifest. To put real data on the site, write one of these and add
its id to `tools/make_presets.mjs` so the manifest picks it up.

## Distribution specifications

Anywhere a distribution is expected, give one of these objects. They are the
shapes RISeR's `makePDF.py` builds, plus the Beta-PERT that a field estimate
usually implies.

```json
{ "type": "gauss",      "mean": 4.0, "sd": 0.2 }
{ "type": "boxcar",     "min": 3.0, "max": 5.5 }
{ "type": "triangular", "min": 3.8, "mode": 5.0, "max": 5.6 }
{ "type": "trapezoid",  "min": 4.0, "lo": 5.0, "hi": 6.0, "max": 7.5 }
{ "type": "pert",       "min": 10.5, "mode": 12.0, "max": 13.5 }
{ "type": "fixed",      "value": 0 }
{ "type": "empirical",  "points": [[3.00, 0.0], [3.02, 0.0011], ...] }
```

Notes:

- `gauss` is built on a support of plus or minus four standard deviations,
  matching RISeR. If that support reaches zero the engine raises a warning,
  because dividing by an age that might be zero produces an unbounded rate.
- `trapezoid` values must be ordered `min ≤ lo ≤ hi ≤ max`. The flat top runs
  from `lo` to `hi` and is the shape to use when two restorations are both
  defensible.
- `pert` shape parameters are `α = 1 + 4(mode−min)/(max−min)` and
  `β = 1 + 4(max−mode)/(max−min)`, so `α + β = 6` for every PERT.
- `empirical` takes `[value, probability]` pairs. Densities need not be
  normalised. The curve is treated as piecewise linear and inverted exactly,
  so sampling introduces no discretisation error.

### Loading a calibrated age from OxCal

RISeR's `makePDF.py` and `calyr2age.py` write a two-column text file of value
and probability with `#` comments. `js/engine/piecewise.js` exports
`parseRiserPdf(text)`, which reads that format unmodified:

```js
import { parseRiserPdf } from './js/engine/piecewise.js';
const dist = parseRiserPdf(await (await fetch('./data/pdfs/my-age.txt')).text());
```

Ages must increase into the past, in ka. `calyr2age.py` does that conversion
from OxCal calendar years, with `-f 1000` to scale years to ka.

## Single-marker preset

All numbers in the examples below are invented. Do not paste unpublished
measurements into a public repository while checking that a format works.

```json
{
  "id": "my-site-terrace-riser",
  "kind": "single",
  "synthetic": false,
  "title": "T2/T3 riser",
  "teaches": "One line saying what this preset is for.",
  "provenance": "Where these numbers came from. Shown in the interface.",
  "units": { "age": "ka", "displacement": "m", "rate": "mm/yr" },
  "truth": null,
  "displacement": { "type": "pert", "min": 20.0, "mode": 25.0, "max": 30.0 },
  "age": { "type": "gauss", "mean": 5.00, "sd": 0.40 },
  "anchor": { "type": "boxcar", "min": 0.20, "max": 0.50 }
}
```

- `anchor` is the age of the most recent event, and may be `null`. When
  present, the rate is `D / (t − t_anchor)`.
- `truth` is `{ "slipRate": 3.0 }` for a forward-modelled synthetic case, so the
  site can draw the answer the estimator should recover, or `null` for real data.
- `synthetic` drives the badge in the interface. Set it honestly.

## Multi-marker preset

Markers are listed **youngest and least offset first**.

```json
{
  "id": "my-site",
  "kind": "multi",
  "synthetic": false,
  "title": "My site",
  "teaches": "One line.",
  "provenance": "Where these numbers came from.",
  "units": { "age": "ka", "displacement": "m", "rate": "mm/yr" },
  "truth": null,
  "anchor": { "id": "mre", "label": "MRE", "age": { "type": "boxcar", "min": 0.20, "max": 0.50 } },
  "markers": [
    { "id": "t1t2", "label": "T1/T2",
      "displacement": { "type": "pert", "min": 8.0, "mode": 10.0, "max": 12.0 },
      "age": { "type": "gauss", "mean": 2.00, "sd": 0.20 } }
  ]
}
```

The anchor is treated as a marker pinned at zero displacement. Set it to `null`
if you have no constraint on the most recent event, and read the
[onset of offset page](../t1-anchoring.html) for what that costs you.

## Using the engine directly

The engine is importable on its own, in a browser or in node, with no build
step and no dependencies:

```js
import { runIncremental, medianPath } from './js/engine/index.js';

const result = runIncremental({
  markers: preset.markers,
  anchor: preset.anchor,
  n: 10000,
  seed: 'teaching',
  enforceMonotonic: true,
  maxRate: null,
});

console.log(result.acceptance);                              // report this
console.log(result.bestFitStats.percentile.median);
for (const iv of result.intervals) {
  console.log(iv.label, iv.stats.percentile.median);
}
```

`runSingleMarker` has the same shape for Method 1. Both take a `seed`, which
may be any text, and both are bitwise reproducible for a given seed and set of
settings.

## After editing a preset

```bash
node tools/make_presets.mjs
node tools/make_fixtures.mjs
node tools/verify.js
```

The pages quote measured numbers from `data/fixtures/headline.json`. If a
preset changes and the fixtures are not regenerated, the prose and the live
figures will disagree, which is worse than either being wrong alone.

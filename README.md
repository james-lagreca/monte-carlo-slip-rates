# Monte Carlo slip rates

An interactive teaching site on Monte Carlo and incremental fault slip-rate
estimation, aimed at postgraduate and early-career methods training.

**Live site:** https://james-lagreca.github.io/monte-carlo-slip-rates/

Two methods, two traps:

| Page | What it teaches |
|---|---|
| [Distributions](m1-distributions.html) | Gaussian, boxcar, triangular, trapezoidal, Beta-PERT and empirical shapes, and what each one claims about your knowledge |
| [One dated marker](m1-one-marker.html) | Why dividing two distributions gives a skewed rate, and why first-order error propagation fails when the age is poor |
| [Incremental analysis](m2-incremental.html) | Rejection sampling, the monotonicity condition, the path fan, interval rates, and the acceptance rate as a diagnostic |
| [Reporting](m2-intervals.html) | Percentile against highest posterior density intervals, and which number belongs in a paper |
| [Onset of offset](t1-anchoring.html) | Why dividing by a marker's full age under-reads the rate, and the closed form for the bias |
| [Dating the wrong event](t2-mispairing.html) | What a formation-against-abandonment mispairing does to an incremental analysis, and how the acceptance rate detects it |

## Data

**Every teaching dataset here is synthetic.** The synthetic presets are
forward-modelled from a stated slip rate, so the site can print the answer an
estimator is supposed to recover and you can see whether it does.

Two further presets carry displacement and age brackets digitised from
published studies, are labelled as published in the interface, and are cited on
the [references page](references.html). They are loaded as uniform
distributions over the brackets, which is not what the source papers did, so
the rates this site computes from them are illustrative recomputations rather
than reproductions of published values.

No unpublished field measurement appears anywhere in this repository.

## Run it locally

```bash
python -m http.server 8000
```

Then open http://localhost:8000/. Opening the files directly with `file://`
will not work, because ES modules and `fetch` both need a real origin.

There is no npm install, no build step and no dependencies. Every file in the
repository is served exactly as it sits on disk, so the source you read in the
browser is the source that ran.

## Verify the engine

```bash
node tools/verify.js
```

Fifty-four checks, about one second, exit code non-zero on failure. The same
checks run in the browser at [verify.html](verify.html), importing the same
`tools/checks.js`.

The engine is asserted against closed-form answers rather than against a second
numerical library. Four checks carry the teaching:

| Check | Oracle |
|---|---|
| `cdf(invCdf(p)) = p` for the piecewise-linear family | deterministic, asserted below 1e-12 |
| Ratio quantiles for a fixed offset over a Gaussian age | `D / (µ + σΦ⁻¹(1−p))` |
| Monotonicity acceptance for a Gaussian age pair | `Φ((µ₂−µ₁)/√(σ₁²+σ₂²))` |
| Open-interval bias | `1 − t_MRE/t_m` |

If one of those fails, a page on the site is teaching something false, not just
returning a slightly wrong number.

## Regenerating

```bash
node tools/make_presets.mjs     # rewrite data/presets/*.json
node tools/make_fixtures.mjs    # remeasure every headline number
node tools/verify.js            # confirm the engine still agrees with the closed forms
```

The pages quote measured output. If you change a preset, run all three, because
the teaching only works while the numbers and the prose agree.

## Adding real data

See [`docs/DATA-FORMAT.md`](docs/DATA-FORMAT.md). Replace the `markers` array in
a preset and nothing else changes. Ages may be given as a distribution
specification or as an empirical table of value and probability pairs, which is
the two-column format RISeR's `makePDF.py` writes, so calibrated ages exported
from OxCal load without modification.

## Method provenance

The incremental method is not original here. It builds on Gold and Cowgill
(2011) and was developed in this form by Robert Zinke and colleagues
([Zinke et al. 2017](https://doi.org/10.1002/2017GL075048),
[Zinke et al. 2019](https://doi.org/10.1029/2018GL080688)). The engine is a
JavaScript port of the algorithm in Zinke's RISeR toolbox, whose documentation
asks that users cite those two papers. Anchoring to the most recent event
follows Hatem et al. (2024). Full details on the
[references page](references.html).

## Licence

Code in `js/` and `tools/` is MIT. Prose, figures and the synthetic presets are
CC BY 4.0. See `LICENSE` and `LICENSE-CONTENT`.

## Citing

See `CITATION.cff`. If you use the method rather than the website, cite Zinke
et al. (2017, 2019) as the RISeR documentation asks.

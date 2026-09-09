# Algorithms

Every formula the site uses, with its provenance and the check that holds it
honest. Units throughout: ages in ka, displacement in m, rates in mm/yr. One
metre per thousand years is one millimetre per year exactly, so there is no
unit conversion anywhere in the code.

## Random numbers

`js/engine/rng.js`

Seeds are hashed from text with `cyrb128`, then fed to `mulberry32`: 32-bit
state, period 2³². A ten thousand path run consumes well under 10⁶ draws, so
the period is not a constraint, and the generator is five lines, which matters
because students are meant to read it. `sfc32` is provided for anyone who wants
128-bit state.

**The reproducibility rule.** Build a fresh generator at the start of every run
and always draw in the same order. A module-level shared generator makes "same
seed" false as soon as two figures on a page render in a different order.

Normals come from Box-Muller with a cached second variate. That makes the
number of uniforms consumed per normal non-constant, so seed reproducibility
holds across identical settings, not across different ones. Building a fresh
generator per run makes that a non-issue.

Gamma variates use the Marsaglia and Tsang (2000) squeeze method, and Beta is
`X/(X+Y)` from two Gammas.

## Distribution shapes

`js/engine/distributions.js`

The shapes built by RISeR's `makePDF.py`, plus Beta-PERT.

### Beta-PERT

    α = 1 + 4(mode − min)/(max − min)
    β = 1 + 4(max − mode)/(max − min)
    x = min + (max − min)·Beta(α, β)

The 4 is the standard PERT shape constant, so `α + β = 6` for every PERT.
Closed-form moments, which is what the sampler is checked against:

    µ = (min + 4·mode + max)/6
    σ = √( (µ − min)(max − µ) / 7 )

Measured against 400,000 draws: mean 11.9997 against 12.000, standard deviation
0.5672 against 0.56695.

### Gaussian

Built on a support of ±4σ, matching `makePDF.py`, and renormalised over that
truncation. Sampling rejects outside the support. A warning is raised when
`mean − 4σ ≤ 0`, because an age whose support includes zero produces an
unbounded rate, and that is a modelling error rather than a numerical one.

### Piecewise-linear family

`js/engine/piecewise.js` backs triangular, trapezoidal and empirical.

RISeR discretises the CDF and interpolates to invert it. This implementation
inverts in closed form instead. Between two nodes the density is linear, so the
CDF is quadratic:

    F(x₀ + d) = F₀ + p₀d + ((p₁−p₀)/(2Δx))d²

Inverting for `d` given a uniform draw `r`:

    k = (p₁ − p₀)/Δx
    d = (r − F₀)/p₀                              if |k| < 1e-14
    d = (−p₀ + √(p₀² + 2k(r − F₀))) / k          otherwise

The payoff is that `cdf(invCdf(p)) − p` becomes a **deterministic** test with no
sampling noise. Measured: 2.4e-15 across a 2,000 point grid. That is the
strongest assertion available anywhere in this codebase, because a failure
cannot be an unlucky run.

## Method 1: one dated marker

`js/engine/slipRate.js`

    SR = D / (t − t_anchor)

Draw D, draw t, draw the anchor age, divide, discard any realisation whose
duration is at or below a small floor, repeat.

The naive comparison the site argues against:

    SR    = D̄ / T̄
    σ_SR  = SR · √( (σ_D/D̄)² + (σ_T/T̄)² )

Variances add when an anchor age is subtracted, so `σ_T² = σ_marker² + σ_anchor²`.

**Closed-form check.** With D fixed, `SR = D/T` is strictly decreasing in T, so

    q_p(SR) = D / (µ + σ Φ⁻¹(1 − p))

Measured agreement better than 0.2 per cent relative at 400,000 draws.

## Method 2: incremental

`js/engine/incremental.js`, ported from RISeR's `SupportFunctions/MCresampling.py`.

1. Draw an age and a displacement for every marker, independently.
2. Accept only if ages and displacements are **both strictly increasing**. This
   is the Bayesian condition of Gold and Cowgill (2011) and Zinke et al. (2017,
   2019): no negative slip, and no age inversions.
3. Optionally reject any path with an interval rate above `maxRate`, which
   RISeR also provides.
4. Otherwise discard the **whole realisation** and redraw. Discarding the whole
   realisation rather than repairing the offending marker is what makes the
   surviving draws samples from the correctly conditioned joint distribution.

Interval rate between successive markers:

    r_j = (d_j − d_{j−1}) / (t_j − t_{j−1})

Best-fit rate, least squares through the origin, where the origin is the
youngest point on the path:

    slope = Σ(t_j − t₀)(d_j − d₀) / Σ(t_j − t₀)²

Fitting through the origin rather than with a free intercept is what makes this
a rate rather than a trend: the fault had accumulated zero offset at the start
of the window.

**Closed-form check.** When one Gaussian-dated pair dominates the rejections,

    P(accept) = Φ( (µ₂ − µ₁) / √(σ₁² + σ₂²) )

Measured at three separations, including the mispairing case: predicted 17.29
per cent, observed 17.4 per cent.

## Onset of offset

    SR = D_m / (t_m − t_MRE)

Following Hatem et al. (2024). Strain accumulates after the most recent event
but no surface displacement is registered, so dividing by the marker's full age
charges the rate for time in which nothing could have been recorded.

**Closed form.** Because only the denominator changes,

    SR_unanchored / SR_true = 1 − t_MRE/t_m

Always less than one, so unanchored rates always read low, and the bias grows
as markers get younger. Verified against Monte Carlo medians on four markers to
three digits.

Anchoring is not free. Subtracting one uncertain age from another adds their
variances, so the anchored interval is wider. For the youngest marker on the
site the 68 per cent interval goes from 0.40 to 0.68 mm/yr wide.

## Summarising a skewed distribution

`js/engine/stats.js`

**Percentile interval.** Sort and read off. No tuning, fully reproducible,
but the upper bound is dragged out by a long tail.

**Highest posterior density**, ported from RISeR's `PDFanalysis.HPDpdf`:

1. Histogram on an even grid and normalise to a density.
2. Sort bins by descending density.
3. Accumulate `height × width` until the confidence level is reached.
4. Report the outer bounds **and** the contiguous clusters.

The cluster reporting is the part that matters. A bimodal calibrated age gives
a bimodal rate, and a single interval spanning the gap asserts that the least
likely values in the range are plausible.

HPD requires an even grid, which is why the pipeline is histogram then smooth
rather than working from raw samples. Smoothing is a binned Gaussian KDE,
`O(bins × kernel)` rather than `O(samples × bins)`, with a Silverman bandwidth
`h = 0.9·min(σ, IQR/1.34)·n^(−1/5)`.

**The consequence to teach.** HPD bounds move when you change the binning or
the smoothing. Percentile bounds do not. Measured on the skewed preset: at 200
bins and default smoothing, percentile 2.43 to 3.88 and HPD 2.20 to 3.54; at 60
bins and 2.5× smoothing, percentile 2.43 to 3.88 unchanged, HPD 2.18 to 3.58.

## Plotting

`js/plot/pathFan.js`

The alpha-mode fan strokes paths in batches of about 400. This is not an
optimisation detail. Putting every path in a single `beginPath` means the whole
thing is rasterised and composited once, so overlapping strokes **stop
accumulating alpha** and the density information in the fan is lost. Chunking
preserves the accumulation while cutting stroke calls by a few hundred times.

Density mode rasterises into a `Uint32Array` count grid with a DDA per segment
and maps counts through a square-root ramp, which keeps the sparse edges of the
fan visible.

Two things that will bite anyone extending this:

- `requestAnimationFrame` does not fire in a hidden tab. Anything that must
  complete uses `setTimeout` instead.
- `Math.max(...arr)` throws `RangeError` at a few hundred thousand elements.
  Use `extent()` from `engine/stats.js`.

/**
 * Public entry point for the Monte Carlo engine.
 *
 * Everything under js/engine/ is pure: no DOM, no window, no fetch. That is
 * what lets `node tools/verify.js` exercise it with no build step and no test
 * framework, and it is why the same code that draws the figures can be checked
 * against closed-form answers.
 */

export { makeRng, mulberry32, sfc32, cyrb128 } from './rng.js';
export { piecewiseLinear, parseRiserPdf } from './piecewise.js';
export { normalCdf, normalInvCdf, normalPdf } from './special.js';
export { makeDistribution, pertShape, GAUSS_SUPPORT_SIGMA } from './distributions.js';
export {
  DEFAULT_CONFIDENCE, extent, mean, sd, cov, quantiles, quantileSorted,
  percentileInterval, histogram, silvermanBandwidth, smoothDensity,
  hpdInterval, summarise,
} from './stats.js';
export { runSingleMarker, naivePropagation, convergenceTrace } from './slipRate.js';
export { runIncremental, medianPath, pairAcceptanceProbability } from './incremental.js';

import { calculateBenchmarkReturnStats } from '../metrics/analytics';
export type RegressionStats={beta:number;rSquared:number|null;alpha:number;trackingError:number;treynor:number|null;informationRatio:number|null;upsideCapture:number|null;downsideCapture:number|null;lowR2:boolean;betaOutlier:boolean};

/** Internal OLS primitive. Import this module only from benchmarks/gate.ts. */
export function regressionStats(rf:Float64Array,rb:Float64Array,riskFreeRate:number):RegressionStats|null{
  return calculateBenchmarkReturnStats(rf,rb,{annualRiskFreeRate:riskFreeRate/100});
}

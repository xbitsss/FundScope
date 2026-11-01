export type RegressionStats={beta:number;rSquared:number|null;alpha:number;trackingError:number;treynor:number|null;informationRatio:number|null;upsideCapture:number|null;downsideCapture:number|null;lowR2:boolean;betaOutlier:boolean};
const mean=(values:Float64Array)=>{let sum=0;for(const value of values)sum+=value;return sum/values.length;};
const sampleStd=(values:number[])=>{if(values.length<2)return null;const average=values.reduce((sum,value)=>sum+value,0)/values.length;return Math.sqrt(values.reduce((sum,value)=>sum+(value-average)**2,0)/(values.length-1));};
const compounded=(values:number[])=>values.reduce((product,value)=>product*(1+value),1)-1;

/** Internal OLS primitive. Import this module only from benchmarks/gate.ts. */
export function regressionStats(rf:Float64Array,rb:Float64Array,riskFreeRate:number):RegressionStats|null{
  if(rf.length!==rb.length||rf.length<200)return null;const fundMean=mean(rf);const benchmarkMean=mean(rb);let variance=0;let covariance=0;let fundVariance=0;
  for(let index=0;index<rb.length;index++){const b=rb[index]!-benchmarkMean;const f=rf[index]!-fundMean;variance+=b*b;covariance+=f*b;fundVariance+=f*f;}
  variance/=rb.length;covariance/=rb.length;fundVariance/=rb.length;if(variance<=1e-12)return null;const beta=covariance/variance;const rSquared=fundVariance?covariance*covariance/(fundVariance*variance):null;const dailyRf=Math.pow(1+riskFreeRate/100,1/252)-1;const annualFund=(fundMean-dailyRf)*252*100;const alpha=((fundMean-dailyRf)-beta*(benchmarkMean-dailyRf))*252*100;const active=Array.from(rf,(value,index)=>value-rb[index]!);const activeStd=sampleStd(active);
  const capture=(positive:boolean)=>{const fundReturns:number[]=[];const benchmarkReturns:number[]=[];for(let index=0;index<rb.length;index++)if(positive?rb[index]!>0:rb[index]!<0){fundReturns.push(rf[index]!);benchmarkReturns.push(rb[index]!);}if(fundReturns.length<30)return null;const benchmarkGrowth=compounded(benchmarkReturns);return benchmarkGrowth===0?null:compounded(fundReturns)/benchmarkGrowth*100;};
  return {beta,rSquared,alpha,trackingError:(activeStd??0)*Math.sqrt(252)*100,treynor:beta===0?null:annualFund/beta,informationRatio:activeStd?mean(Float64Array.from(active))/activeStd*Math.sqrt(252):null,upsideCapture:capture(true),downsideCapture:capture(false),lowR2:rSquared!==null&&rSquared<0.3,betaOutlier:beta<0.2||beta>1.8};
}

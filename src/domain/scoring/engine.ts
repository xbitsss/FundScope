import type { Fund } from '../types';

export interface ScoreFactor { id:string; weight:number; direction:'higher'|'lower' }
export interface RankedFund { fund:Fund; score:number|null; contributions:Record<string,number> }

export function rankFunds(funds:Fund[],factors:ScoreFactor[]):RankedFund[]{
  const percentiles=new Map<string,Map<number,number>>();
  for(const factor of factors){
    const available=funds.filter(f=>f.metrics[factor.id]!=null).sort((a,b)=>(b.metrics[factor.id]!-a.metrics[factor.id]!)*(factor.direction==='higher'?1:-1));
    const map=new Map<number,number>();available.forEach((fund,index)=>map.set(fund.code,available.length<=1?100:(available.length-1-index)/(available.length-1)*100));percentiles.set(factor.id,map);
  }
  return funds.map(fund=>{
    let weighted=0,used=0;const contributions:Record<string,number>={};
    for(const factor of factors){if(factor.weight<=0)continue;const percentile=percentiles.get(factor.id)?.get(fund.code)??0;const contribution=percentile*factor.weight;contributions[factor.id]=contribution;weighted+=contribution;used+=factor.weight;}
    return{fund,score:used?weighted/used:null,contributions};
  });
}

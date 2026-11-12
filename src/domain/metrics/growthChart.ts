import type { NavPoint } from '../types';

export interface GrowthChartInput { code:number; history:NavPoint[] }
export interface GrowthChartSeriesData { code:number; dates:Float64Array; values:Float64Array; path:string }
export interface GrowthChartModel { series:GrowthChartSeriesData[]; chartDays:Float64Array; startDay:number; endDay:number; min:number; max:number }

/** Prepare normalized chart series and SVG path strings away from the UI thread. */
export function buildGrowthChartModel(funds:GrowthChartInput[],days=365*5):GrowthChartModel{
  const raw=funds.map(fund=>{
    const end=fund.history.at(-1);
    if(!end)return {code:fund.code,points:[] as NavPoint[]};
    const visible=fund.history.filter(point=>point.date>=end.date-days);
    const base=visible[0]?.nav;
    return {code:fund.code,points:base?visible.map(point=>({date:point.date,nav:point.nav/base*10_000})):[]};
  });
  const dateSet=new Set<number>();let min=Infinity,max=-Infinity;
  for(const fund of raw)for(const point of fund.points){dateSet.add(point.date);min=Math.min(min,point.nav);max=Math.max(max,point.nav);}
  const sortedDays=[...dateSet].sort((a,b)=>a-b);
  if(!sortedDays.length)return {series:[],chartDays:new Float64Array(),startDay:0,endDay:0,min:0,max:0};
  const startDay=sortedDays[0]!;const endDay=sortedDays.at(-1)!;const navRange=Math.max(max-min,1);const dateRange=Math.max(endDay-startDay,1);
  const series=raw.map(fund=>{
    const dates=Float64Array.from(fund.points,point=>point.date);const values=Float64Array.from(fund.points,point=>point.nav);
    const path=fund.points.map((point,index)=>`${index?'L':'M'} ${(36+(point.date-startDay)/dateRange*528).toFixed(2)} ${(166-(point.nav-min)/navRange*138).toFixed(2)}`).join(' ');
    return {code:fund.code,dates,values,path};
  });
  return {series,chartDays:Float64Array.from(sortedDays),startDay,endDay,min,max};
}

export function nearestGrowthPoint(series:Pick<GrowthChartSeriesData,'dates'|'values'>,day:number):NavPoint|null{
  if(!series.dates.length)return null;
  let low=0,high=series.dates.length;
  while(low<high){const middle=(low+high)>>1;if(series.dates[middle]!<day)low=middle+1;else high=middle;}
  const index=low===0?0:low>=series.dates.length?series.dates.length-1:day-series.dates[low-1]!<=series.dates[low]!-day?low-1:low;
  return {date:series.dates[index]!,nav:series.values[index]!};
}

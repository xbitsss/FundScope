import type { NavPoint } from '../types';

export type Aligned={dates:Int32Array;a:Float64Array;b:Float64Array;n:number};
export type AlignedReturns={dates:Int32Array;rf:Float64Array;rb:Float64Array;nObs:number};

export function alignByDate(datesA:Int32Array,valuesA:Float64Array,datesB:Int32Array,valuesB:Float64Array,from:number,to:number):Aligned|null{
  const valid=(dates:Int32Array,values:Float64Array)=>{if(dates.length!==values.length)return false;for(let index=0;index<dates.length;index++)if(!Number.isInteger(dates[index])||!Number.isFinite(values[index])||values[index]!<=0||(index>0&&dates[index]!<=dates[index-1]!))return false;return true;};
  if(!valid(datesA,valuesA)||!valid(datesB,valuesB)||!Number.isFinite(from)||!Number.isFinite(to)||from>to)return null;
  const dates:number[]=[];const a:number[]=[];const b:number[]=[];let left=0;let right=0;
  while(left<datesA.length&&right<datesB.length){const dayA=datesA[left]!;const dayB=datesB[right]!;if(dayA===dayB){if(dayA>=from&&dayA<=to){dates.push(dayA);a.push(valuesA[left]!);b.push(valuesB[right]!);}left++;right++;}else if(dayA<dayB)left++;else right++;}
  return {dates:Int32Array.from(dates),a:Float64Array.from(a),b:Float64Array.from(b),n:dates.length};
}

export function alignedReturns(aligned:Aligned):AlignedReturns|null{
  const {dates,a,b,n}=aligned;if(n<2||dates.length!==n||a.length!==n||b.length!==n)return {dates:new Int32Array(),rf:new Float64Array(),rb:new Float64Array(),nObs:0};
  const days:number[]=[];const rf:number[]=[];const rb:number[]=[];
  for(let index=1;index<n;index++){const gap=dates[index]!-dates[index-1]!;if(gap<=0||gap>7)continue;const beforeA=a[index-1]!;const beforeB=b[index-1]!;if(beforeA<=0||beforeB<=0)continue;rf.push(a[index]!/beforeA-1);rb.push(b[index]!/beforeB-1);days.push(dates[index]!);}
  return {dates:Int32Array.from(days),rf:Float64Array.from(rf),rb:Float64Array.from(rb),nObs:rf.length};
}

export function alignNavLevels(fund:NavPoint[],benchmark:NavPoint[],from:number,to:number):Aligned|null{
  return alignByDate(Int32Array.from(fund.map(point=>point.date)),Float64Array.from(fund.map(point=>point.nav)),Int32Array.from(benchmark.map(point=>point.date)),Float64Array.from(benchmark.map(point=>point.nav)),from,to);
}

export function expectedWeekdays(from:number,to:number):number{
  let count=0;for(let day=Math.ceil(from);day<=Math.floor(to);day++){const weekday=new Date(day*86_400_000).getUTCDay();if(weekday!==0&&weekday!==6)count++;}return count;
}

import type { Fund } from '../types';

export function parseSchemeName(name:string, planRaw?:string, optionRaw?:string):Pick<Fund,'plan'|'option'> {
  const source=`${name} ${planRaw??''} ${optionRaw??''}`.toLowerCase();
  const plan=/\bdirect\b/.test(source)?'Direct':/\bregular\b/.test(source)?'Regular':'Unknown';
  const option=/growth/.test(source)?'Growth':/idcw|dividend|payout|reinvest/.test(source)?'IDCW':'Unknown';
  return {plan,option};
}

export function fillBlankSchemeDimensions<T extends Fund>(fund:T):T{
  if(fund.plan!=='Unknown'&&fund.option!=='Unknown')return fund;
  const parsed=parseSchemeName(fund.name,fund.plan,fund.option);
  return {...fund,plan:fund.plan==='Unknown'?parsed.plan:fund.plan,option:fund.option==='Unknown'?parsed.option:fund.option};
}

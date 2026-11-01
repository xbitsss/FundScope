const DAY=86_400_000;
const BACKOFF=[1,6,24,72].map(hours=>hours*60*60*1000);
export function retryDelay(attempt){return attempt>=5?7*DAY:BACKOFF[Math.min(Math.max(0,attempt-1),BACKOFF.length-1)]??7*DAY;}
export function nextRetryAt(attempt,now=Date.now()){return now+Math.min(retryDelay(attempt),7*DAY);}
const preferred=fund=>fund.structure==='open'&&fund.plan==='Direct'&&/growth/i.test(fund.option??'')&&!/bonus/i.test(fund.option??'');
export function orderHistoryQueue(funds,now=Date.now(),budget=Infinity){
  const groups=[[],[],[],[],[]];
  for(const fund of funds){const status=fund.historyStatus??(fund.history?.length?'ok':'pending');const hasHistory=Boolean(fund.history?.length);const stale=hasHistory&&fund.historyFetchedAt!=null&&now-fund.historyFetchedAt>30*DAY;const retryable=status==='failed'&&(fund.historyNextRetryAt??0)<=now;if(stale)groups[4].push(fund);else if(preferred(fund)&&!hasHistory&&status!=='failed')groups[0].push(fund);else if(preferred(fund)&&retryable)groups[1].push(fund);else if(fund.structure==='open'&&!hasHistory&&status!=='failed')groups[2].push(fund);else if(!hasHistory&&status!=='failed')groups[3].push(fund);}
  const ordered=groups.flatMap(group=>group.sort((a,b)=>(a.historyNextRetryAt??0)-(b.historyNextRetryAt??0)||(a.historyFetchedAt??0)-(b.historyFetchedAt??0)||a.code-b.code));
  return ordered.slice(0,Math.max(0,budget));
}

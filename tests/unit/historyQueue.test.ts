import { describe, expect, it } from 'vitest';
import { nextRetryAt, orderHistoryQueue } from '../../etl/historyQueue.mjs';

const f=(code:number,extra:Record<string,unknown>={})=>({code,structure:'open',plan:'Direct',option:'Growth',history:[],...extra});
describe('history queue',()=>{
  it('prioritises direct growth open and does not starve retryable failures',()=>{const now=1_000_000;const result=orderHistoryQueue([f(4,{structure:'close'}),f(3,{historyStatus:'failed',historyNextRetryAt:now-1}),f(2,{structure:'open',plan:'Regular'}),f(1)],now);expect(result.map(item=>item.code)).toEqual([1,3,2,4]);});
  it('uses capped exponential backoff',()=>{const now=100;expect(nextRetryAt(1,now)-now).toBe(3_600_000);expect(nextRetryAt(4,now)-now).toBe(259_200_000);expect(nextRetryAt(9,now)-now).toBe(604_800_000);});
  it('stops at the time-budget batch size',()=>{expect(orderHistoryQueue([f(1),f(2),f(3)],0,2)).toHaveLength(2);});
});

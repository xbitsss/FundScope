import { describe, expect, it, vi } from 'vitest';
import { AbortableRequestPool, HistoryLruCache } from '../../src/app/historyCache';

const entry=(value:number,loadedAt=1_000,snapshotId='s1')=>({history:[{date:value,nav:value}],loadedAt,snapshotId});

describe('on-demand NAV history cache and request pool',()=>{
  it('keeps a bounded least-recently-used history set and isolates snapshot IDs',()=>{
    const cache=new HistoryLruCache(2,1_000);
    cache.set(1,entry(1));cache.set(2,entry(2));
    expect(cache.get(1,{now:1_100,snapshotId:'s1'})?.history[0]?.nav).toBe(1);
    cache.set(3,entry(3));
    expect(cache.size).toBe(2);
    expect(cache.get(2,{now:1_100})).toBeNull();
    expect(cache.get(1,{now:1_100,snapshotId:'other'})).toBeNull();
    expect(cache.get(3,{now:2_001})).toBeNull();
    cache.set(4,entry(4,1_000,''));
    expect(cache.get(4,{now:1_100,snapshotId:'current-snapshot'})?.history[0]?.nav).toBe(4);
  });

  it('deduplicates concurrent requests for the same scheme',async()=>{
    const pool=new AbortableRequestPool<number,string>();
    let finish:(value:string)=>void=()=>undefined;
    const execute=vi.fn(()=>new Promise<string>(resolve=>{finish=resolve;}));
    const first=pool.load(123,execute);const second=pool.load(123,execute);
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);
    finish('loaded');
    await expect(Promise.all([first,second])).resolves.toEqual(['loaded','loaded']);
    expect(pool.size).toBe(0);
  });

  it('cancels one stale consumer without interrupting another active consumer',async()=>{
    const pool=new AbortableRequestPool<number,string>();
    let finish:(value:string)=>void=()=>undefined;let sharedSignal:AbortSignal|undefined;
    const execute=vi.fn((signal:AbortSignal)=>{sharedSignal=signal;return new Promise<string>(resolve=>{finish=resolve;});});
    const stale=new AbortController();
    const first=pool.load(456,execute,stale.signal);const second=pool.load(456,execute);
    await Promise.resolve();stale.abort();
    await expect(first).rejects.toMatchObject({name:'AbortError'});
    expect(sharedSignal?.aborted).toBe(false);
    finish('shared');
    await expect(second).resolves.toBe('shared');
  });

  it('aborts the shared transport when its last consumer leaves',async()=>{
    const pool=new AbortableRequestPool<number,string>();
    const controller=new AbortController();let sawAbort=false;
    const request=pool.load(789,signal=>new Promise<string>((_resolve,reject)=>signal.addEventListener('abort',()=>{sawAbort=true;reject(new Error('transport aborted'));},{once:true})),controller.signal);
    await Promise.resolve();controller.abort();
    await expect(request).rejects.toMatchObject({name:'AbortError'});
    await Promise.resolve();
    expect(sawAbort).toBe(true);
    expect(pool.size).toBe(0);
  });
});

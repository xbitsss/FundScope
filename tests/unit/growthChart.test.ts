import { describe, expect, it } from 'vitest';
import { buildGrowthChartModel, nearestGrowthPoint } from '../../src/domain/metrics/growthChart';

describe('worker growth-chart model',()=>{
  it('normalizes each history to ten thousand and builds a shared ordered date axis',()=>{
    const model=buildGrowthChartModel([
      {code:1,history:[{date:1,nav:10},{date:3,nav:11}]},
      {code:2,history:[{date:2,nav:20},{date:3,nav:18}]},
    ],10);
    expect([...model.chartDays]).toEqual([1,2,3]);
    expect([...model.series[0]!.values]).toEqual([10_000,11_000]);
    expect([...model.series[1]!.values]).toEqual([10_000,9_000]);
    expect(model.series.every(series=>series.path.startsWith('M '))).toBe(true);
    expect(model.min).toBe(9_000);
    expect(model.max).toBe(11_000);
  });

  it('selects the nearest observed date for the interactive marker',()=>{
    const model=buildGrowthChartModel([{code:7,history:[{date:10,nav:5},{date:20,nav:6},{date:30,nav:7}]}],30);
    expect(nearestGrowthPoint(model.series[0]!,24)).toEqual({date:20,nav:12_000});
    expect(nearestGrowthPoint(model.series[0]!,29)).toEqual({date:30,nav:14_000});
    expect(nearestGrowthPoint({dates:new Float64Array(),values:new Float64Array()},24)).toBeNull();
  });

  it('returns an empty model when there are no valid NAV points',()=>{
    const model=buildGrowthChartModel([{code:9,history:[]}]);
    expect(model.series).toEqual([]);
    expect(model.chartDays.length).toBe(0);
  });
});

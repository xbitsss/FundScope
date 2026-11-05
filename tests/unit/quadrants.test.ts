import { describe, expect, it } from 'vitest';
import { assignQuadrant, bestQuadrant, computeSplit, computeThreshold, effectiveDirection, percentileRank, percentileValue, quadrantName, quadrantTone, worstQuadrant, type MetricDirection } from '../../src/domain/scatter/quadrants';

describe('scatter quadrant math', () => {
  it.each([
    ['higher', 'higher', 3], ['higher', 'lower', 1], ['lower', 'higher', 2], ['lower', 'lower', 0],
  ] as const)('places Best for %s / %s directions', (xDirection, yDirection, expected) => {
    expect(bestQuadrant(xDirection, yDirection)).toBe(expected);
    expect(worstQuadrant(xDirection, yDirection)).toBe(expected ^ 3);
    const best = bestQuadrant(xDirection, yDirection)!;
    expect(quadrantName(best, 'X', 'Y', xDirection, yDirection).kind).toBe('best');
    expect(quadrantName(worstQuadrant(xDirection, yDirection)!, 'X', 'Y', xDirection, yDirection).kind).toBe('avoid');
  });

  it('does not rank quadrants when either direction is neutral and uses the documented tie rule', () => {
    for (const x of ['higher', 'lower', 'none'] as MetricDirection[]) for (const y of ['higher', 'lower', 'none'] as MetricDirection[]) {
      if (x === 'none' || y === 'none') expect(bestQuadrant(x, y)).toBeNull();
    }
    expect(quadrantName(3, 'AUM', 'Return', 'none', 'higher').kind).toBe('neutral');
    expect(assignQuadrant(10, 10, 10, 10, 'higher', 'lower')).toBe(1);
    expect(assignQuadrant(10, 10, 10, 10, 'none', 'none')).toBe(3);
    expect(effectiveDirection('neutral')).toBe('none');
  });

  it.each([
    ['lower', 'higher', { best: 2, worst: 1 }],
    ['higher', 'higher', { best: 3, worst: 0 }],
    ['lower', 'lower', { best: 0, worst: 3 }],
    ['higher', 'lower', { best: 1, worst: 2 }],
  ] as const)('colors all four natural-axis quadrants for %s / %s', (xDirection, yDirection, expected) => {
    const highXIsGood = xDirection === 'higher'; const highYIsGood = yDirection === 'higher';
    for (const id of [0, 1, 2, 3] as const) {
      const tone = quadrantTone(highXIsGood, highYIsGood, id);
      expect(tone).toBe(id === expected.best ? 'best' : id === expected.worst ? 'worst' : 'mixed');
    }
  });

  it('keeps every quadrant neutral when either axis has no preference', () => {
    for (const id of [0, 1, 2, 3] as const) expect(quadrantTone(null, true, id)).toBe('neutral');
    expect(quadrantName(2, 'Volatility', '3Y CAGR', 'lower', 'higher').label).toContain('Low risk, High return');
  });

  it('uses a visible fallback chain and can split a single plotted fund at peer median', () => {
    const single = [{ x: 2, y: 8 }];
    expect(computeSplit({ requested: 'peer-median', plotted: single, peers: [{ x: 4, y: 12 }, { x: 5, y: 13 }, { x: 6, y: 14 }, { x: 7, y: 15 }, { x: 8, y: 16 }, { x: 9, y: 17 }, { x: 10, y: 18 }, { x: 11, y: 19 }, { x: 12, y: 20 }, { x: 13, y: 21 }] })).toMatchObject({ x: 8.5, y: 16.5, rule: 'peer-median', peerCount: 10, notice: null });
    expect(computeSplit({ requested: 'peer-median', plotted: [{ x: 2, y: 8 }, { x: 4, y: 10 }, { x: 6, y: 12 }], peers: [], customX: 3, customY: 9 })).toMatchObject({ x: 4, y: 10, rule: 'median', notice: expect.stringContaining('using median') });
  });

  it('computes median, mean, peer-median, and custom thresholds', () => {
    expect(computeThreshold([1, 3, 9], 'median').value).toBe(3);
    expect(computeThreshold([1, 3, 9, 11], 'median').value).toBe(6);
    expect(computeThreshold([1, 3, 9], 'mean').value).toBeCloseTo(13 / 3);
    expect(computeThreshold([1, 5, 10, 14], 'peer-median', { groups: ['A', 'A', 'B', 'B'] }).value).toBe(7.5);
    expect(computeThreshold([1, 2], 'custom', { custom: 1.25 }).value).toBe(1.25);
    expect(computeThreshold([Number.NaN, 2], 'median').value).toBe(2);
    expect(computeThreshold([Number.NaN], 'median').value).toBeNull();
  });

  it('calculates percentile bounds and ranks without counting missing values', () => {
    expect(percentileValue([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentileRank(3, [1, 2, 3, 4, Number.NaN])).toBe(75);
    expect(percentileRank(Number.NaN, [1, 2])).toBeNull();
  });

  it('keeps quadrant totals equal to plotted rows and swaps mixed quadrants with axes', () => {
    const points = [[1, 1], [1, 3], [3, 1], [3, 3]] as const;
    const counts = [0, 0, 0, 0];
    for (const [x, y] of points) counts[assignQuadrant(x, y, 2, 2, 'higher', 'higher')]++;
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(points.length);
    for (const [x, y] of points) {
      const a = assignQuadrant(x, y, 2, 2, 'higher', 'lower');
      const b = assignQuadrant(y, x, 2, 2, 'lower', 'higher');
      expect(b).toBe(((a & 1) << 1) | ((a & 2) >> 1));
    }
  });
});

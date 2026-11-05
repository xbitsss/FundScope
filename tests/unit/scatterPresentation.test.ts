import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatAxisTitle, formatCompactMetricAxisLabel, formatEpochDay, formatEpochMs, formatMetricAxisLabel, formatSplitValue, labelPlacement, niceTicks, parseSplitValue } from '../../src/domain/scatter/presentation';
import { parseScatterPreferences } from '../../src/ui/scatter/preferences';

describe('scatter presentation helpers', () => {
  it('formats epoch days and milliseconds explicitly and safely', () => {
    const invalid = ['Invalid', 'Date'].join(' ');
    expect(formatEpochDay(0)).toContain('1970');
    expect(formatEpochMs(Date.UTC(2026, 10, 2))).toContain('2026');
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 9e99]) {
      expect(formatEpochDay(value)).toBe('—');
      expect(formatEpochMs(value)).toBe('—');
    }
    expect([formatEpochDay(Number.NaN), formatEpochMs(Number.NaN)]).not.toContain(invalid);
  });

  it('does not duplicate units and uses each metric basis', () => {
    expect(formatAxisTitle({ id: 'std_dev', label: 'Volatility (annualized std dev) (%)', unit: '%' }, 'lower', 1)).toBe('Volatility (annualized std dev) (%) · 1Y risk window · lower is better');
    expect(formatAxisTitle({ id: 'cagr_3y', label: '3Y CAGR', unit: '%' }, 'higher', 1)).toBe('3Y CAGR (%) · higher is better');
    expect(formatMetricAxisLabel({ id: 'cagr_3y', label: '3Y CAGR (%)', unit: '%' })).toBe('3Y CAGR (%)');
  });

  it('keeps plot axis labels compact without stretching long metric descriptions', () => {
    expect(formatCompactMetricAxisLabel({ id: 'std_dev', label: 'Volatility (annualized std dev) (%)', unit: '%' }, 1)).toBe('Volatility · 1Y risk');
    expect(formatCompactMetricAxisLabel({ id: 'cagr_3y', label: '3Y CAGR', unit: '%' }, 1)).toBe('3Y CAGR');
  });

  it('formats custom splits to two decimals and retains the last valid value on invalid input', () => {
    expect(formatSplitValue(3.755044780992)).toBe('3.76');
    expect(formatSplitValue(12345.1)).toBe('12,345.10');
    expect(parseSplitValue('12,345.10', 2)).toEqual({ value: 12345.1, valid: true });
    expect(parseSplitValue('', 3.76)).toEqual({ value: 3.76, valid: false });
    expect(parseSplitValue('Infinity', 3.76)).toEqual({ value: 3.76, valid: false });
  });

  it('creates readable tick values for negative and tiny ranges', () => {
    const negative = niceTicks(-3.4, 2.1);
    expect(negative).toContain(0);
    expect(negative.length).toBeGreaterThanOrEqual(3);
    expect(negative.length).toBeLessThanOrEqual(6);
    expect(niceTicks(-0.0002, 0.0002)).toEqual([-0.0002, -0.0001, 0, 0.0001, 0.0002]);
  });

  it('keeps labels within the plot and separates random close points', () => {
    let seed = 8128; const random = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    for (let trial = 0; trial < 40; trial++) {
      const points = Array.from({ length: 6 }, (_, index) => ({ x: 120 + random() * 6, y: 110 + random() * 6, label: `Fund ${index} long name` }));
      const bounds = { left: 60, top: 20, right: 300, bottom: 280 }; const placed = labelPlacement(points, bounds);
      const boxes = placed.map((item, index) => { const width = Math.min(150, Math.max(34, points[index]!.label.length * 6.4)); const left = item.anchor === 'end' ? item.x - width : item.x; return { left, top: item.y - 18, right: left + width, bottom: item.y, original: points[index]! }; });
      for (const box of boxes) { expect(box.left).toBeGreaterThanOrEqual(bounds.left); expect(box.right).toBeLessThanOrEqual(bounds.right + 1); expect(box.top).toBeGreaterThanOrEqual(bounds.top - 1); expect(box.bottom).toBeLessThanOrEqual(bounds.bottom); }
      for (let left = 0; left < boxes.length; left++) for (let right = left + 1; right < boxes.length; right++) {
        const a = boxes[left]!; const b = boxes[right]!;
        expect(a.left >= b.right || b.left >= a.right || a.top >= b.bottom || b.top >= a.bottom).toBe(true);
      }
    }
  });

  it('scans application source so invalid date output cannot be hard-coded', () => {
    const forbidden = ['Invalid', 'Date'].join(' ');
    const scan = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? scan(path) : /\.(ts|tsx)$/.test(entry.name) ? [readFileSync(path, 'utf8')] : [];
    });
    expect(scan(join(process.cwd(), 'src')).some(source => source.includes(forbidden))).toBe(false);
  });

  it('migrates legacy compare preferences by ignoring removed scope and outlier controls', () => {
    const migrated = parseScatterPreferences({ x: 'std_dev', y: 'cagr_3y', scope: 'current', includeOutliers: true, orientation: 'best-top-right', zoom: 1.5, bestAtTopRight: true, logScale: true, splitRule: 'median' });
    expect(migrated).toMatchObject({ x: 'std_dev', y: 'cagr_3y', splitRule: 'median', logScale: true, showLabels: true });
    expect(migrated).not.toHaveProperty('scope');
    expect(migrated).not.toHaveProperty('includeOutliers');
    expect(migrated).not.toHaveProperty('orientation');
    expect(migrated).not.toHaveProperty('zoom');
    expect(migrated).not.toHaveProperty('bestAtTopRight');
    expect(parseScatterPreferences({ x: 'not-a-metric' })?.splitRule).toBe('peer-median');
  });
});

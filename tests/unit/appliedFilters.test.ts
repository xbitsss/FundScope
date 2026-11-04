import { describe, expect, it } from 'vitest';
import { displayFilterValue, fitWrappedChipCount, formatFacetChip, formatRangeChip } from '../../src/domain/screener/appliedFilters';

describe('applied filter chip formatting', () => {
  it('shows up to two selected facet values and collapses larger sets to a count', () => {
    expect(formatFacetChip('Asset', ['equity'])).toBe('Asset: equity');
    expect(formatFacetChip('Asset', ['equity', 'debt'])).toBe('Asset: equity, debt');
    expect(formatFacetChip('Categories', ['A', 'B', 'C'])).toBe('Categories: 3');
  });

  it('labels unknown options explicitly', () => {
    expect(displayFilterValue('unknown')).toBe('Unknown');
    expect(formatFacetChip('Option', ['Unknown'])).toBe('Option: Unknown');
  });

  it('formats metric ranges and units', () => {
    expect(formatRangeChip('3Y CAGR', { min: 12, max: null }, '%')).toBe('3Y CAGR: ≥ 12%');
    expect(formatRangeChip('AUM', { min: 1, max: 2.5 }, '₹ Cr')).toBe('AUM: 1 Cr – 2.5 Cr');
    expect(formatRangeChip('Age', { min: null, max: 5 }, 'years')).toBe('Age: ≤ 5 yr');
  });

  it('fits visible chips into the measured row width and reserves a more button', () => {
    expect(fitWrappedChipCount(100, [40, 40, 40, 40, 40], 2, 36, 8)).toBe(3);
    expect(fitWrappedChipCount(100, [40, 40], 2, 36, 8)).toBe(2);
    expect(fitWrappedChipCount(50, [45, 45, 45], 1, 38, 8)).toBe(0);
    expect(fitWrappedChipCount(100, [40, 40, 40, 40], 2, 36, 8, 42)).toBe(2);
  });
});

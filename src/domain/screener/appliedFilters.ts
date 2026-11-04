export type FilterRange = { min: number | null; max: number | null };

export function displayFilterValue(value: string): string {
  const trimmed = value.trim();
  return !trimmed || /^(unknown|not specified)$/i.test(trimmed) ? 'Unknown' : trimmed;
}

export function formatFacetChip(label: string, values: readonly string[]): string {
  if (!values.length) return label;
  if (values.length > 2) return `${label}: ${values.length}`;
  return `${label}: ${values.map(displayFilterValue).join(', ')}`;
}

function numberText(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 }).format(value);
}

export function formatRangeChip(label: string, range: FilterRange, unit: string): string {
  const suffix = unit === '%' ? '%' : unit === 'ratio' ? 'x' : unit === 'years' ? ' yr' : unit === '₹ Cr' ? ' Cr' : '';
  const min = range.min === null ? null : `${numberText(range.min)}${suffix}`;
  const max = range.max === null ? null : `${numberText(range.max)}${suffix}`;
  if (min && max) return `${label}: ${min} – ${max}`;
  if (min) return `${label}: ≥ ${min}`;
  if (max) return `${label}: ≤ ${max}`;
  return label;
}

/** Returns the number of chips that fit beside a +N more control in the row limit. */
export function fitWrappedChipCount(containerWidth: number, chipWidths: readonly number[], maxRows: number, moreWidth: number, gap = 8, trailingWidth = 0): number {
  if (!chipWidths.length || containerWidth <= 0 || maxRows <= 0) return 0;
  const rowCount = (widths: readonly number[]) => {
    let rows = 1;
    let used = 0;
    for (const rawWidth of widths) {
      const width = Math.min(containerWidth, Math.max(0, rawWidth));
      const next = used === 0 ? width : used + gap + width;
      if (used > 0 && next > containerWidth) { rows++; used = width; }
      else used = next;
    }
    return rows;
  };
  if (rowCount(trailingWidth > 0 ? [...chipWidths, trailingWidth] : chipWidths) <= maxRows) return chipWidths.length;
  for (let count = chipWidths.length - 1; count >= 0; count--) {
    const controls = [...chipWidths.slice(0, count), moreWidth];
    if (trailingWidth > 0) controls.push(trailingWidth);
    if (rowCount(controls) <= maxRows) return count;
  }
  return 0;
}

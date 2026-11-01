/** Normalizes user-entered and catalog text before case-insensitive matching. */
export function normalizeFilterText(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value)
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-IN');
}

/** Enum selections compare normalized values; free-text search uses includes(). */
export function matchesSelection(value: unknown, selected: readonly string[]): boolean {
  if (!selected.length) return true;
  const normalized = normalizeFilterText(value);
  return normalized.length > 0 && selected.some(item => normalizeFilterText(item) === normalized);
}

/** Normalizes user-entered and catalog text before case-insensitive matching. */
export function normalizeFilterText(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const source = String(value);
  // NFKC is an identity for ASCII; bypass it for the dominant catalogue path.
  const compatible = /^[\x00-\x7F]*$/.test(source) ? source : source.normalize('NFKC');
  return compatible
    .trim()
    .replace(/\s+/g, ' ')
    // English/Indian catalogue labels use the same Unicode default folding;
    // avoid the much slower per-string locale lookup in the 14k-row index build.
    .toLowerCase();
}

/** Enum selections compare normalized values; free-text search uses includes(). */
export function matchesSelection(value: unknown, selected: readonly string[]): boolean {
  if (!selected.length) return true;
  const normalized = normalizeFilterText(value);
  return normalized.length > 0 && selected.some(item => normalizeFilterText(item) === normalized);
}

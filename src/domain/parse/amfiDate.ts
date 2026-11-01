const monthMap: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function parseAmfiDate(raw: string): number | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(raw.trim());
  if (!match) return null;
  const month = monthMap[match[2]!.toLowerCase()];
  if (month === undefined) return null;
  const day = Number(match[1]);
  const year = Number(match[3]);
  const epoch = Math.floor(Date.UTC(year, month, day) / 86_400_000);
  const date = new Date(epoch * 86_400_000);
  return date.getUTCDate() === day && date.getUTCMonth() === month && date.getUTCFullYear() === year ? epoch : null;
}

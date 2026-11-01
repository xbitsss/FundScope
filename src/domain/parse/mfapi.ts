import { z } from 'zod';
import type { NavPoint } from '../types';

const mfapiHistorySchema = z.object({
  meta: z.object({
    scheme_code: z.number(),
    scheme_name: z.string(),
    scheme_category: z.string().optional(),
  }).passthrough(),
  data: z.array(z.object({ date: z.string(), nav: z.string() })),
  status: z.string(),
}).passthrough();

export interface ParsedMfapiHistory {
  schemeCode: number;
  schemeName: string;
  schemeCategory: string | null;
  history: NavPoint[];
}

export function parseMfapiDate(raw: string): number | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const epoch = Date.UTC(year, month - 1, day);
  const date = new Date(epoch);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(epoch / 86_400_000);
}

export function parseMfapiHistory(payload: unknown, expectedCode?: number): ParsedMfapiHistory {
  const result = mfapiHistorySchema.parse(payload);
  if (result.status !== 'SUCCESS') throw new Error(`MFapi returned status ${result.status}.`);
  if (expectedCode !== undefined && result.meta.scheme_code !== expectedCode) throw new Error('MFapi returned a different scheme code.');
  const byDate = new Map<number, number>();
  for (const row of result.data) {
    const date = parseMfapiDate(row.date);
    const nav = Number(row.nav);
    if (date !== null && Number.isFinite(nav) && nav > 0) byDate.set(date, nav);
  }
  const history = [...byDate].sort(([left], [right]) => left - right).map(([date, nav]) => ({ date, nav }));
  if (!history.length) throw new Error('MFapi returned no valid NAV observations.');
  return {
    schemeCode: result.meta.scheme_code,
    schemeName: result.meta.scheme_name,
    schemeCategory: result.meta.scheme_category ?? null,
    history,
  };
}

import { z } from 'zod';
import { parseAmfiDate } from '../parse/amfiDate';

export type SchemeStructure = 'open' | 'close' | 'interval' | 'unknown';
export interface ParsedSchemeRow {
  schemeCode: number;
  isinA: string | null;
  isinB: string | null;
  name: string;
  plan: string | null;
  option: string | null;
  nav: number | null;
  navDate: number | null;
  amc: string;
  structure: SchemeStructure;
  categoryRaw: string;
  headerRaw: string;
  lineNumber: number;
}
export interface RejectedNavRow { lineNumber: number; reason: string; raw: string }
export interface DuplicateSchemeCode { schemeCode: number; firstLine: number; duplicateLine: number; firstCategory: string; duplicateCategory: string }
export interface ParsedNavFile {
  schemes: ParsedSchemeRow[];
  diagnostics: {
    columnHeader: string | null;
    headerCount: number;
    amcCount: number;
    candidateRowCount: number;
    parsedRowCount: number;
    rejectedRows: RejectedNavRow[];
    duplicateSchemeCodes: DuplicateSchemeCode[];
    formatFingerprint: string;
    parsedRowRatio: number;
    shapeValid: boolean;
  };
}

const parsedSchemeSchema = z.object({
  schemeCode: z.number().int().positive(),
  isinA: z.string().nullable(),
  isinB: z.string().nullable(),
  name: z.string().min(1),
  plan: z.string().nullable(),
  option: z.string().nullable(),
  nav: z.number().positive().nullable(),
  navDate: z.number().int().nullable(),
  amc: z.string().min(1),
  structure: z.enum(['open', 'close', 'interval', 'unknown']),
  categoryRaw: z.string(),
  headerRaw: z.string(),
  lineNumber: z.number().int().positive(),
});
const outputSchema = z.object({
  schemes: z.array(parsedSchemeSchema),
  diagnostics: z.object({
    columnHeader: z.string().nullable(),
    headerCount: z.number().int().nonnegative(),
    amcCount: z.number().int().nonnegative(),
    candidateRowCount: z.number().int().nonnegative(),
    parsedRowCount: z.number().int().nonnegative(),
    rejectedRows: z.array(z.object({ lineNumber: z.number().int().positive(), reason: z.string(), raw: z.string() })),
    duplicateSchemeCodes: z.array(z.object({ schemeCode: z.number().int().positive(), firstLine: z.number().int().positive(), duplicateLine: z.number().int().positive(), firstCategory: z.string(), duplicateCategory: z.string() })),
    formatFingerprint: z.string(),
    parsedRowRatio: z.number().min(0).max(1),
    shapeValid: z.boolean(),
  }),
});

const structureHeader = /^(open|close|interval)\s*ended?\s*(?:schemes?|fund)?\s*\(\s*(.*?)\s*\)\s*$/i;
const cleanIsin = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed && trimmed !== '-' && !/^n\.?a\.?$/i.test(trimmed) ? trimmed : null;
};
const cleanOptional = (value: string | undefined): string | null => value?.trim() || null;

function parseNavValue(value: string | undefined): number | null {
  const raw = value?.trim() ?? '';
  if (!raw || /^n\.?a\.?$/i.test(raw) || raw === '-') return null;
  const number = Number(raw.replace(/,/g, ''));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseSchemeRow(line: string, lineNumber: number, state: { amc: string; structure: SchemeStructure; categoryRaw: string; headerRaw: string }): ParsedSchemeRow {
  const fields = line.split(';');
  const code = Number(fields[0]?.trim());
  if (!Number.isInteger(code) || code <= 0) throw new Error('INVALID_SCHEME_CODE');
  if (fields.length < 6) throw new Error('TOO_FEW_COLUMNS');
  const dateRaw = fields.at(-1)?.trim() ?? '';
  const navRaw = fields.at(-2)?.trim() ?? '';
  const navDate = parseAmfiDate(dateRaw);
  const nav = parseNavValue(navRaw);
  const hasPlanAndOption = fields.length >= 8;
  const nameEnd = hasPlanAndOption ? fields.length - 4 : fields.length - 2;
  const name = fields.slice(3, nameEnd).join(';').trim();
  if (!name) throw new Error('EMPTY_SCHEME_NAME');
  return parsedSchemeSchema.parse({
    schemeCode: code,
    isinA: cleanIsin(fields[1]),
    isinB: cleanIsin(fields[2]),
    name,
    plan: hasPlanAndOption ? cleanOptional(fields.at(-4)) : null,
    option: hasPlanAndOption ? cleanOptional(fields.at(-3)) : null,
    nav,
    navDate,
    amc: state.amc || 'Unknown',
    structure: state.structure,
    categoryRaw: state.categoryRaw,
    headerRaw: state.headerRaw,
    lineNumber,
  });
}

/** Pure AMFI NAVAll state-machine parser. Rows with N.A. NAVs are retained as master data. */
export function parseAmfiNavAllFile(text: string): ParsedNavFile {
  const schemes = new Map<number, ParsedSchemeRow>();
  const rejectedRows: RejectedNavRow[] = [];
  const duplicateSchemeCodes: DuplicateSchemeCode[] = [];
  const state = { amc: 'Unknown', structure: 'unknown' as SchemeStructure, categoryRaw: '', headerRaw: '' };
  let columnHeader: string | null = null;
  let headerCount = 0;
  let amcCount = 0;
  let candidateRowCount = 0;

  const lines = text.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    if (/^scheme code\s*;/i.test(line)) {
      columnHeader ??= line;
      return;
    }
    const header = structureHeader.exec(line);
    if (header) {
      state.structure = header[1]!.toLowerCase() as SchemeStructure;
      state.categoryRaw = header[2]!.trim();
      state.headerRaw = line;
      headerCount++;
      return;
    }
    if (line.includes(';')) {
      candidateRowCount++;
      try {
        const scheme = parseSchemeRow(line, index + 1, state);
        const first = schemes.get(scheme.schemeCode);
        if (first) {
          duplicateSchemeCodes.push({ schemeCode: scheme.schemeCode, firstLine: first.lineNumber, duplicateLine: scheme.lineNumber, firstCategory: first.categoryRaw, duplicateCategory: scheme.categoryRaw });
          return;
        }
        schemes.set(scheme.schemeCode, scheme);
      } catch (error) {
        rejectedRows.push({ lineNumber: index + 1, reason: error instanceof Error ? error.message : 'INVALID_ROW', raw });
      }
      return;
    }
    if (!/^scheme code\b/i.test(line)) {
      state.amc = line;
      amcCount++;
    }
  });

  const parsed = [...schemes.values()];
  const parsedRowRatio = candidateRowCount === 0 ? 0 : parsed.length / candidateRowCount;
  const fingerprint = [columnHeader ?? 'NO_COLUMN_HEADER', ...new Set(parsed.map((row) => row.headerRaw).filter(Boolean)).values()].join('\n');
  const result: ParsedNavFile = {
    schemes: parsed,
    diagnostics: {
      columnHeader,
      headerCount,
      amcCount,
      candidateRowCount,
      parsedRowCount: parsed.length,
      rejectedRows,
      duplicateSchemeCodes,
      formatFingerprint: fingerprint,
      parsedRowRatio,
      // Assess only data-shaped semicolon records; AMC/header lines are structural, not rows.
      shapeValid: Boolean(columnHeader) && candidateRowCount > 0 && parsedRowRatio >= 0.8,
    },
  };
  return outputSchema.parse(result);
}

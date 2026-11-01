import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAmfiDate, parseAmfiNavAll } from '../../src/domain/parse/amfi';
import { parseSchemeName } from '../../src/domain/parse/schemeName';

describe('AMFI NAV parser',()=>{
  it('parses category and AMC context, scheme dimensions, and options',()=>{
    const sample=readFileSync(new URL('../fixtures/amfi-nav-sample.txt',import.meta.url),'utf8');
    const funds=parseAmfiNavAll(sample);
    expect(funds).toHaveLength(4);
    expect(funds[0]).toMatchObject({code:129008,amc:'Franklin Templeton Mutual Fund',structure:'open',assetClass:'debt',classRuleId:'debt_scheme',subCategory:'Banking and PSU',plan:'Direct',nav:25.3336});
    expect(funds.find(f=>f.code===129009)?.option).toBe('IDCW');
    expect(funds.find(f=>f.code===130947)).toMatchObject({amc:'ICICI Prudential Mutual Fund',plan:'Unknown',structure:'open'});
  });
  it('parses AMFI dates as UTC epoch days and rejects malformed input',()=>{
    expect(parseAmfiDate('12-Oct-2026')).toBe(Math.floor(Date.UTC(2026,9,12)/86_400_000));
    expect(parseAmfiDate('31-Not-2026')).toBeNull();
  });
  it('does not compute performance metrics from distribution options',()=>{
    const sample=readFileSync(new URL('../fixtures/amfi-nav-sample.txt',import.meta.url),'utf8');
    const reinvestment=parseAmfiNavAll(sample).find(f=>f.code===129009);
    expect(reinvestment?.metrics).toEqual({});
  });
  it('falls back to the scheme name for a missing plan and option',()=>{
    expect(parseSchemeName('Example Equity Fund - Direct Plan - Growth Option')).toEqual({plan:'Direct',option:'Growth'});
    expect(parseSchemeName('Example Debt Fund - Regular Plan - IDCW')).toEqual({plan:'Regular',option:'IDCW'});
  });
});

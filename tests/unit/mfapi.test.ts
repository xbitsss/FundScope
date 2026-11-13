import { describe, expect, it } from 'vitest';
import { parseMfapiHistory } from '../../src/domain/parse/mfapi';

describe('MFapi history parser', () => {
  it('validates the requested scheme, removes duplicate dates, and sorts NAV observations', () => {
    const result = parseMfapiHistory({ status: 'SUCCESS', meta: { scheme_code: 100, scheme_name: 'Example Fund' }, data: [
      { date: '03-01-2026', nav: '12.5' },
      { date: '01-01-2026', nav: '10' },
      { date: '03-01-2026', nav: '13' },
      { date: '32-01-2026', nav: '999' },
    ] }, 100);
    expect(result.history).toEqual([{ date: 20454, nav: 10 }, { date: 20456, nav: 13 }]);
    expect(() => parseMfapiHistory({ status: 'SUCCESS', meta: { scheme_code: 101, scheme_name: 'Wrong' }, data: [{ date: '01-01-2026', nav: '10' }] }, 100)).toThrow(/different scheme code/);
  });

  it('accepts a changed MFapi code only when the returned ISIN matches the AMFI scheme',()=>{
    const response={status:'SUCCESS',meta:{scheme_code:101,scheme_name:'Renamed scheme',isin_growth:'inf000000001',isin_div_reinvestment:null},data:[{date:'01-01-2026',nav:'10'}]};
    expect(parseMfapiHistory(response,100,['INF000000001']).schemeCode).toBe(101);
    expect(()=>parseMfapiHistory(response,100,['INF000000002'])).toThrow(/ISIN identity did not match/);
    expect(()=>parseMfapiHistory({...response,meta:{...response.meta,isin_growth:null,scheme_name:'Exact same visible name'}},100,['INF000000001'])).toThrow(/different scheme code/);
  });
});

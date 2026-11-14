import { describe, expect, it } from 'vitest';
import { routePublicSourceUrl } from '../../src/app/sourceUrl';

describe('development public-source proxy URLs', () => {
  it('routes the AMFI NAV catalog and scheme master through same-origin paths', () => {
    expect(routePublicSourceUrl('https://portal.amfiindia.com/spages/NAVAll.txt', true, false))
      .toBe('/__fundscope_source/amfi-portal/spages/NAVAll.txt');
    expect(routePublicSourceUrl('https://portal.amfiindia.com/DownloadSchemeData_Po.aspx?mf=0', true, false))
      .toBe('/__fundscope_source/amfi-portal/DownloadSchemeData_Po.aspx?mf=0');
  });

  it('routes MFapi and AMFI disclosure endpoints while preserving query parameters', () => {
    expect(routePublicSourceUrl('https://api.mfapi.in/mf/120503', true, false))
      .toBe('/__fundscope_source/mfapi/mf/120503');
    expect(routePublicSourceUrl('https://www.amfiindia.com/api/populate-mf?active=1', true, false))
      .toBe('/__fundscope_source/amfi-www/api/populate-mf?active=1');
  });

  it('keeps Tauri, production, local, and unknown-host URLs unchanged', () => {
    const amfiUrl = 'https://portal.amfiindia.com/spages/NAVAll.txt';
    expect(routePublicSourceUrl(amfiUrl, true, true)).toBe(amfiUrl);
    expect(routePublicSourceUrl(amfiUrl, false, false)).toBe(amfiUrl);
    expect(routePublicSourceUrl('/config/local_overrides/disclosures.csv', true, false))
      .toBe('/config/local_overrides/disclosures.csv');
    expect(routePublicSourceUrl('https://example.com/catalog.json', true, false))
      .toBe('https://example.com/catalog.json');
  });
});

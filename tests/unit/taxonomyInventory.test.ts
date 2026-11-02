import { describe, expect, it } from 'vitest';
import inventory from '../fixtures/category-inventory.json';
import { classifyAmfiScheme } from '../../src/domain/taxonomy/classifyV3';

const report=inventory as unknown as {inventoryMode?:string;source?:string;activeCountsAvailable?:boolean;categories?:Array<{categoryRaw:string;structure?:'open'|'close'|'interval'|'unknown'}>;distinctCategoryCount?:number;schemeRowCount?:number;reportedPriorHeldOtherCount?:number;navAll?:{distinctCategoryStrings?:string[]};schemeMaster?:{distinctCategoryStrings?:string[]};amfiTer?:{categories?:string[]};amfiAaum?:{categories?:string[]}};
const categoryCases=report.inventoryMode==='live-amfi'?
  [...(report.navAll?.distinctCategoryStrings??[]).map(categoryRaw=>({categoryRaw,source:'AMFI_NAVALL' as const})),...(report.schemeMaster?.distinctCategoryStrings??[]).map(categoryRaw=>({categoryRaw,source:'AMFI_SCHEME_MASTER' as const})),...(report.amfiTer?.categories??[]).map(categoryRaw=>({categoryRaw,source:'AMFI_TER' as const})),...(report.amfiAaum?.categories??[]).map(categoryRaw=>({categoryRaw,source:'AMFI_AAUM' as const}))]:
  (report.categories??[]).map(item=>({categoryRaw:item.categoryRaw,structure:item.structure,source:'AMFI_NAVALL' as const}));

describe('AMFI category inventory coverage',()=>{
  it('retains inventory provenance and the distinct observed category set',()=>{
    expect(['offline-c0-reference','live-amfi']).toContain(report.inventoryMode);
    if(report.inventoryMode==='offline-c0-reference'){
      expect(report.activeCountsAvailable).toBe(false);
      expect(report.categories).toHaveLength(report.distinctCategoryCount);
      expect(new Set(report.categories?.map(item=>item.categoryRaw)).size).toBe(report.distinctCategoryCount);
      expect(report.schemeRowCount).toBe(14_441);
    }else{
      expect(report.activeCountsAvailable).toBe(true);
      expect(report.navAll?.distinctCategoryStrings?.length).toBeGreaterThan(0);
    }
  });

  it.each(categoryCases.map(item=>[item.categoryRaw,item.source,item.structure??'unknown'] as const))('has an explicit taxonomy rule or reason for %s from %s', (categoryRaw,source,structure)=>{
    const schemeMaster=source==='AMFI_SCHEME_MASTER'?{categoryRaw,closureDate:null}:null;
    const result=classifyAmfiScheme({categoryRaw,name:'',structure,navDate:20_000,newestNavDate:20_000,source,schemeMaster});
    expect(result.ruleId,'new AMFI labels must be mapped or given a specific reason code').not.toBe('AMFI_CATEGORY_UNMAPPED');
    expect(result.ruleId).toBeTruthy();
    expect(result.assetClass==='other'?result.reason:result.subCategory).toBeTruthy();
  });

  it('does not treat the historical 5,612-held baseline as a current result',()=>{
    if(report.inventoryMode==='offline-c0-reference'){
      expect(report.reportedPriorHeldOtherCount).toBe(5612);
      expect(report.source).toContain('no live data was fetched');
    }else{
      expect(report.reportedPriorHeldOtherCount).not.toBe(5612);
    }
  });
});

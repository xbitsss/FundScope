import { describe, expect, it } from 'vitest';
import type { Fund } from '../../src/domain/types';
import { activeFacetCount, applyFilters, defaultScreenerFilters, facetOptions, migrateSavedScreen } from '../../src/domain/screener/filters';

const fund = (code:number, values:Partial<Fund>):Fund => ({code,isinGrowth:null,isinReinvestment:null,name:`Fund ${code}`,amc:'AMC',category:'Category',assetClass:'equity',classRuleId:'RULE',taxonomyVersion:1,subCategory:'Flexi Cap',structure:'open',plan:'Direct',option:'Growth',nav:10,navDate:20_000,history:[],metrics:{},...values});
const funds=[fund(1,{}),fund(2,{plan:'Regular'}),fund(3,{option:'IDCW'}),fund(4,{plan:'Unknown'}),fund(5,{structure:'close',subCategory:'Closed only'}),fund(6,{structure:'interval',subCategory:'Interval only'})];

describe('screener filters',()=>{
  it('uses an exact Direct Growth Open default and never admits Unknown',()=>{expect(applyFilters(funds,defaultScreenerFilters,20_000*86_400_000).rows.map(item=>item.code)).toEqual([1]);expect(applyFilters(funds,{...defaultScreenerFilters,plan:['Unknown']},20_000*86_400_000).rows.map(item=>item.code)).toEqual([4]);});
  it('marks categories excluded by other active filters as disabled',()=>{const options=facetOptions(funds,defaultScreenerFilters,'categories',20_000*86_400_000);expect(options.find(item=>item.value==='Closed only')).toMatchObject({count:0,disabled:true});expect(applyFilters(funds,{...defaultScreenerFilters,categories:['Closed only']},20_000*86_400_000).rows).toHaveLength(0);});
  it('counts a multi-value facet once and migrates v1 selections',()=>{expect(activeFacetCount({...defaultScreenerFilters,categories:Array.from({length:22},(_,i)=>`Category ${i}`)})).toBe(1);expect(migrateSavedScreen({plan:'Both',option:'All',category:'One|Two'})).toMatchObject({plan:[],option:[],categories:['One','Two']});});
  it('keeps the funnel monotonic and ends at the matching rows',()=>{const result=applyFilters(funds,{...defaultScreenerFilters,categories:['Flexi Cap']},20_000*86_400_000);expect(result.funnel.every((step,index)=>index===0||step.remaining<=result.funnel[index-1].remaining)).toBe(true);expect(result.funnel.at(-1)?.remaining).toBe(result.rows.length);});
});

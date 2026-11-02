import type { AssetClass } from '../taxonomy/assetClass';
import type { NavPoint } from '../types';

export interface BenchmarkSeriesData{
  benchmarkId:string;
  displayName:string;
  assetClass:AssetClass;
  kind:'proxy'|'composite';
  returnBasis:'TRI';
  history:NavPoint[];
  fetchedAt:number;
}
export type BenchmarkSeriesById=Record<string,BenchmarkSeriesData>;

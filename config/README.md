# Data configuration

`benchmarks.json` maps exact FundScope sub-category labels to MFapi scheme codes used as benchmark proxies. It also supports `assetClassFallbacks`: currently, unmapped equity categories use a broad Nifty 500 comparator, which the UI labels as not category-matched. Current exact mappings cover large, mid and small cap funds and common diversified equity categories:

```json
{
  "subCategoryProxies": {
    "Large Cap": {
      "schemeCode": 119063,
      "schemeName": "HDFC Nifty 50 Index Fund - Direct Plan - Growth",
      "benchmarkName": "Nifty 50 TRI · HDFC index-fund NAV proxy"
    }
  }
}
```

These are free index-fund NAV proxies for their named TRI benchmarks, not official index TRI time series. Fund NAV returns include expenses and tracking differences. The app fetches history from MFapi on cache miss, stores it in the local `benchmark_series` table, refreshes the cache daily, and requires at least 200 exact-date aligned returns before regression metrics are shown. Add other sub-categories only after confirming the proxy's role, current activity, and benchmark fit. An unmapped sub-category returns `NO_BENCHMARK` and names the category in the detail view.

Place user disclosure overrides in `public/config/local_overrides/disclosures.csv`; expected headers are `scheme_code,aum_cr,ter_pct`. Rows use exact AMFI scheme codes.

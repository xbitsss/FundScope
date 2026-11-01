Place audited, code-keyed disclosure CSV files in this folder to override AMFI AUM or TER values during nightly refresh.

Use these headers:

```csv
scheme_code,aum_cr,ter_pct
```

Rows that do not match a current AMFI scheme code are ignored. Local override values are clearly marked as `LOCAL_OVERRIDE` in FundScope. Do not put credentials or personal information in these files.

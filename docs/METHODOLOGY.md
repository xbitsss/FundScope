# Methodology (MVP scaffold)

All dates are represented as UTC epoch-days in the domain layer. NAV return series only use observed Growth-option observations; IDCW/Bonus options are filtered from the default universe. Values that lack required history remain null and render as an em dash.

Fund asset class is assigned by the versioned AMFI taxonomy rules documented in [CLASSIFICATION.md](CLASSIFICATION.md). The classifier fails closed to `other` for unknown or ambiguous source labels; scheme names are consulted only for explicitly identified passive families. Peer-relative classification checks are flags only and never rewrite the binding class.

## Implemented now

- CAGR: `(ending NAV / starting NAV) ^ (365.2425 / observed days) - 1`; the first observed NAV on or after the target date is used. A window must span at least 360 days per requested year.
- Daily return: `NAV[t] / NAV[t-1] - 1`, included only when adjacent observations are no more than seven calendar days apart.
- Standard deviation: sample standard deviation of daily returns, annualized by `sqrt(252)`.
- Maximum drawdown: minimum `NAV / prior peak - 1` over the available loaded window. It is stored as a negative percentage; closer to zero is better in score direction.
- Historical VaR 95%: positive loss magnitude of the empirical fifth percentile of daily returns; lower is better.
- Sharpe: annualized daily mean excess over configured default 6.5% rate divided by annualized daily standard deviation. The 6.5% is a user-editable placeholder, not fetched market data.
- Sortino: annualized excess daily mean divided by the root mean square of negative daily returns, annualized by `sqrt(252)`.
- Semi-deviation: root mean square of negative daily returns annualized by `sqrt(252)`.
- Omega: sum of positive daily returns divided by absolute sum of negative daily returns, with zero as the current hurdle.
- Calmar: annualized arithmetic approximation of daily mean return divided by absolute maximum drawdown.
- Gain/loss ratio: mean positive daily return divided by absolute mean negative daily return.
- Tail risk ratio: absolute mean return in the lowest 5% of observations divided by mean daily return.
- Scoring: percentile rank within currently filtered funds, weighted by factor weights; missing factors are omitted from the fund denominator and weights renormalized.

Rolling consistency and the 3Y risk window selector are present in the metric catalogue/UI but still require full windowed calculations and risk-window wiring. They are not represented with fabricated values. Benchmark-relative metrics, TER and AUM remain explicitly unavailable per `DATA_SOURCES.md`.

## Limitations

The MVP currently computes NAV-only metrics when history exists. It does not apply a risk window to all risk calculations yet, and there is no benchmark proxy. Estimates based on sparse observations are intentionally not shown before at least 30 return observations exist.

# FundScope user guide

## Applied filters

The screener summary and the mobile filter sheet show the same applied-filter chips. Each chip represents one filter; when it lists several values, open the chip to remove a single value or clear the whole filter. On a narrow screen the summary shows up to two rows, with `+N more` to expand the list. On desktop it shows up to three rows. `Clear all` resets filters to the app's default screener and provides an Undo action for five seconds.

You can open a chip with Enter or Space, remove it with Delete or Backspace, and move between chips with the arrow keys. Filter changes are announced with the resulting count when the worker returns it.

## Compare → Scatter

Choose numeric metrics for the X and Y axes, then select a scope: compared funds, current screener results, the selected funds' sub-categories, or the first selected fund's asset class. Picker coverage is the number of funds in the scope with both the candidate metric and the other selected axis available. A metric with fewer than five paired observations is disabled unless it is already selected.

Metric direction controls what counts as better. Higher-is-better metrics favor values above their split; lower-is-better metrics favor values below it. The default split is the median of plotted funds. Mean, peer median, and custom splits are also available. Peer median is calculated as the median of each sub-category's median. Values exactly on a split line fall on the better side; when an axis has no preference, ties fall on the high side. If either axis has no preference, quadrant labels remain neutral and no Best/Avoid quadrant is named.

The Best quadrant is the corner that is favorable on both selected directions. The two mixed corners are trade-offs, and Avoid is unfavorable on both. This describes only the two displayed metrics and is not investment advice. `Best at top-right` reverses lower-is-better axes visually while retaining their true values in tick labels. The optional log scale applies only to AUM-sized metrics; non-positive observations are not plotted on a log axis. Outliers are clamped to the 1st–99th percentile view by default, but remain in the table and counts.

Missing metrics are excluded from the chart and counted with their reason. They are never estimated or imputed. Hover or tap a point to inspect values and ranks. The table view is sortable and virtualized; CSV and PNG exports are generated on this device.

## Data and limits

All displayed figures come from the FundScope data snapshot or local calculations based on available observations. A chart's scope, selected metrics, threshold rule, risk window, and data-as-of date are shown with the comparison. A missing value means the local data does not currently contain a verified value suitable for that calculation.

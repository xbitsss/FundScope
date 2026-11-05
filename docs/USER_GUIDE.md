# FundScope user guide

## Applied filters

The screener summary and the mobile filter sheet show the same applied-filter chips. Each chip represents one filter; when it lists several values, open the chip to remove a single value or clear the whole filter. On a narrow screen the summary shows up to two rows, with `+N more` to expand the list. On desktop it shows up to three rows. `Clear all` resets filters to the app's default screener and provides an Undo action for five seconds.

You can open a chip with Enter or Space, remove it with Delete or Backspace, and move between chips with the arrow keys. Filter changes are announced with the resulting count when the worker returns it.

## Compare → Scatter

The scatter shows only funds in your Compare tray (up to six), in tray order. A fund missing either selected metric stays in the selected-funds list with the reason and is excluded from the points. Nothing is estimated or imputed. Metric-picker coverage is counted among selected funds; metrics with no values in the current selection are disabled.

Metric direction controls what counts as better. The axes always retain their natural values: larger numbers go right and up. Higher-is-better metrics favor the high side; lower-is-better metrics favor the low side. Green marks the corner favorable on both axes, amber marks trade-offs, and red marks the corner unfavorable on both. If either axis has no configured or chosen preference, all quadrants stay neutral until you choose Higher or Lower. Values exactly on a split line fall on the better side; no-preference ties fall on the high side.

The default reference is the median of at least ten active, unselected funds with both values from the selected sub-categories. If fewer than ten category peers are available, the worker checks the selected asset classes. Peers provide only the split reference; they are never plotted. With too few peers, the split visibly falls back to median of at least three selected funds, mean of at least two, then a valid custom split. Each fallback is shown in the caption and notice. A single plotted fund can still be classified against a peer split or user-entered custom split. This describes only the selected metrics and is not investment advice. On phones the chart options open in a bottom sheet, and the table can scroll within its own region.

The chart is a single SVG, so axes, split lines, labels and points share one coordinate system. It plots only the funds in your Compare tray; each has a distinct marker and color. Hover, keyboard focus or tap a point to inspect its values and selected-sample ranks. The sortable table and CSV export are generated on this device. PNG export includes the visible chart and a legend with each plotted fund's X/Y values, quadrant, and data date. Date labels distinguish epoch-day NAV dates from millisecond source timestamps and show a dash for invalid or absent dates.

## Data and limits

All displayed figures come from the FundScope data snapshot or local calculations based on available observations. A chart's selected metrics, threshold rule, risk window, and data-as-of date are shown with the comparison. A missing value means the local data does not currently contain a verified value suitable for that calculation. Older saved Compare settings still load; removed scope and outlier preferences are discarded during migration.

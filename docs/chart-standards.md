# Chart standards

Use the Earnings chart as the layout reference for full-size dashboard charts. Reliability history follows the same pattern. Apply the [dashboard display standards](display-standards.md) to chart values, tooltips, and tables.

## Layout and controls

- Place the chart in a visible panel. Put the title and a small info button on the left, and date and grouping controls on the right. Let the controls wrap on narrow screens.
- Use **7 days**, **30 days**, **90 days**, **This year**, and **Custom** for time series. Default to **30 days**. Use shared date-range logic, show From and To inputs for Custom, and show the applied range above the plot. These ranges use UTC dates, end at today at the latest, and include both selected dates. Presets ending today include today in the day count. **This year** starts on 1 January.
- Put the series table below the plot. Give each line a labelled checkbox and a colour swatch that matches the line and tooltip. Where the default selection can show every device, do so. If a data source imposes a selection limit, make it clear. Keep the range, grouping, and line choices when changing fleet scope or refreshing data.
- Show loading, empty, and error states in the panel. Keep the previous plot visible while its replacement loads. Hide suspended devices by default and respect **Show suspended**.

## Data and interaction

- Match the x-axis to the timestamps we have. Earnings use Vast's UTC billing days. Reliability uses individual saved snapshots so a dip and recovery on the same day both appear. Leave missing observations as gaps. For reliability, break the line across gaps longer than 15 minutes. A reported zero remains a data point.
- Hover or tap to inspect the nearest plotted time. Show the date or timestamp, the unit, and a matching swatch and value for each visible series with a reading. List readings highest first. Provide keyboard access to the same readings and let Escape dismiss the tooltip.
- Label totals, units, and denominators. Put **Hours** or **Est. GPU-hours** before **Period total** when a table shows an hourly average. Display the measured denominator and calculate with its full precision. Explain the basis of estimates and the treatment of partial days in the info panel.
- Keep inline Market histograms compact. Related rows share the same price and count scales. Count each sampled host once per row, show the price band and host count on hover, and use the same estimated host units as the surrounding table.

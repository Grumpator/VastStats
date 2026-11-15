# Dashboard display standards

## Numbers and time

| Value | Display |
| --- | --- |
| Percentages | One decimal place everywhere, including reliability, occupancy, coverage, and market utilisation. Use the shared formatters in `public/model.js`. Show `<100.0%` when reliability or coverage rounds to 100.0% but is below it. |
| Currency | Use USD with a dollar sign and normally two decimals. Keep extra precision for small or closely spaced rates when it helps comparison. Label rate units explicitly, such as `$/h`, `$/day`, `$/GPU-h`, `$/GB-month`, and `$/GB`. Distinguish the host ask, estimated host rate, renter quote, and booked rate. |
| Durations | Use hours and minutes, such as `2 h 15 min`, `45 min`, or `<1 min`. Reuse `duration` from `public/device-info.js`. The compact Worked column uses `2h 15min`. Keep full precision for calculations. |
| Dates and times | Use Europe/London for fleet and occupancy timestamps. Use UTC for Vast billing dates and the shared Earnings and Reliability chart ranges. Make the timezone clear where it matters. Use **This week** and **This month** for current calendar periods. |
| Missing data | Use an em dash for unavailable values and a numeric zero for a measured zero. Use the waiting icon for pending earnings with its explanation in the info popover. |

Use the shared numeric typography and `--number-font` for table values. Keep numeric columns right-aligned and use tabular digits throughout the dashboard.

## Icons and states

- Reuse `public/ui.js` and `public/device-state.js` for shared icons. Use the Vast verification badge, thumbs-up for reliability, spanner for maintenance, layers for stored instances, and chip for GPUs. Overview tiles show the verification badge only for verified devices.
- For the primary device state icon, use offline first, then running, listed, and online. Keep maintenance visible as a separate status. Give icon controls accessible names and make their labels available on touch and keyboard.
- Overview tile colours identify listed, maintenance, and unlisted devices using green, amber, and grey. Running uses activity bars. Offline uses a pulse with red for listed devices and the existing amber or grey for maintenance or unlisted devices. Provide static indicators with reduced motion.
- In Occupancy, use green for observed running time, amber for observed idle time, and grey for missing coverage. An amber dot marks incomplete coverage. Borders show recorded device state, and the number inside a circle counts runs in that interval.
- Use the existing info popover for explanations, with a close button and dismissal on outside click. Keep essential labels and values visible. Put units, definitions, and collection details in the popover when they would otherwise crowd the page.

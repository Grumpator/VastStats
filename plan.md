# Fleet pages plan

Status: shared navigation, Occupancy rename and first Earnings pills implemented locally for review. Market and Settings have placeholders; their full implementations are deferred to TODO.md.
Work locally for review; do not push or deploy until requested.

## Scope

Retain the fast cached history views and existing Overview behaviour. Organise the application into Overview, Occupancy, Earnings, Market and Settings. Multi-user support and API-call optimisations remain parked in TODO.md.

## 1. Shared header and navigation

- [x] Replace the variable "Fleet overview" / "Fleet details" text and separate navigation with a single consistent layout:

  `VastStats    Fleet: Overview / Occupancy / Earnings / Market / Settings`

- [x] Treat the page names as links, with the active link highlighted and marked with `aria-current="page"`. Do not repeat the current page name beside the brand.
- [x] Share header markup/rendering and styling across pages. Keep the brand, Fleet label and link positions stable when switching pages.
- [x] Keep the current freshness indicator, with freshness appropriate to each page's data source.
- [x] On narrow screens, put the same navigation in a predictable second row or locally scrollable strip; avoid page-wide horizontal overflow or changing the layout based on the active page name.
- [x] Use distinct browser titles, e.g. `VastStats · Occupancy`.

## 2. Overview and Occupancy

- [x] Keep Overview as the landing page at `/`, with adaptive device tiles and a quick fleet summary.
- [x] Rename Details to Occupancy, including page title, links, tooltips, accessibility labels and README references.
- [x] Use `/occupancy.html`; update links from Overview tiles and period readings. Provide a lightweight redirect from `/details.html` preserving device/period/demo query parameters to avoid breaking existing bookmarks.
- [x] Preserve 24h, calendar Week, calendar Month and calendar Year, navigation limits, drill-down, fixed device columns and timeline scrolling.
- [x] Preserve precomputed summaries, browser caching, recorded status evidence, occupancy/coverage definitions and separate Now freshness.

## 3. Earnings: verify the data contract

Verified live on 7 November 2026: the updated key reads earnings. Requests for 1, 6 and 24 hours all returned the same whole-day window with integer sday/eday. The user selected Today / Week / Month. The latest report contains no row for the current UTC day yet; show unreported rather than zero.

- [x] Check the existing key's access to host earnings when Earnings implementation starts. Request only the required read permissions if access is missing; no write permission is needed for reports.
- [x] Use Vast's historical machine-earnings report for money earned. Keep existing contract-based current rates separate; never reconstruct past earnings from today's prices.
- [ ] Validate the response schema, currency, fee basis, reporting delay, machine mapping, date boundaries and current-day completeness against actual API responses.
- [x] Occupancy keeps Europe/London periods from `public/periods.js`. Earnings uses UTC billing days from `public/earnings-model.js`, with Today / Monday-start Week / calendar Month. Reported money is kept separate from the current hourly rate.
- [x] Verify whether the earnings endpoint honours sub-day boundaries. The API docs describe day parameters, while the official CLI passes fractional Unix-day values. Do not assume that daily report rows prove hourly precision.
- [x] The user selected Today / Week / Month after whole-day rounding was verified. Do not label Today as 24h or apportion daily income across hours.
- [x] Initially include compute and storage, excluding bandwidth as previously agreed. Do not add a commission adjustment without evidence that the source amounts require one.
- [x] Convert the upstream response to a strict public earnings DTO. Do not forward account contact details, address, tax information, balances or private Vast IDs returned alongside the earnings report.
- [x] Cache reports on the server, retain the last successful values on failure, and keep earnings collection from blocking status or historical-occupancy publication. Reuse existing current-rate data rather than introducing more per-device contract polling.

## 4. Earnings: first visible delivery

- [x] Add `/earnings.html` with the shared header.
- [x] First pill: **Earned**, with **Today / Week / Month** amounts in the same composite arrangement as Overview occupancy. No Year figure in this pill. Earnings use UTC billing days, independently of Occupancy’s Europe/London periods.
- [x] Second pill: **Current rate**, showing `$X.XX / hour` from current running contracts and allocated storage.
- [x] Touch/hover explanations distinguish recorded earnings from the current rate and show compute/storage breakdowns and the last successful report time.
- [x] Show unavailable or delayed data honestly; no fabricated zeros, extrapolated past earnings, or implied guaranteed future income.
- [x] Keep the first version focused on these pills. Add daily compute/storage charts, a period selector and per-device earnings breakdown only after this first delivery has been reviewed.
- [ ] Confirm how earnings should be exposed on the deployed public site before publishing additional financial information.

## 5. Market (deferred; placeholder only)

- [x] Add the shared navigation and a simple Market placeholder; full implementation is in TODO.md.

- [ ] Add `/market.html`, initially read-only and grouped by GPU type.
- [ ] Verify the GPU metrics endpoint's live schema and definitions for available/rented supply, usage and price percentiles.
- [ ] Show our GPU count and pricing beside market supply and price distribution, with a clear observation timestamp and comparison filters.
- [ ] Use comparable offer searches for region, verification, CPU architecture, GPU count, reliability and storage/network characteristics. Exclude our own fleet from the competitor cohort.
- [ ] Normalise prices per GPU and use a consistent host/renter fee basis. Do not compare net host contract rates directly with marked-up renter prices.
- [ ] Distinguish asking prices from actual contract rates. Do not label market GPU usage as directly equivalent to our box-time occupancy.
- [ ] Fetch/cache shared market snapshots independently of page views; avoid one identical market query per device.
- [ ] Pricing recommendations and all automated price changes are out of the first version.

## 6. Settings and device inclusion (deferred; placeholder only)

- [x] Add the shared navigation and a simple Settings placeholder; full implementation is in TODO.md.

- [ ] Add `/settings.html` for the current single operator/account.
- [ ] Identify devices by existing stable private device keys; names remain display labels.
- [ ] Define three separate operations before implementing controls:
  - Hidden: display preference, with no change to statistics.
  - Retired from a date: stop including the device in the current estate and future collection while retaining its earlier contribution and saved history.
  - Excluded: explicitly remove a device/date range from relevant statistics; show when exclusions are active.
- [ ] Store settings atomically under DATA_DIR, outside application files, so upgrades preserve them. Never delete collected history when hiding, retiring or excluding a device.
- [ ] Apply inclusion rules consistently to fleet pills, Occupancy, Earnings and Market comparisons, including archived/retired devices where historically relevant.
- [ ] Keep time before available history and future time excluded as today; do not invent historical listing/offline intervals to fill gaps.
- [ ] Protect settings writes with a single-operator authentication mechanism before enabling them on an internet-accessible deployment. A public Settings link must not imply unauthenticated write access. This is separate from deferred multi-user accounts/workspaces.
- [ ] Show connection/permission health, collection freshness and data coverage without displaying API keys.

## 7. Validation and review order

- [ ] Deliver/review the shared header and Occupancy rename first.
- [ ] Deliver/review the Earnings pills next, after live earnings semantics and permissions are confirmed.
- [ ] Deliver Market and Settings in separate reviewable steps; avoid populating placeholder pages with invented data.
- [ ] Test period boundaries, daylight saving changes, missing/delayed reports, failed refreshes, current-rate versus earned-money separation, exclusions and settings persistence.
- [ ] Test header/link positions, keyboard navigation, mobile layouts and the existing fixed timeline headers on each page.
- [ ] Retain the existing cache/episode-count tests and verify view switching remains fast.
- [ ] Run appropriate tests, review local screenshots and update the README for each completed step. Leave commits/pushes/releases to explicit requests.

## Deferred audit-log investigation

The read-only request to `/api/v0/audit_logs/` returned HTTP 401 with the current local key; a machines request returned HTTP 200, confirming the key remains valid for its existing scope. Actual account log contents, retention and completeness have not been inspected. Per user request, further investigation is parked in TODO.md.

The official CLI displays `created_at`, `api_route`, `args`, `ip_address` and `api_key_id`. Listing/unlisting requests and their arguments could help only if present, successful and sufficiently complete; API-access logs do not themselves establish machine offline periods. Do not assume a request was successful or reconstruct a continuous state from an incomplete audit trail.

## References

- [Vast earnings report](https://docs.vast.ai/api-reference/billing/show-earnings)
- [Official CLI implementation (earnings and audit logs)](https://github.com/vast-ai/vast-cli/blob/master/vast.py)
- [GPU market metrics](https://docs.vast.ai/api-reference/machines/show-gpu-metrics)
- [Account audit-log command](https://docs.vast.ai/cli/reference/show-audit-logs)

## Shared summary and info refinement

- [x] Add shallow current occupancy (running boxes / all boxes), earnings/hour and running-box pills below the header on every page.
- [x] Keep historical/page-specific pills below that shared row; remove duplicate current-rate and running pills.
- [x] Use one fixed popover component for all info controls and guides: close button, outside click, Escape, keyboard focus and internal guide scrolling.
- [x] Put routine timestamps and explanations behind info controls instead of inline panels.
- [x] Use an amber waiting icon for unreported earnings, with a clickable explanation.

## Earnings graph refinement

- [x] Shared row order: running now, earnings/hour, earned today.
- [x] Full-width Earnings period pills with GPU, bandwidth and storage splits; total includes all three.
- [x] Move Occupancy period selector below its pills.
- [x] Daily chart: 7/30/90 days, year and custom ranges; source or machine grouping; selectable lines and whole-fleet total; daily hover/tap breakdowns.
- [x] Cache one year of fleet daily reports and progressively backfill shared daily machine matrices, without blocking page interaction.
- [x] Account for verified API quirks: whole UTC days, inclusive end date, and unfiltered per_day rows despite machid. Keep private IDs server-side.

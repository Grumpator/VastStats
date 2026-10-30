# VastStats v3

A public Vast fleet dashboard built from historical container-running intervals. The live Pages site deploys from `main`; the previous snapshot-based dashboard and its data are preserved on [`v1`](https://github.com/Grumpator/VastStats/tree/v1).

## Data flow

1. GitHub Actions reads current machine state and obtains a short-lived telemetry token using a private Vast API key.
2. It queries container history and reporting samples, unions simultaneous running intervals, and builds hourly summaries plus daily run counts. Missed collector runs can be backfilled from the API.
3. Only public box names, timestamps, counts, durations and sanitized state snapshots are committed. Raw instance/machine IDs, tokens, API responses, hostnames and IPs stay private.
4. The page loads the index and the per-box/month files required by the visible date window. No API key reaches the browser.

The current month is reconciled with a three-day overlap before the latest imported telemetry. Initial imports recover all available months, up to a ten-year safety limit. Completed months remain stored; the preceding month is also reconciled during the first seven days of the next month for late uploads. A manual full rebuild is available. Previously recovered hours are retained when a later response has less coverage, including after an upstream recording-format change.

This is the GitHub-only variant: it stores compact API-derived summaries and refreshes them periodically. Anonymous page loads do not call the private Vast API directly. A truly stateless on-demand version would require a serverless proxy to protect the key.

## Configure access

In GitHub **Settings → Secrets and variables → Actions**, set these **repository secrets**:

- `VAST_API_KEY`: create a Vast key in Advanced mode using [config/vast-api-permissions.json](config/vast-api-permissions.json). Machines/read and User/read restricted to the telemetry-token GET route were verified on all three boxes. Billing and write permissions are not needed.
- `VAST_BOX_MAP`: your private machine-ID to public-name map, such as `{"123":"Alpha","456":"Beta"}`. Public names must be unique ignoring case and contain only letters, numbers, spaces, underscores or hyphens, beginning with a letter (24 characters maximum). Keep real IDs in the secret.

Run **Actions → Collect API history → Run workflow**, choosing the appropriate branch. Select **rebuild** to reconcile every available month. The schedule requests one refresh per hour, at minute 17; GitHub may delay or skip triggers. Historical backfilling avoids the requirement to capture consecutive five-minute snapshots. This does not guarantee live freshness.

The workflow commits only `public/data/` and uses GitHub's built-in job token. No inbound ports, VPS or GitHub key on a box are needed. The collector has no Pages deployment permission.

## Files

- `public/data/index.json`: fleet names, current snapshots, available month names, refresh/failure information and telemetry watermarks.
- `public/data/Alpha/2026-10.json`: one box/month of hourly aggregates, daily run counts, hourly run-start/boundary counters and explicitly observed state snapshots. Other names/months follow the same layout.
- `config/vast-api-permissions.json`: permission configuration only, never a credential.

The generated data files are intentionally public. They disclose fleet occupancy and instance counts. Never put raw responses or a private map in this repository.

The previous calendar dashboard is preserved in the [`v2` branch](https://github.com/Grumpator/VastStats/tree/v2) and immutable `v2` tag. The single-layout timeline is released as `v3` (page version 3.2.3).

## Reading the dashboard

- **Timeline:** one row per device, with as many circles as fit and no horizontal scrolling. Hours / Days / Weeks / Months select the duration of each circle; weeks start Monday and months follow the calendar. Previous/Next flank the range below the summaries and move by exactly one visible window, using the number of circles that fit the current screen. Today sits on the same row and returns to the current period; there is no separate date picker. Today includes the current hour/period. Summary and device statistics describe that window. Status icons use shared columns across devices, and weekly headers show ISO week numbers and week-years. The table has matching 12px gaps to the horizontal lines above and below.
- **Circle sectors:** green = confirmed running time, amber = confirmed idle time, grey = unknown elapsed time, clockwise from noon. The denominator is elapsed time in the selected circle period, excluding future time. An amber dot marks any incomplete coverage (apart from floating-point noise). A full green circle requires both complete coverage and continuous running. Tooltip, summary and device occupancy percentages use running / observed time. Missing telemetry is excluded rather than treated as idle, so delayed data alone does not reduce occupancy. Circle sectors still use elapsed tracking time and retain a grey unknown sector; read occupancy alongside coverage.
- **Number:** running sessions during the circle period. One instance stopping and restarting counts as two runs. A continuous run counts once in each circle it overlaps; daily counts are calculated from the intervals, not by summing hourly counts. Back-to-back runs can produce solid green with a count greater than one. Idle observed periods show zero; unavailable history is blank. Weekly/monthly counts use runs already active at the boundary plus new starts; a continuous run is counted once and stop/start episodes count separately. Stored counts remain in the Now summary.
- **Ring:** the current hour/day/week/month. A fresh machine snapshot can show state before duration data arrives; it does not supply historical occupancy or the circle's run count.
- **Border:** red offline, amber maintenance, grey unlisted, green listed, in that priority order. Borders indicate states explicitly captured in that period's snapshots. Unknown historical state is neutral. Container history alone does not establish historical listing/maintenance/offline duration.
- **Occupancy:** union of running intervals divided by reported coverage. Two simultaneous rentals do not double-count a box's time. **Hours:** the same union duration summed across boxes.
- **Now:** current Running/Stored counts, independent of historical navigation. Stored includes running and stopped instances. GB allocated is Vast's allocated disk total, not actual file usage.
- **Before tracking:** the collector retains the earliest known archive boundary (`historyStart`). Time before it is excluded from per-device/fleet coverage and circle fill denominators, and full slots show a dash. This is earliest available history, not proof of the first boot. The boundary never advances on later imports or metadata failures, so later missing telemetry remains missing. A partly tracked first hour/day/week/month counts only its tracked portion.
- **Drill down:** click circles to move Months → Weeks → Days → Hours. The date is set to the clicked period, with its latest elapsed detail visible. Hover/focus retains details; hourly circles retain tap-to-show.
- **Data coverage:** reported telemetry sampling intervals divided by elapsed box-time in the selected period. Raw samples contribute one second; native aggregate buckets up to five minutes are accepted. Coarser buckets, missing samples, and approximate/fragmented container spans stay unknown.

Hardware sample presence is used only to identify reporting coverage, not GPU utilisation. CPU/memory measurements themselves are discarded. Container state is sampled by Vast, so these figures are not billing-grade accounting.

## Freshness and limitations

Vast uploads telemetry in batches. Current machine state and historical telemetry may have different timestamps; a successful refresh does not prove recent running history has arrived. Metadata `extent.end` may represent the query clock, so watermarks use actual reporting samples and are capped at the latest container observation while a container remains open. A trailing hardware bucket must not turn an unobserved running tail into idle time or erase its stored count. See [the API investigation](docs/telemetry-history-investigation.md).

Each device row shows its name, current-state icons and selected-period occupancy on one line. Icons follow the Now summary order: running instances (play/pause plus count), listing (tag), connection (power), maintenance (spanner, or clock for planned maintenance), stored instances (layers plus count), then GPU count (chip). Green means active, red means offline and amber means maintenance; a slash marks an inactive state. Hover an icon for its label. The info button opens snapshot time, history watermark, observed time and coverage, and works by tap or keyboard too. These are latest machine-state snapshots, not live connections. With hourly collection, updates are flagged overdue after 90 minutes: icons fade, the info button turns amber and details show the overdue timestamp. Last known values remain visible. The page does not have a private live-status endpoint.

A running machine snapshot does not establish occupancy throughout an hour or day. Grey circles mean historical coverage has not arrived; they can coexist with a running-instance icon. As new API history arrives, collection backfills those circles. Solid green requires complete coverage and running throughout the elapsed portion; partial coverage leaves a grey unknown sector and the amber marker.

Run counting joins overlapping duplicate API records and open continuations at query boundaries. Separate stop/start episodes remain separate, even for the same instance. Raw identifiers are used only in memory; the public files contain counts, never instance identifiers. Counts cover observed running intervals and may increase when missing telemetry arrives.

API errors retain existing summaries and mark the affected box's history as unavailable to refresh. API rate limits have bounded retries. A failure for every box fails the run visibly. Historical idle coverage is based on reporting samples, and absence of a container alone does not produce observed time.

Vast can restart its recording history after format-changing updates. Saved month summaries preserve already recovered hours. Truly immutable, exact billing history or historical disk usage is not promised.

The **Inspect Vast history API** diagnostic workflow remains separate from collection. It exports only schemas and aggregate counts. No raw telemetry is uploaded as an Actions artifact.

## Page deployment

Use **Settings → Pages → Source: GitHub Actions**. **Deploy dashboard** publishes page code on changes to `public/`, ignoring `public/data/`. Data-only refreshes do not redeploy Pages. The public page resolves `main` through GitHub's public ref API at most once every five minutes, then reads the index and months using that exact commit's immutable raw-file URLs. This avoids stale branch caches and mixing files from different commits. No GitHub credential reaches the browser. If a later ref lookup fails or is rate-limited, the last resolved commit remains available; initial lookup failure is shown as a load error.

## Local development

Node 24+, no dependencies or build step:

```sh
npm test
npm run preview
```

Open http://127.0.0.1:4173/ after importing data, or use `?demo=1` for clearly labelled illustrative history. Demo data never overwrites real summaries. Local preview reads local files; the published page reads sanitized repository files.

Version **v3.2.3** appears in the footer. Keep package version, visible version and browser asset queries in sync when changing page code. Tests cover privacy, retry behavior, interval unions, missing/approximate data, failed refresh preservation, period selection and daylight-saving boundaries.

The info button beside Hours/Days/Weeks/Months opens the dashboard guide, including the current circle resolution, occupancy and border legend, run counting and marker explanations. These stay hidden until requested.

Top summaries are separated into Visible period (occupancy, running box-hours and coverage) and Now (latest snapshot totals). Running, Listed, Online and Maintenance are box counts / total boxes. Running additionally shows instance count; Stored shows total retained instances and allocated GB. Unknown inputs produce a dash, not an assumed zero. Overdue snapshots are marked. The guide separates occupancy fills and state borders into two legend rows.

Device headers also show a chip icon with total GPUs from Vast’s `num_gpus` machine field ([official CLI machine fields](https://github.com/vast-ai/vast-cli/blob/master/vast.py)). Only the count is published; GPU identifiers and models are excluded. Unknown counts show ? until a snapshot supplies the field. Multiple GPUs can support separate instances or be rented together; existing occupancy remains box-time with at least one running rental, not percentage of GPU capacity.

Coverage calculation revision 4 aligns telemetry requests to a 32-second power-of-two grid (2,700 points/day, below the API’s 4,000-point cap). Previously, requesting 5,760 points/day caused a 21.6-second output grid, shifting native 128-second bucket timestamps and inventing 1–2 second gaps: a complete day incorrectly appeared about 98.8% covered. Aligned queries preserve missing native buckets and raw-sample gaps; query padding is clipped to elapsed time. A revision change automatically reimports all available months. Coverage remains bucket-based evidence, not proof that every individual second was sampled.

The amber incomplete-data dot marks every observed circle below 100% coverage of its elapsed portion, with only a 1e-9 tolerance for floating-point noise. It no longer uses the former 95% threshold. Fully unknown grey circles and future periods do not need the dot. Coverage just below 100% displays <100% if one-decimal rounding would hide the gap.

For example, Beta 27 October at 18:00 has 1,888 observed seconds and 1,858 running seconds: the circle is 51.6% green, 0.8% amber and 47.6% grey. The tooltip shows 98.4% occupancy within observed time and 52.4% coverage. Unknown time is never presented as confirmed idle or running time.

Circle tooltips show occupancy with running duration, runs and data coverage. Additional status rows show timestamped offline, maintenance and unlisted sightings. Listed sightings are omitted to keep the tooltip focused on exceptions. These are observations, not durations; the latest relevant sighting is shown. Known maintenance schedules are labelled separately when no active maintenance sighting exists. Unavailable state history is omitted rather than labelled Unknown or assumed zero.

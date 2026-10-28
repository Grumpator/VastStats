# VastStats v2

A public Vast fleet dashboard built from historical container-running intervals. The live Pages site deploys from `main`; the previous snapshot-based dashboard and its data are preserved on [`v1`](https://github.com/Grumpator/VastStats/tree/v1).

## Data flow

1. GitHub Actions reads current machine state and obtains a short-lived telemetry token using a private Vast API key.
2. It queries container history and reporting samples, unions simultaneous running intervals, and builds hourly summaries plus daily run counts. Missed collector runs can be backfilled from the API.
3. Only public box names, timestamps, counts, durations and sanitized state snapshots are committed. Raw instance/machine IDs, tokens, API responses, hostnames and IPs stay private.
4. The page loads the index and the per-box/month files required by the selected week, month or year. No API key reaches the browser.

The current month is reconciled with a three-day overlap before the latest imported telemetry. Initial imports recover all available months, up to a ten-year safety limit. Completed months remain stored; the preceding month is also reconciled during the first seven days of the next month for late uploads. A manual full rebuild is available. Previously recovered hours are retained when a later response has less coverage, including after an upstream recording-format change.

This is the GitHub-only variant: it stores compact API-derived summaries and refreshes them periodically. Anonymous page loads do not call the private Vast API directly. A truly stateless on-demand version would require a serverless proxy to protect the key.

## Configure access

In GitHub **Settings → Secrets and variables → Actions**, set these **repository secrets**:

- `VAST_API_KEY`: create a Vast key in Advanced mode using [config/vast-api-permissions.json](config/vast-api-permissions.json). Machines/read and User/read restricted to the telemetry-token GET route were verified on all three boxes. Billing and write permissions are not needed.
- `VAST_BOX_MAP`: your private machine-ID to public-name map, such as `{"123":"Alpha","456":"Beta"}`. Public names must be unique ignoring case and contain only letters, numbers, spaces, underscores or hyphens, beginning with a letter (24 characters maximum). Keep real IDs in the secret.

Run **Actions → Collect API history → Run workflow**, choosing the appropriate branch. Select **rebuild** to reconcile every available month. The schedule requests one refresh per hour, at minute 17; GitHub may delay or skip triggers. Historical backfilling avoids the requirement to capture consecutive five-minute snapshots. This does not guarantee live freshness.

The workflow commits only `public/data/` and uses GitHub's built-in job token. No inbound ports, VPS or GitHub key on a box are needed. V2 branch collection writes to that branch only. The collector has no Pages deployment permission.

## Files

- `public/data/index.json`: fleet names, current snapshots, available month names, refresh/failure information and telemetry watermarks.
- `public/data/Alpha/2026-10.json`: one box/month of hourly aggregates and explicitly observed state snapshots. Other names/months follow the same layout.
- `config/vast-api-permissions.json`: permission configuration only, never a credential.

The generated data files are intentionally public. They disclose fleet occupancy and instance counts. Never put raw responses or a private map in this repository.

## Reading the dashboard

- **Week:** one square per actual hour, starting Monday. London clock-change days have 23 or 25 squares.
- **Month / Year:** one square per day. Percentages and Hours use the selected period and only available telemetry. Missing history and future time do not count as idle.
- **Solid green:** running throughout reported coverage. **Green/white hatching:** running for part of it. **White:** no running intervals during reported coverage. **Grey:** unknown. A small corner dot indicates less than 95% coverage of elapsed time.
- **Number:** running sessions that overlap the reported part of the hour/day. One instance stopping and restarting counts as two runs. A continuous run counts once in each square it overlaps; daily counts are calculated from the intervals, not by summing hourly counts. Back-to-back runs can produce solid green with a count greater than one. Idle observed periods show zero; unavailable history is blank. Stored counts remain in the Images pill.
- **Ring:** the current hour/day. A fresh machine snapshot can show state before duration data arrives; it does not supply historical occupancy or the square's run count.
- **Border:** red offline, amber maintenance, grey unlisted, green listed, in that priority order. V2 borders indicate states explicitly captured in that period's snapshots. Unknown historical state is neutral. Container history alone does not establish historical listing/maintenance/offline duration.
- **Occupancy:** union of running intervals divided by reported coverage. Two simultaneous rentals do not double-count a box's time. **Hours:** the same union duration summed across boxes.
- **Images:** current Running/Stored counts, independent of historical navigation. Stored includes running and stopped instances. GB allocated is Vast's allocated disk total, not actual file usage.
- **Data coverage:** reported telemetry sampling intervals divided by elapsed box-time in the selected period. Raw samples contribute one second; native aggregate buckets up to five minutes are accepted. Coarser buckets, missing samples, and approximate/fragmented container spans stay unknown.

Hardware sample presence is used only to identify reporting coverage, not GPU utilisation. CPU/memory measurements themselves are discarded. Container state is sampled by Vast, so these figures are not billing-grade accounting.

## Freshness and limitations

Vast uploads telemetry in batches. Current machine state and historical telemetry may have different timestamps; a successful refresh does not prove recent running history has arrived. Metadata `extent.end` may represent the query clock, so watermarks use actual reporting samples and are capped at the latest container observation while a container remains open. A trailing hardware bucket must not turn an unobserved running tail into idle time or erase its stored count. See [the API investigation](docs/telemetry-history-investigation.md).

Device badges are machine-state snapshots, not live connections. Each card shows the snapshot time separately from its historical telemetry watermark, including whether a rental was running at that check. With hourly collection, updates are flagged overdue after 90 minutes. Last known connection/listing values remain visible and are labelled “Last seen” rather than being erased. The page does not have a private live-status endpoint.

A running machine snapshot does not establish occupancy throughout an hour or day. Grey squares mean historical coverage has not arrived; they can coexist with “Running at last check”. As new API history arrives, collection backfills those squares. Solid green requires running throughout the observed portion, with the incomplete-data marker if coverage is partial.

Run counting joins overlapping duplicate API records and open continuations at query boundaries. Separate stop/start episodes remain separate, even for the same instance. Raw identifiers are used only in memory; the public files contain counts, never instance identifiers. Counts cover observed running intervals and may increase when missing telemetry arrives.

API errors retain existing summaries and mark the affected box's history as unavailable to refresh. API rate limits have bounded retries. A failure for every box fails the run visibly. Historical idle coverage is based on reporting samples, and absence of a container alone does not produce observed time.

Vast can restart its recording history after format-changing updates. Saved month summaries preserve already recovered hours. Truly immutable, exact billing history or historical disk usage is not promised.

The **Inspect Vast history API** diagnostic workflow remains separate from collection. It exports only schemas and aggregate counts. No raw telemetry is uploaded as an Actions artifact.

## Page deployment

Use **Settings → Pages → Source: GitHub Actions**. **Deploy dashboard** publishes page code on changes to `public/`, ignoring `public/data/` and the legacy data filename. Data-only refreshes do not redeploy Pages. The public page resolves `main` through GitHub's public ref API at most once every five minutes, then reads the index and months using that exact commit's immutable raw-file URLs. This avoids stale branch caches and mixing files from different commits. No GitHub credential reaches the browser. If a later ref lookup fails or is rate-limited, the last resolved commit remains available; initial lookup failure is shown as a load error.

## Local development

Node 24+, no dependencies or build step:

```sh
npm test
npm run preview
```

Open http://127.0.0.1:4173/ after importing data, or use `?demo=1` for clearly labelled illustrative history. Demo data never overwrites real summaries. Local preview reads local files; the published page reads sanitized repository files.

Version **v2.1.1** appears in the footer. Keep package version, visible version and browser asset queries in sync when changing page code. Tests cover privacy, retry behavior, interval unions, missing/approximate data, failed refresh preservation, period selection and daylight-saving boundaries.

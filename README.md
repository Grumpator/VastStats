# VastStats

A public, static Vast rental dashboard. No box is contacted by the website or GitHub Actions. No inbound ports or VPS are required.

## Enable the page

In this repository's **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source. The Deploy dashboard workflow publishes only `public/` when page code changes on `main`; data-only commits do not deploy.

Expected address after the first successful deployment: https://grumpator.github.io/VastStats/

## Connect the data

In **Settings → Secrets and variables → Actions**, add two repository secrets:

- `VAST_API_KEY`: a Vast account API key authorized to read your hosted machines. Use the narrowest available permissions. Never put the key in files, Issues, or browser JavaScript.
- `VAST_BOX_MAP`: a JSON object mapping your private numeric machine IDs to public names, for example `{"123":"Alpha","456":"Beta","789":"Gamma"}`. Substitute your actual IDs. This map remains in GitHub Secrets, not in the published source or data.

Then open **Actions → Collect fleet data → Run workflow**. First collection records a starting observation; the next successful check starts filling the grid. Collection also runs when collector code or tests change. Without secrets the page still deploys with an empty history and an explicit waiting message. Keep both values in repository secrets: the map links private machine IDs to public names, and variables are not masked in logs.

Use **Machines / read-only** permission for the API key. No User, Instances, Billing or Misc permissions are required by the current collector. Collection runs on GitHub, never on the boxes, so a box outage does not stop polling. Data commits use the `VastStats collector` author and GitHub's built-in job token; no personal GitHub key is needed on any box.

GitHub Actions is configured to check every five minutes, using explicit minute values in the schedule. This is a requested cadence, not a guarantee: scheduled runs can be delayed or skipped. On 27 October 2026, only four scheduled runs were created over approximately twenty hours; changing to explicit minutes is a scheduling troubleshooting step, not a verified fix. Check runs with the `schedule` event separately from pushes and manual reruns. The collector logs its timestamp and the gap since the preceding collection. Consecutive observations at most 12 minutes apart integrate the previous state until the next observation. Larger gaps remain unknown. GitHub can disable scheduled workflows in public repositories after 60 days without activity; data commits normally provide activity, but failures should be checked if updates stop. No historical occupancy is inferred from today's state.

## Collection and deployment

Two independent workflows handle updates. **Collect fleet data** runs on the schedule, manually, or when collector code/tests change. It reads Vast and commits sanitized summaries; it has no Pages deployment permissions. Collection failures now fail that run visibly while preserving the previous data. **Deploy dashboard** runs when page files change or manually; it ignores data-only changes and does not need Vast secrets.

The public page refreshes JSON from the public repository's raw-file URL every minute. This avoids redeploying the site for data updates. GitHub's raw-file caching can delay visibility; a cache-disabled browser request does not guarantee immediate CDN freshness. Local preview uses the local data file. The copy of data bundled in a Pages deployment is a snapshot, not the live public data source. Collection and raw data remain hosted by GitHub.

## Reading the dashboard

- **Week:** one square per actual hour. Week starts Monday; the separate Day view has been removed.
- **Month:** one square per day, in a calendar.
- **Year:** one square per day, in a contribution-style grid.
- **Solid green:** running throughout observed time. **Green/white diagonal hatching:** running for some observed time. **White:** idle throughout observed time. **Grey:** no observations. A small corner dot indicates incomplete coverage; future periods have a dashed border.
- Occupancy means **at least one running rental on a box**, rather than GPU utilisation or fraction of GPUs allocated.
- Numbers are the **stored customer instance count**, including stopped rentals, at the last observation in that square. They are not Docker cache counts or sums across hours.
- Hover, keyboard focus, or tap shows occupancy percentage, running hours, stored count, state durations, and data coverage.
- Summary occupancy uses observed time only. Coverage reports how much elapsed time is known. Running box-hours add time across boxes.
- The **Images** pill combines **Running** and **Stored**, which show the latest fleet instance counts reported by Vast, independent of the historical period. Stored includes running and stopped instances. Running counts can lag when a box disconnects; confirmed offline time still counts as zero historical occupancy.
- Under Images, **GB allocated** totals Vast's allocated disk space across all boxes when every value is available. This is not actual instance file usage and may include other Vast allocations. Missing values are not treated as zero.
- Each summary card has a small **i** button with a metric explanation; click or tap to expand it, or use the keyboard. The **Hours** pill shows running box-hours for the selected period. The four summary pills are Occupancy, Hours, Images, and Data coverage.
- London calendar boundaries account for 23/25-hour daylight-saving days. Repeated hours on clock-change days follow actual time; tooltips identify GMT/BST.
- **Border = box state:** thick green for listed, thick grey for unlisted, thick amber for maintenance, thick red for offline. Each square has one 3px border, with priority **offline → maintenance → unlisted → listed**. A border means that state was observed during the hour/day; it does not imply that the entire period was spent in that state. A mixed listed/unlisted period uses grey. If there is no listing or availability evidence, the square keeps a thin neutral outline.
- **Fill = occupancy:** green for running throughout observed time, green/white diagonal hatching for part of observed time, white for none, grey for unknown/missing data. The border and fill are independent: a listed box can be idle, and an unlisted box can still have an existing running rental.
- **Number = stored instances:** the stored customer instance count (including stopped rentals) at the last observation in the square. It is not the Docker image cache count or an accumulated total.
- Current badges beside each box name show online/offline, listed/unlisted, and active/planned maintenance separately from the historical square borders. Hover, tap or keyboard focus shows exact occupancy and the observed listed, unlisted, offline and maintenance durations. Raw error messages and maintenance reasons are not published.
- Offline status follows Vast's Machines console: `timeout >= 10` seconds. The collector requests `include_offline=1` so disconnected machines are included. A confirmed offline sample counts as zero running time even if Vast retains a stale nonzero rental counter. Stored instances are still shown when available.
- Active maintenance uses uncancelled `machine_maintenance` windows (`start_time` plus `duration_hours`). Maintenance does not automatically imply offline or prevent an existing rental from running. Future windows get a separate planned badge.
- Listing status follows Vast's `listed` flag and `end_date`: an expired listing is treated as unlisted. A known expiration splits listed/unlisted history at the actual expiration time, even between polls. Listing status is separate from whether an existing rental is running.
- Missing machines/fields are unknown, not offline or idle. API errors preserve previous data, and badges become out of date after 20 minutes without a successful update. Occupancy and status coverage are independent: older records without status fields have unknown availability, not invented uptime.
- The empty income row has been removed from tooltips. Income is currently unavailable. The public schema supports `incomeUsd`, but the collector does not invent income from list prices. Vast provides per-machine earnings reports; their granularity and accounting need verification before adding them. Any future estimates must be explicitly labelled. Publishing actual income requires deciding that financial disclosure is intended.

The demo button generates clearly labelled illustrative history in the browser. It does not overwrite or publish sample records. Add `?demo=1` to preview directly.

## Public-data boundary

Only chosen names, timestamps, running/availability/listing states, current running and stored counts, allocated disk-space totals, occupied/observed/listed/unlisted/offline/maintenance seconds, sanitized listing-expiration and maintenance start/end times, and optional explicitly sourced income belong in `public/data.json`. API output is allowlisted before export. Raw responses, credentials, machine IDs, hostnames, IP addresses, customer names, image names, maintenance reasons, free-text errors and billing records are never serialized. The workflow uploads only `public/`.

Status behavior was checked against Vast's public console on 26 October 2026: [machine dashboard module](https://cloud.vast.ai/assets/MachinesPageSwitcher-BpoDvDWr.js), [API request module](https://cloud.vast.ai/assets/index-rkOnGsCI.js). These versioned asset URLs may change when Vast deploys its console. No extra API endpoint is required for maintenance because the machine response already contains the windows.

The repository and its Git history are public too: use only sanitized summaries here. Occupancy and stored counts themselves are public by design. The only external page resource is Google Fonts; fallback system fonts work if unavailable.

## Local development

The compact interface shows its release version in the footer (currently **v1.4.0**). The tagline and update timestamp share the header, leaving the main area for controls and data.

Requires Node 24 or later; no dependencies or build step. GitHub Actions uses Ubuntu 24.04 explicitly and actions with Node 24 runtimes.

When changing browser code or styling, bump the version in `package.json`, the visible footer and asset queries in `index.html`, and the `model.js` import in `app.js`. Data is fetched without browser caching independently of the code version.

```sh
npm test
npm run preview
```

Open http://127.0.0.1:4173/ (or add `?demo=1`).

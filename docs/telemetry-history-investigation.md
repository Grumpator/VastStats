# Rental occupancy from Vast telemetry history

Investigation: 28 October 2026. Existing dashboard behavior and stored history were not changed.

## Finding

Vast has a host-side historical **container timeline**, separate from current machine counters and earnings reports. Authenticated tests successfully retrieved container histories for Alpha, Beta and Gamma using the exact restricted permissions below. A five-minute snapshot collector is therefore not required to retrieve those historical running intervals. Computing trustworthy occupancy still requires the coverage and freshness checks described below.

```json
{
  "api": {
    "machine_read": {},
    "user_read": {
      "api.telemetry.token": {"GET": {}}
    }
  }
}
```

Machines/read alone failed telemetry authorization. Adding Billing/read without User/read also failed. Machines/read plus User/read worked, and subsequently limiting User/read to the exact telemetry-token GET route also worked. The earlier wildcard-category proposal did not grant the route. No tested key is recorded in this repository.

Seven-day queries returned 20 containers for Alpha, 5 for Beta, and 36 for Gamma, with no approximation or fragmented-run flags. A Gamma request hit HTTP 429 after multiple probes and succeeded when retried separately; a production client needs bounded retry/backoff. Thirty-one-day queries with Machines/read plus User/read also succeeded. Archive starts were 2 September for Alpha, 9 October for Beta and 18 October for Gamma (2026).

Container observations were not current: Alpha/Beta's latest returned container timestamps were on 27 October, and Gamma's on 28 October around noon. Metadata `extent.end` advanced to the current clock across requests; it must not be used alone as proof that all recent container data has arrived. Freshness and coverage need validation before presenting these intervals as current-month live occupancy.

## Primary evidence

- [Machine Metrics documentation](https://docs.vast.ai/host/machine-metrics): container state sampled every 15 seconds; timelines distinguish existence/stopped state from running intervals; recent uploads may lag by hours; local buffering can fill gaps after reconnection. History begins with the current recording format and a format-changing daemon update can restart it. There is currently no fixed retention period.
- [Current official console metrics client](https://cloud.vast.ai/assets/useAdminAuth-Z7c280VS.js): archive discovery, metadata, and date-range queries.
- [Current official console authentication code](https://cloud.vast.ai/assets/index-C_5BDvPP.js): exchanges the account key for a short-lived telemetry token.
- [Current official timeline rendering code](https://cloud.vast.ai/assets/MachineMetricsExplorer-8mPpO_KU.js): consumes container lifetimes and individual runs, including approximation and open-boundary flags.
- [API permission reference](https://docs.vast.ai/api-reference/permissions): documents Machines/read access but does not list the telemetry-token endpoint. Its precise scope is not established by that reference.

Console asset URLs are versioned and can disappear after a deployment. Endpoint and field details below were observed in those official assets, rather than a documented stable public API contract.

## Read-only request flow observed in console code

1. `GET https://cloud.vast.ai/api/v0/telemetry/token/`, authenticated with the account key. Response is expected to include `token`, `telemetry_url`, and `expires_in_sec`.
2. `GET {telemetry_url}/api/v1/archives`, authenticated with the short-lived telemetry token. Select the `machine` archive and an authorized entity.
3. `GET {telemetry_url}/api/v1/archives/machine/{entity}/meta`. Console reads `extent.t0` from metadata.
4. `POST {telemetry_url}/api/v1/archives/machine/{entity}/query` with UNIX timestamps in seconds and only the container section:

```json
{
  "start": 0,
  "stop": 0,
  "sections": {"conts": {}}
}
```

Replace both zero timestamps with the desired date-range boundaries. This POST is a read-only query, not an instance-management operation. Do not request daemon logs, processes or unrelated hardware metrics for the occupancy dashboard.

The renderer consumes `sections.conts.active` and fields including:

- Container `id`, `first_seen`, `last_seen`, `end_witnessed`.
- `runs[]` with `start`, `end`, `open_start`, `open_end`, `fragmented`.
- `run_count`, `running_s`, `last_state`, `last_state_ts`, `approx`, `is_vm`.

These fields were initially found in console code and then verified against this account's authenticated responses. The manual **Inspect Vast history API** workflow checks access and prints only field names and aggregate counts. It never logs credentials, raw responses, or instance/machine IDs. Earlier authentication failures in that diagnostic did not mean the ordinary collector was failing.

## Turning the response into squares

- Clip running intervals to each London hour/day and merge overlaps across all customer instances on a box. Occupancy is the duration of that union divided by the interval with known telemetry coverage. Multiple simultaneous instances must not cause occupancy above 100%.
- Count distinct customer instance IDs whose running intervals overlap the square, if that metric is adopted. Count an instance once, even if it restarts; `run_count` is not the number of distinct rentals.
- Existence intervals can potentially supply a stored-instance count, but open/approximate boundaries need explicit handling. Exact disk sizes are not established by the container timeline.
- Exclude non-customer/default containers after verifying their identity conventions. The console uses `C.{id}` labels, but that alone does not establish a complete mapping to billable contracts or distinguish every default job.
- Approximate or fragmented responses may require smaller queries to recover finer resolution. Never treat a zoomed-out segment containing multiple runs as continuously occupied.
- Metadata extent and requested response range alone do not prove continuous reporting. Determine the API's coverage/gap semantics before using missing containers as evidence of idle time. Leave uncertain intervals unknown.
- Container history does not by itself establish historical listed/unlisted/maintenance states. Keep those separate unless a historical source is verified.

## Storage and hosting options

**No stored history:** a serverless endpoint keeps the Vast key and private machine mapping, retrieves the requested period, calculates sanitized squares, and returns only public names and aggregates. GitHub Pages can remain the frontend. No VPS or exposed box is necessary. A public static page cannot keep an API credential secret, and it must not receive the broad telemetry token or raw private IDs either. The authorization step remains required regardless of CORS support.

**Hybrid, preferred for dependable long-term views:** rebuild the current month from telemetry on demand or periodically, and store compact completed-month summaries per public box name. Revisit recent/just-closed periods to reconcile late uploads. Mark data through the last actual telemetry timestamp rather than calling it real-time. This reduces reliance on five-minute scheduling, and saved month summaries preserve the dashboard's history if the upstream recording format or retention behavior changes.

**GitHub only:** Actions can retrieve and rebuild the current month less frequently and commit summaries; Pages reads the public summaries. Delayed runs can backfill history while Vast still retains it. This still stores processed data and does not provide an authenticated API request on every anonymous page load. Workflow dispatch from a public page must not expose a GitHub token.

## Remaining validation

1. Verify coverage semantics and customer-instance filtering using a narrow historical window, including why container observations lag the current clock.
2. Compare reconstructed occupancy with a known rental period before replacing the snapshot-based collector.
3. Test the desired current-month/closed-month strategy against delayed uploads and recording-format changes.

No five-minute scheduler or new storage service is required just to perform these checks.

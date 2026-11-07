# Later

- Market page: implement read-only comparisons by GPU type, normalised prices and shared cached market snapshots; consider pricing suggestions afterwards.
- Settings page: implement protected device visibility/retirement/exclusion controls with persistent data and consistent historical treatment.

- Separate fast fleet-status publication from slower earnings collection.
- Cache contract rates; review earnings refresh cadence and change-triggered refreshes.
- Cache telemetry reporting-series/metadata discovery, with expiry and failure recovery.
- Add shared request pacing, jitter and backoff before supporting large/multiple accounts.
- Inspect account audit logs once read access is available: look for successful list/unlist actions, device references, time coverage and retention; do not assume they establish offline periods.
- Multi-user support later: workspaces, separate API keys/data, roles, private earnings and optional public dashboards. Keep the current page work single-account.

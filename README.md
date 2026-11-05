# VastStats

A self-hosted dashboard for Vast.ai hosts. See the current state of your fleet, explore historical utilisation, and track the current compute and storage earning rate.

![Fleet overview](docs/screenshots/overview.jpg)

![Occupancy details](docs/screenshots/details.jpg)

*Screenshots use illustrative demo data.*

## Install

Supports **Debian 13, Ubuntu 24.04/26.04**, systemd, and **amd64/arm64**. Run these two lines on the server (omit `sudo` if already root):

```bash
sudo apt-get update && sudo apt-get install -y curl ca-certificates && curl -fsSL https://raw.githubusercontent.com/Grumpator/VastStats/apt/install.sh -o vaststats-install.sh
sudo sh ./vaststats-install.sh
```

The installer verifies and adds the signed VastStats APT source. If the configured sources cannot supply Node.js 24+, it also enables the signed NodeSource 24 repository; APT then installs the dependency. Use `sudo sh ./vaststats-install.sh --no-node-source` to require your own Node source instead.

Installation asks for your **restricted Vast API key** using a hidden-input prompt. Use the permissions in [vast-api-permissions.json](config/vast-api-permissions.json). The key stays on the server. The package creates a non-login Linux service account named `vaststats`, prepares its directories and starts the service.

Open **http://YOUR_SERVER_IP:3000/**. The first history import may take a little while; current status continues to refresh during it.

## Update

Publishing a stable GitHub Release builds and publishes the next package. On the server:

```bash
sudo apt-get update && sudo apt-get install --only-upgrade vaststats
```

`apt-get update` discovers versions; the install/upgrade step applies them. Normal `apt-get upgrade` also includes VastStats. Updates retain the API key, configuration, private identity and historical data.

To change the key, run `sudo dpkg-reconfigure vaststats`. To inspect the service, use `systemctl status vaststats` or `journalctl -u vaststats`.

## What the dashboard shows

**Overview** shows one adaptive square per device. Green means listed, amber maintenance and grey unlisted. Animated bars indicate running rentals. Offline devices flash red when listed, amber during maintenance and grey when unlisted. Unknown or overdue states are identified explicitly.

The summary shows trailing **24-hour / week / month occupancy**, current **hourly earnings**, and fleet-wide running, listed, online, maintenance and stored counts. Earnings use running GPU contract prices and allocated storage, including stopped instances; bandwidth is excluded. Tap a summary for its explanation or breakdown.

**Details** shows one row per device, with Hours / Days / Weeks / Months views. Click a day, week or month to drill down. The visible time range fits the screen, and navigation advances by that range. Device, state and occupancy columns can be sorted.

Each circle represents one period: **green = observed running**, **amber = observed idle**, **grey = missing data**. Its number counts running episodes: stopping and restarting the same instance counts twice. An amber dot marks incomplete coverage. Occupancy percentages use observed time; missing telemetry is not treated as idle. Time before available history and future time are excluded from coverage.

Hover or tap a device for current state, verification, reliability, GPUs, instances, utilisation and freshness details. Historical borders use actual recorded status sightings, rather than inventing offline or maintenance intervals between checks.

## How it works

One Node.js process serves the dashboard and collects data independently of browser activity:

- **Every 5 minutes:** owner-scoped machine states and current contract rates.
- **Every 30 minutes:** detailed telemetry, with overlap and periodic reconciliation for late data.
- **On first setup:** automatic machine discovery using Vast hostnames, plus all historical telemetry still available from Vast.

History is cached on disk and published atomically. Failed requests retain previously collected data. Current status and detailed history have separate freshness indicators; delays in Vast telemetry remain visible as missing coverage. Closing a browser does not stop collection; stopping the service does.

## Configuration and data

| Location | Purpose |
| --- | --- |
| `/usr/lib/vaststats` | Package-managed application files |
| `/etc/vaststats/vaststats.env` | Protected API key and optional HOST, PORT, DATA_DIR settings |
| `/var/lib/vaststats/data` | Persistent identity, current snapshots, observations and history |

The app and data are separate. Package upgrades never replace the data directory. Back up the **entire data directory**, including `identity.json`, together; stop the service first for a consistent filesystem backup. Removing the package retains configuration and data. Purging removes configuration but still retains data and its owning service account. Data reset is a separate deliberate administrator operation, never an installation or upgrade side effect.

The dashboard and its read-only API listen on all IPv4 interfaces at port 3000 by default. Configure `HOST=127.0.0.1` and an HTTPS/authentication reverse proxy if desired, then restart the service. Public access to the dashboard also permits access to its sanitized API responses. API keys, raw contracts and private Vast machine IDs are never served.

A blank key permits an unconfigured installation; collection starts after configuration. Unattended installations can preseed `vaststats/api-key` through debconf. Existing configuration is preserved during upgrades; the temporary password answer is cleared after use.

## Run from source

With Node.js 24+ installed, copy `.env.example` to `.env`, set `VAST_API_KEY`, then run:

```bash
npm test
npm start
```

The source defaults to `0.0.0.0:3000` and `./var/data`. `.env` and runtime data are ignored by Git. `?demo=1` shows sample data without changing stored data. No external npm runtime dependencies or frontend build step are required.

## Build and release

`npm run build:deb` creates the architecture-independent Debian package in `dist/`. The package declares `nodejs (>= 24)` and standard Debian service/configuration dependencies. APT resolves these from configured sources.

**Only publishing a stable GitHub Release triggers package and APT publication. Creating or pushing a tag alone does not.** The release tag must match the app version, for example `v1.0.0` for `1.0.0`.

See [release maintenance](docs/releasing.md) for signing setup, validation and the publication workflow.

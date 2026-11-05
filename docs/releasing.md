# Release maintenance

## Signing settings

The package repository is served from the dedicated `apt` branch at:

`https://raw.githubusercontent.com/Grumpator/VastStats/apt`

Configure repository secret **APT_SIGNING_KEY** with the ASCII-armored private signing key and repository variable **APT_SIGNING_FINGERPRINT** with its full public fingerprint. This signing key is separate from the Vast API key; the latter never belongs in CI.

The current public fingerprint is **2B1B9E497A65855464A29D7390DD62D82C525502**. The private key is kept locally outside Git under `var/apt-signing/private-key.asc`; back it up securely. It is a sign-only RSA-3072 automation key, expiring in November 2028. Plan a deliberate trust/key rotation before expiry. The repository builder refuses silent signing-key changes.

## Publish a version

1. Update `package.json` and frontend version/cache strings, commit the code on `main`, and ensure CI passes.
2. In GitHub, publish a stable Release using a matching tag such as `v1.0.0`.
3. Monitor **Publish Debian package** until it succeeds.

A tag push alone does not build or publish packages. Drafts and prereleases do not publish to stable APT. The workflow resolves the exact tag commit, verifies it belongs to `main`, runs Node tests on Linux/Windows, builds a deterministic `.deb`, and checks it with `dpkg-deb`.

Disposable signed APT repositories test install-by-name, automatic Node dependency resolution, startup without contacting Vast, upgrade preservation, key rotation, remove and purge in Debian 13 and Ubuntu 24.04/26.04 containers. Containers do not boot systemd; service startup on a real host remains a separate deployment check.

The tested `.deb` and SHA-256 checksum are attached to the published GitHub Release. Existing versioned artifacts cannot silently change. A separate publication job imports the private signing key into a temporary keyring, writes signed APT indexes and atomically updates the managed `apt` branch. Only public keys, signed metadata, packages and the installation helper enter that branch. The private keyring is removed afterward. No Pages site or running repository server is needed.

APT retains older packages and immutable by-hash indexes so clients with cached metadata can still fetch the right files. GitHub Raw may briefly cache a new index; a later `apt-get update` will discover it. The repository supplies VastStats; Node.js comes from the server's configured dependency sources.

## Local checks

```bash
npm test
npm run build:deb
```

`npm run build:apt` requires `APT_SIGNING_FINGERPRINT`, `GNUPGHOME` and GnuPG. Optional settings: `GPG_BINARY`, `DEB_DIR` (default `dist`) and `APT_OUTPUT` (default `dist/apt`). Use a fresh output directory when testing changed package bytes under the same development version; published versions are immutable.

Do not publish CI smoke-test keys. Do not commit `.env`, private keys, runtime data or build artifacts.

#!/bin/bash
set -euo pipefail
# Disposable CI key only. Production signing is confined to publish-apt.
test_home="$(mktemp -d "${RUNNER_TEMP:-/tmp}/vaststats-test-gpg.XXXXXXXX")"
cleanup() { GNUPGHOME="$test_home" gpgconf --kill gpg-agent || true; rm -rf -- "$test_home"; }
trap cleanup EXIT
chmod 700 "$test_home"
export GNUPGHOME="$test_home"
gpg --batch --pinentry-mode loopback --passphrase '' --quick-generate-key 'VastStats CI <ci@example.invalid>' rsa2048 sign 1d
APT_SIGNING_FINGERPRINT="$(gpg --batch --with-colons --list-secret-keys | awk -F: '$1 == "fpr" {print $10; exit}')"
export APT_SIGNING_FINGERPRINT
export APT_OUTPUT="$PWD/dist/apt"
node scripts/apt/build.mjs
gpg --batch --verify "$APT_OUTPUT/dists/stable/InRelease"

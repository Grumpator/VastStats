#!/bin/sh
set -eu
if [ "$(id -u)" -ne 0 ]; then echo 'Run this installer with sudo.' >&2; exit 1; fi
node_source=true
case "${1:-}" in
    '') ;;
    --no-node-source) node_source=false ;;
    --help) echo 'Usage: sudo sh install.sh [--no-node-source]'; exit 0 ;;
    *) echo 'Unknown option. Use --help.' >&2; exit 1 ;;
esac
test -f /etc/debian_version || { echo 'Debian or Ubuntu is required.' >&2; exit 1; }
architecture=$(dpkg --print-architecture)
case "$architecture" in amd64|arm64) ;; *) echo 'Supported architectures: amd64, arm64.' >&2; exit 1 ;; esac
repository=https://raw.githubusercontent.com/Grumpator/VastStats/apt
fingerprint=2B1B9E497A65855464A29D7390DD62D82C525502
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT HUP INT TERM

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg
curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 "$repository/vaststats.asc" -o "$work/vaststats.asc"
actual=$(gpg --batch --with-colons --show-keys "$work/vaststats.asc" | awk -F: '$1 == "fpr" {print $10; exit}')
test "$actual" = "$fingerprint" || { echo 'VastStats signing-key fingerprint mismatch.' >&2; exit 1; }
install -d -m 755 /etc/apt/keyrings
install -m 644 "$work/vaststats.asc" /etc/apt/keyrings/vaststats.asc
printf 'Types: deb\nURIs: %s\nSuites: stable\nComponents: main\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/vaststats.asc\n' "$repository" "$architecture" > /etc/apt/sources.list.d/vaststats.sources
apt-get update

candidate=$(apt-cache policy nodejs | awk '/Candidate:/ {print $2; exit}')
if [ -z "$candidate" ] || [ "$candidate" = '(none)' ] || ! dpkg --compare-versions "${candidate#*:}" ge 24; then
    if [ "$node_source" != true ]; then
        echo 'Node.js 24+ is not available. Configure a suitable Node repository and retry.' >&2
        exit 1
    fi
    echo 'Enabling the signed NodeSource Node.js 24 repository to satisfy the package dependency.'
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o "$work/nodesource.asc"
    gpg --batch --yes --dearmor -o "$work/nodesource.gpg" "$work/nodesource.asc"
    install -m 644 "$work/nodesource.gpg" /etc/apt/keyrings/nodesource.gpg
    printf 'Types: deb\nURIs: https://deb.nodesource.com/node_24.x\nSuites: nodistro\nComponents: main\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/nodesource.gpg\n' "$architecture" > /etc/apt/sources.list.d/vaststats-node24.sources
    apt-get update
fi
# Leave debconf interactive: first install asks for the Vast key unless preseeded.
apt-get install -y vaststats
echo 'VastStats installed. Open http://SERVER_IP:3000/ or use your configured reverse proxy.'

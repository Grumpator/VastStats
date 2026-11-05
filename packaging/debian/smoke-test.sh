#!/bin/sh
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl gnupg util-linux debconf
# These disposable test containers explicitly opt in to a Node 24 repository.
# The VastStats package itself must not add repositories or install Node manually.
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
chmod 644 /usr/share/keyrings/nodesource.gpg
printf 'deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main\n' > /etc/apt/sources.list.d/node24.list
apt-get update -qq
if command -v node >/dev/null; then echo 'Test image unexpectedly already has Node' >&2; exit 1; fi
package=$(find /packages -maxdepth 1 -name '*.deb' -print -quit)
test -n "$package"
version=$(dpkg-deb -f "$package" Version)
install -m 644 /packages/apt/vaststats.asc /usr/share/keyrings/vaststats-test.asc
printf 'Types: deb\nURIs: file:/packages/apt\nSuites: stable\nComponents: main\nArchitectures: %s\nSigned-By: /usr/share/keyrings/vaststats-test.asc\n' "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/vaststats-test.sources
apt-get update -qq
printf 'vaststats vaststats/api-key password package-test-key\n' | debconf-set-selections
apt-get install -y "vaststats=$version"
node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'
test "$(dpkg-query -W -f='${Status}' nodejs)" = 'install ok installed'
test "$(stat -c %a /etc/vaststats/vaststats.env)" = 600
test "$(stat -c %U /var/lib/vaststats/data)" = vaststats
grep -q 'VAST_API_KEY="package-test-key"' /etc/vaststats/vaststats.env
case "$(printf 'GET vaststats/api-key\n' | debconf-communicate vaststats)" in '0'|'0 ') ;; *) exit 1 ;; esac
test -f /usr/lib/systemd/system/vaststats.service
# Containers do not boot systemd. Exercise the actual app as its service user.
runuser -u vaststats -- env HOST=127.0.0.1 PORT=3000 DATA_DIR=/var/lib/vaststats/data VAST_API_KEY= node /usr/lib/vaststats/server.mjs >/tmp/app.log 2>&1 &
app_pid=$!
ready=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS http://127.0.0.1:3000/healthz >/tmp/health.json; then ready=true; break; fi
    sleep 1
done
test "$ready" = true
node -e 'const h=require("/tmp/health.json");if(!h.ok||h.configured||h.version!==require("/usr/lib/vaststats/package.json").version)process.exit(1)'
kill "$app_pid"
wait "$app_pid" || true
printf 'retain this history\n' > /var/lib/vaststats/data/keep-history.txt
identity_before=$(sha256sum /var/lib/vaststats/data/identity.json)
printf '\n# administrator setting\nPORT=3123\n' >> /etc/vaststats/vaststats.env
config_before=$(sha256sum /etc/vaststats/vaststats.env)
# A real higher package version exercises dpkg's upgrade maintainer-script paths.
dpkg-deb --raw-extract "$package" /tmp/upgraded-package
sed -i "s/^Version: .*/Version: $version+ci1/" /tmp/upgraded-package/DEBIAN/control
dpkg-deb --root-owner-group --build /tmp/upgraded-package /tmp/vaststats-upgrade.deb
apt-get install -y /tmp/vaststats-upgrade.deb
test "$(sha256sum /etc/vaststats/vaststats.env)" = "$config_before"
test "$(sha256sum /var/lib/vaststats/data/identity.json)" = "$identity_before"
grep -q 'retain this history' /var/lib/vaststats/data/keep-history.txt
printf 'vaststats vaststats/api-key password rotated-package-test-key\n' | debconf-set-selections
dpkg-reconfigure -f noninteractive vaststats
grep -q 'VAST_API_KEY="rotated-package-test-key"' /etc/vaststats/vaststats.env
grep -q '^PORT=3123$' /etc/vaststats/vaststats.env
case "$(printf 'GET vaststats/api-key\n' | debconf-communicate vaststats)" in '0'|'0 ') ;; *) exit 1 ;; esac
apt-get remove -y vaststats
test -f /etc/vaststats/vaststats.env
test "$(sha256sum /var/lib/vaststats/data/identity.json)" = "$identity_before"
apt-get purge -y vaststats
test ! -e /etc/vaststats/vaststats.env
grep -q 'retain this history' /var/lib/vaststats/data/keep-history.txt
test "$(sha256sum /var/lib/vaststats/data/identity.json)" = "$identity_before"
echo 'APT dependency/install/upgrade/reconfigure/remove/purge checks passed.'

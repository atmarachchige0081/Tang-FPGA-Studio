#!/usr/bin/env bash
set -euo pipefail
# Portable upstream runtime for Ubuntu releases whose Microsoft APT feed does
# not yet publish powershell (currently 26.04). Run explicitly with sudo.
[[ $(id -u) == 0 ]] || { echo 'Run this system-runtime installer explicitly with sudo.' >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo 'Only x86_64 is supported.' >&2; exit 1; }
if command -v pwsh >/dev/null; then pwsh --version; exit 0; fi
version=7.6.7
sha256=6896f9e3a6b0a354bf470835a96da76d2f801cd50dcf047ad7c4563bf93bf431
root="/opt/microsoft/powershell/$version"
[[ ! -e "$root" && ! -L /usr/local/bin/pwsh ]] || { echo 'Existing runtime files require manual review; refusing to overwrite them.' >&2; exit 1; }
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
curl --fail --location --retry 3 "https://github.com/PowerShell/PowerShell/releases/download/v$version/powershell-$version-linux-x64.tar.gz" --output "$temporary/powershell.tar.gz"
echo "$sha256  $temporary/powershell.tar.gz" | sha256sum --check
mkdir "$temporary/runtime"
tar -xzf "$temporary/powershell.tar.gz" -C "$temporary/runtime"
chmod +x "$temporary/runtime/pwsh"
install -d /opt/microsoft/powershell /usr/local/bin
mv "$temporary/runtime" "$root"
ln -s "$root/pwsh" /usr/local/bin/pwsh
pwsh --version

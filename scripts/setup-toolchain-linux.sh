#!/usr/bin/env bash
set -euo pipefail
# Ubuntu 22.04+ x86_64. Hash published with the upstream 2026-07-26 release.
[[ $(uname -m) == x86_64 ]] || { echo 'Linux toolchain currently supports x86_64 only.' >&2; exit 1; }
version=2026-07-26
asset=oss-cad-suite-linux-x64-20260726.tgz
sha256=38496835b9c57ffdf8b057c6e2dcd23d2fa0bb043dc49ac13d1296872c81714e
base=${TANG_TOOLCHAIN_BASE:-${XDG_DATA_HOME:-$HOME/.local/share}/tang-fpga-studio/toolchains}
cache=${XDG_CACHE_HOME:-$HOME/.cache}/tang-fpga-studio
mkdir -p "$base/$version" "$cache"
archive="$cache/$asset"
if [[ ! -f "$archive" ]] || ! echo "$sha256  $archive" | sha256sum --check --status; then
  curl --fail --location --retry 3 "https://github.com/YosysHQ/oss-cad-suite-build/releases/download/$version/$asset" --output "$archive.part"
  echo "$sha256  $archive.part" | sha256sum --check
  mv "$archive.part" "$archive"
fi
echo "$sha256  $archive" | sha256sum --check
# Never accept an unverified download or run a self-extracting executable.
tar -xzf "$archive" -C "$base/$version"
"$base/$version/oss-cad-suite/bin/yosys" -V
printf 'Toolchain ready: %s\n' "$base/$version/oss-cad-suite"

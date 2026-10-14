#!/usr/bin/env bash
set -euo pipefail
# Explicit system prerequisite installation; never invoked silently by the app.
. /etc/os-release
[[ $ID == ubuntu && ( $VERSION_ID == 22.04 || $VERSION_ID == 24.04 || $VERSION_ID == 26.04 ) ]] || {
  echo 'Target versions: Ubuntu 22.04, 24.04 and 26.04 x86_64.' >&2; exit 1;
}
[[ $(uname -m) == x86_64 ]] || { echo 'Only x86_64 is supported.' >&2; exit 1; }
sudo apt-get update
sudo apt-get install -y --no-install-recommends ca-certificates curl gnupg file build-essential pkg-config libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf libssl-dev libudev-dev git python3 usbutils xdg-utils
# Microsoft's repository installs the signed PowerShell package. apt verifies signatures.
if ! command -v pwsh >/dev/null && [[ $VERSION_ID == 26.04 ]]; then
  sudo bash "$(dirname "$0")/setup-powershell-linux.sh"
fi
if ! command -v pwsh >/dev/null; then
  temporary=$(mktemp -d)
  trap 'rm -rf "$temporary"' EXIT
  curl -fsSL "https://packages.microsoft.com/config/ubuntu/$VERSION_ID/packages-microsoft-prod.deb" -o "$temporary/microsoft.deb"
  sudo dpkg -i "$temporary/microsoft.deb"
  sudo apt-get update
  sudo apt-get install -y powershell
fi
printf '%s\n' 'Install Node.js 24 and stable Rust using their official installers before npm ci and npm run desktop.'
printf '%s\n' 'FPGA tools: bash scripts/setup-toolchain-linux.sh (runs as your user, without sudo).'

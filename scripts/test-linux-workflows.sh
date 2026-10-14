#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
temporary_root=$(mktemp -d '/tmp/tang-linux-workflows.XXXXXX')
trap 'rm -rf "$temporary_root"' EXIT
for project in projects/01_button_led_pwm projects/03_uart_terminal projects/05_serial_command_console projects/06_hardware_intelligence templates/spi_controller templates/vga_timing templates/riscv_scaffold templates/console_led_button; do
  selected="$project"
  if [[ ! -f "$project/fpga.config.psd1" ]]; then
    # Catalog overlays are not standalone projects; stage one without editing source.
    selected="$temporary_root/$(basename "$project")"
    mkdir -p "$selected"
    cp -a "$project/." "$selected/"
    cp fpga.config.psd1 "$selected/"
  fi
  pwsh -NoLogo -NoProfile -NonInteractive -File ./fpga.ps1 lint -Project "$selected"
  pwsh -NoLogo -NoProfile -NonInteractive -File ./fpga.ps1 sim -Project "$selected" -Testbench sim/tb_top.sv
  test -s "$selected/build/waves.vcd"
done
pwsh -NoLogo -NoProfile -NonInteractive -File ./fpga.ps1 build -Project projects/01_button_led_pwm
python3 - <<'PY'
from pathlib import Path
import json
p=Path('projects/01_button_led_pwm/build')
assert p.joinpath('top.fs').stat().st_size > 1024
report=json.loads(p.joinpath('timing.json').read_text())
assert report['fmax'], 'No measured timing evidence'
for clock, timing in report['fmax'].items():
    assert timing['achieved'] >= timing['constraint'], (clock, timing)
print('Implementation timing met:', report['fmax'])
PY
# Exercise path handling with a real external project whose path contains spaces.
external="$temporary_root/external project"
mkdir -p "$external"
cp -a projects/01_button_led_pwm/. "$external/"
pwsh -NoProfile -File ./fpga.ps1 sim -Project "$external" -Testbench sim/tb_top.sv
# A testbench outside sim must be refused, not executed.
if pwsh -NoProfile -File ./fpga.ps1 sim -Project "$external" -Testbench ../outside.sv; then
  echo 'ERROR: out-of-project testbench was accepted' >&2; exit 1
fi
pwsh -NoProfile -File ./fpga.ps1 clean -Project "$external"
test ! -e "$external/build"
printf '%s\n' 'LINUX WORKFLOWS PASSED'

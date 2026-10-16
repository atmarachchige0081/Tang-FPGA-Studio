# Contributing

Thank you for helping make FPGA development more approachable.

See the [3.5.1–3.5.4 roadmap](docs/ROADMAP.md) for prioritized reliability,
onboarding and usability tasks, with acceptance criteria for each release.

## Development setup

1. Use Windows 10/11 and Python 3.10 or later with Tk support.
2. Clone the repository and run `./fpga.ps1 setup` from PowerShell.
3. Start the UI with `./FPGA-IDE.ps1 -Console` while developing.
4. Work in a focused branch and keep generated `build/`, waveform, cache, and
   `.fpga-studio/` files out of commits.

## Required checks

Run the release gate before opening a pull request:

```powershell
.\scripts\release-check.ps1
```

At minimum, changes must preserve:

- Python compilation and all unit tests.
- Clean smart checks for `projects/_template` and `01_button_led_pwm`.
- Verilator lint and the self-checking Icarus simulation.
- Dark/light startup smoke tests, semantic contrast validation, and the
  live-switch/rollback stress test.
- Path containment, flash confirmation, and JTAG Interface A guidance.
- Keyboard accessibility and usability at 100–200% Windows display scaling.

For UI changes, regenerate screenshots with
`./scripts/capture-screenshots.ps1` and inspect every dark and light image
before committing. New colors must be semantic tokens in `ide/themes.py`; do
not add widget-local hex colors that can become invisible in another theme.

## Adding an HDL pattern

Add reference entries to `ide/hdl_patterns.py`, keeping each example compact,
explicit about assumptions, and useful as an insertion-ready building block.
Every pattern needs a unique title and lowercase alias, category, difficulty,
plain-language summary, and correct synthesizable/simulation-only scope.
Prefer clock enables over generated clocks, synchronize asynchronous inputs,
default combinational outputs, and avoid examples that silently depend on a
particular memory or clock-domain behavior. Update the pattern tests whenever
you add a new safety rule.

## Change style

- Keep the Python UI dependency-free unless a dependency has a clear release,
  security, and maintenance justification.
- Prefer deterministic diagnostics over suggestions that guess hardware intent.
- Never invent board pins or voltage standards.
- Add a focused test for every parser, safety, or telemetry behavior change.
- Document user-facing changes in `CHANGELOG.md` and the relevant README.

By contributing, you agree that your contribution is provided under the MIT
License in this repository.

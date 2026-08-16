# FPGA Studio 3 hardware-intelligence architecture

Studio 3 uses one project-local design graph to connect source declarations,
Yosys netnames and cells, nextpnr physical placement, timing path segments, and
analyzer channels. Every link carries an evidence class: measured, inferred,
or unavailable. Consumers show unavailable links explicitly and never invent
physical or source correspondence.

## Artifact flow

```text
RTL + constraints
  -> conservative HDL index
  -> normal Yosys netlist + IO-pad-free analyzer netlist
  -> nextpnr placed/routed netlist + timing report
  -> cached cross-domain design graph
  -> Traceability / Analyzer / Design Health
```

Analyzer instrumentation links a generated wrapper and capture core around the
exact IO-pad-free synthesized user module. The user design is not synthesized a
second time inside the analyzer build. Generated names are namespaced, and the
linker rejects unsafe or colliding identities.

The optimizer consumes the same graph and build reports. Recommendations are
applicable only when their prerequisites contain real path evidence. Retiming
and placement-seed experiments copy required inputs into an isolated experiment
directory and never replace baseline artifacts or source files.

Snapshots record source identity, Git commit when available, board, toolchain,
resources, timing, verification state, analyzer configuration hash, and the
critical path. Comparisons use explicit thresholds and distinguish missing data
from zero.

All expensive filesystem, parser, serial, synthesis, and place-and-route work
runs outside the UI thread. Per-project job locking prevents concurrent writers
from corrupting shared build output; bounded graph, log, waveform, and snapshot
sizes keep rendering and persistence predictable.

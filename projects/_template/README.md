# FPGA learning-project template

Create a project with any safe, descriptive name, then replace the starter RTL
and testbench with the new design. FPGA Studio can place the project in any
writable folder; source, constraint, and build paths stay relative to that
project.

Before considering a project complete, provide:

- A clear behavioral specification and port description.
- Modular synthesizable RTL under `rtl/`.
- A self-checking `sim/tb_top.sv` testbench.
- A useful `sim/waves.gtkw` signal layout.
- Correct physical/electrical constraints.
- Passing lint, simulation, synthesis, place-and-route, and timing.
- A hardware SRAM test before persistent flash programming.
- A README containing controls, architecture, results, and limitations.

Commands:

```powershell
.\fpga.ps1 sim
.\fpga.ps1 wave
.\fpga.ps1 debug
.\fpga.ps1 build
.\fpga.ps1 upload
```

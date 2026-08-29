# Tang Console LED and button starter

This generated project is wired for either the Tang Console 60K or current
C-revision Tang Console 138K. `rtl/top.sv` blinks one active-low LED, mirrors
the USER button to the other, and uses the RESET button to clear the counter.

Run `./fpga.ps1 sim`, then `./fpga.ps1 build`. The 138K C-revision uses the
pinned open-source toolchain. The 60K build checks for Gowin EDA and explains
how to set `GOWIN_EDA_ROOT` if `gw_sh` is not on `PATH`.

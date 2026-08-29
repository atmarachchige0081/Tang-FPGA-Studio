# Sipeed Tang Console 60K

This package targets the Tang Console carrier with the Tang Mega 60K SOM:
`GW5AT-LV60PG484AC1/I0`, Gowin device `GW5AT-60B`, package PG484A, and the
50 MHz input on `V22`.

The starter exposes the two active-low buttons (`AB13`, `AA13`) and two
active-low status/user LEDs (`G11`, `U12`). The 60K button bank is 1.5 V, so
its constraints intentionally use `LVCMOS15`. The on-board BL616 presents the
JTAG/programmer and UART interfaces; openFPGALoader uses board alias
`tangconsole`.

The pinned open-source nextpnr/Apicula database does not contain GW5AT-60B.
Builds therefore use Gowin EDA Education 1.9.11.03 or newer through `gw_sh`.
Set `GOWIN_EDA_ROOT` to the Gowin installation directory when it is not on
`PATH`. Simulation, lint, programming, and the rest of Studio remain in the
same workflow.

See [PINOUT.md](PINOUT.md) for the verified carrier subset and guidance for
adding PMOD, SD, HDMI, BL616, or memory signals without polluting the beginner
starter with unused ports.

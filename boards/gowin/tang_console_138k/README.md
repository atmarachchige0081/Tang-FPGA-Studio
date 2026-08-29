# Sipeed Tang Console 138K

This package targets the Tang Console carrier with the current C-revision Tang
Mega 138K SOM: `GW5AST-LV138PG484AC1/I0`, Gowin device `GW5AST-138C`, package
PG484A, and the 50 MHz input on `V22`.

The starter exposes the two active-low buttons (`AB13`, `AA13`) and two
active-low status/user LEDs (`G11`, `U12`). The 138K Console constraints use
3.3 V button I/O; they are deliberately independent from the 60K package.
The onboard BL616 supplies JTAG/programming and UART, and openFPGALoader uses
board alias `tangmega138k`.

This C-revision builds with the pinned OSS CAD Suite `GW5AST-138C` database.
Older B-revision SOMs require Gowin EDA and must not be built with this C device
profile because Gowin documents silicon-revision-specific SSRAM behavior.

See [PINOUT.md](PINOUT.md) for the verified carrier subset and guidance for
adding PMOD, SD, HDMI, BL616, or memory signals. Check the marking on older
boards before using this C-revision profile.

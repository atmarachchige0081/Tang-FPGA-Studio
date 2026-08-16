@{
    ToolchainVersion = '2026-07-26'
    ToolchainRoot    = 'C:\fpga-tools\2026-07-26\oss-cad-suite'

    Top              = 'top'
    Device           = 'GW2A-LV18PG256C8/I7'
    Family           = 'GW2A-18'
    YosysFamily      = 'gw2a'
    Constraint       = 'constraints/primer20k_dock.cst'
    ClockMHz         = 27

    ProgrammerBoard  = 'tangprimer20k'
    Bitstream        = 'build/top.fs'
    DriverTool       = 'C:\fpga-tools\zadig-2.9.exe'
}

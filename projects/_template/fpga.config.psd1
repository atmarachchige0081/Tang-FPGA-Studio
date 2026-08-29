@{
    ToolchainVersion = '2026-07-26'
    ToolchainRoot    = 'C:\fpga-tools\2026-07-26\oss-cad-suite'

    Top              = 'top'
    Device           = 'GW2A-LV18PG256C8/I7'
    Family           = 'GW2A-18'
    YosysFamily      = 'gw2a'
    BuildBackend     = 'oss-cad-suite'
    GowinDeviceName  = 'GW2A-18'
    GowinDeviceCode  = ''
    GowinDeviceVersion = ''
    Constraint       = 'constraints/primer20k_dock.cst'
    TimingConstraint = ''
    ClockMHz         = 27

    ProgrammerBoard  = 'tangprimer20k'
    Bitstream        = 'build/top.fs'
    DriverTool       = 'C:\fpga-tools\zadig-2.9.exe'
}

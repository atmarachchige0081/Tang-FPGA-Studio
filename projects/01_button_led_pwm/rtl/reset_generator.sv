`timescale 1ns/1ps
`default_nettype none

module reset_generator #(
    parameter integer RESET_CYCLES = 16
) (
    input  logic clk,
    output logic reset
);
    localparam integer COUNTER_WIDTH =
        (RESET_CYCLES < 2) ? 1 : $clog2(RESET_CYCLES + 1);
    localparam logic [COUNTER_WIDTH-1:0] RESET_LIMIT =
        COUNTER_WIDTH'(RESET_CYCLES);

    // The FPGA configuration image supplies this deterministic power-on value.
    // A board reset pin is intentionally not required by this learning design.
    /* verilator lint_off PROCASSINIT */
    logic [COUNTER_WIDTH-1:0] counter = '0;

    always_ff @(posedge clk) begin
        if (counter < RESET_LIMIT)
            counter <= counter + 1'b1;
    end
    /* verilator lint_on PROCASSINIT */

    assign reset = (counter < RESET_LIMIT);
endmodule

`default_nettype wire

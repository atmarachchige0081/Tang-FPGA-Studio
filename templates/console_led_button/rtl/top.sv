`timescale 1ns/1ps
`default_nettype none

module top #(
    parameter integer BLINK_BIT = 24
) (
    input  logic       clk_50mhz,
    input  logic [1:0] btn_n,
    output logic [1:0] led_n
);
    logic [BLINK_BIT:0] counter = '0;

    always_ff @(posedge clk_50mhz) begin
        if (!btn_n[1]) counter <= '0;
        else           counter <= counter + 1'b1;
    end

    // Both the buttons and LEDs are active-low.
    assign led_n[0] = btn_n[0];
    assign led_n[1] = ~counter[BLINK_BIT];
endmodule

`default_nettype wire

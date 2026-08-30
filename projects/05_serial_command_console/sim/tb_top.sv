`timescale 1ns/1ps
`default_nettype none

module tb_top;
    localparam integer CLOCK_HZ = 27_000_000;
    localparam integer BAUD_RATE = 115_200;
    localparam integer CLKS_PER_BIT = (CLOCK_HZ + BAUD_RATE / 2) / BAUD_RATE;
    logic clk_27mhz = 1'b0, uart_rx = 1'b1;
    logic uart_tx;
    logic [5:0] led_n;
    logic [7:0] received;
    top dut (.*);
    always #5 clk_27mhz = ~clk_27mhz;

    task automatic receive_byte(output logic [7:0] value);
        @(negedge uart_tx);
        repeat (CLKS_PER_BIT / 2) @(posedge clk_27mhz);
        if (uart_tx !== 1'b0) $fatal(1, "TX start bit invalid");
        for (integer bit_no = 0; bit_no < 8; bit_no++) begin repeat (CLKS_PER_BIT) @(posedge clk_27mhz); value[bit_no] = uart_tx; end
        repeat (CLKS_PER_BIT) @(posedge clk_27mhz);
        if (uart_tx !== 1'b1) $fatal(1, "TX stop bit invalid");
    endtask

    task automatic send_byte(input logic [7:0] value);
        @(negedge clk_27mhz); uart_rx = 1'b0;
        repeat (CLKS_PER_BIT) @(posedge clk_27mhz);
        for (integer bit_no = 0; bit_no < 8; bit_no++) begin @(negedge clk_27mhz); uart_rx = value[bit_no]; repeat (CLKS_PER_BIT) @(posedge clk_27mhz); end
        @(negedge clk_27mhz); uart_rx = 1'b1;
        // Return before the FPGA can begin its first reply byte.
        repeat ((CLKS_PER_BIT / 2) + 2) @(posedge clk_27mhz);
    endtask

    task automatic expect_response(input integer id, input integer length);
        for (integer index = 0; index < length; index++) begin
            receive_byte(received);
            if (received !== dut.response_byte(id[3:0], index[6:0]))
                $fatal(1, "Response %0d byte %0d expected %02x got %02x", id, index, dut.response_byte(id[3:0], index[6:0]), received);
        end
    endtask

    task automatic send_ping;
        send_byte("P"); send_byte("I"); send_byte("N"); send_byte("G"); send_byte(8'h0d);
    endtask
    task automatic send_led_on;
        send_byte("l"); send_byte("e"); send_byte("d"); send_byte(" "); send_byte("o"); send_byte("n"); send_byte(8'h0d);
    endtask
    task automatic send_status;
        send_byte("S"); send_byte("T"); send_byte("A"); send_byte("T"); send_byte("U"); send_byte("S"); send_byte(8'h0d);
    endtask
    task automatic send_overlong_led_off;
        send_byte("L"); send_byte("E"); send_byte("D"); send_byte(" "); send_byte("O"); send_byte("F"); send_byte("F"); send_byte("X"); send_byte(8'h0d);
    endtask

    initial begin
        $dumpfile("build/waves.vcd"); $dumpvars(0, tb_top);
        expect_response(0, 45);
        send_ping(); expect_response(2, 32);
        send_led_on(); expect_response(3, 23);
        if (led_n !== 6'b111110) $fatal(1, "LED ON command did not turn on LED 0");
        send_status(); expect_response(5, 40);
        send_overlong_led_off(); expect_response(8, 41);
        if (led_n !== 6'b111110) $fatal(1, "Overlong command incorrectly changed LED state");
        $display("PASS: startup, case-insensitive commands, overflow-safe replies, and LED state verified");
        $finish;
    end
endmodule

`default_nettype wire

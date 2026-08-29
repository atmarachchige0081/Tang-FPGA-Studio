`timescale 1ns/1ps
`default_nettype none

module tb_top;
    logic clk_50mhz = 1'b0;
    logic [1:0] btn_n = 2'b11;
    logic [1:0] led_n;

    top #(.BLINK_BIT(2)) dut (.*);
    always #10 clk_50mhz = ~clk_50mhz;

    initial begin
        $dumpfile("build/waves.vcd");
        $dumpvars(0, tb_top);

        btn_n[1] = 1'b0;
        repeat (2) @(posedge clk_50mhz);
        btn_n[1] = 1'b1;
        repeat (5) @(posedge clk_50mhz);
        if (led_n[1] !== 1'b0) $fatal(1, "Blink counter did not advance");

        btn_n[0] = 1'b0;
        #1;
        if (led_n[0] !== 1'b0) $fatal(1, "USER button did not light LED 0");

        btn_n[1] = 1'b0;
        repeat (2) @(posedge clk_50mhz);
        #1;
        if (dut.counter !== '0) $fatal(1, "RESET button did not clear the counter");

        $display("PASS: Tang Console buttons, reset, and LED behavior");
        $finish;
    end
endmodule

`default_nettype wire

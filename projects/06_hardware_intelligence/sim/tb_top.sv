`timescale 1ns/1ps
`default_nettype none

module tb_top;
    localparam integer CLOCK_HZ = 8_000_000;
    localparam integer BAUD_RATE = 1_000_000;
    localparam integer CLKS_PER_BIT = CLOCK_HZ / BAUD_RATE;
    logic clk_27mhz = 1'b0;
    logic uart_rx = 1'b1;
    wire uart_tx;
    wire [5:0] led_n;

    top #(.CLOCK_HZ(CLOCK_HZ), .BAUD_RATE(BAUD_RATE)) dut (.*);
    always #5 clk_27mhz = ~clk_27mhz;

    task automatic send_byte(input logic [7:0] value);
        uart_rx = 1'b0; repeat (CLKS_PER_BIT) @(posedge clk_27mhz);
        for (integer bit_no = 0; bit_no < 8; bit_no++) begin uart_rx = value[bit_no]; repeat (CLKS_PER_BIT) @(posedge clk_27mhz); end
        uart_rx = 1'b1; repeat (CLKS_PER_BIT) @(posedge clk_27mhz);
    endtask

    task automatic receive_byte(output logic [7:0] value);
        @(negedge uart_tx); repeat (CLKS_PER_BIT + CLKS_PER_BIT / 2) @(posedge clk_27mhz);
        for (integer bit_no = 0; bit_no < 8; bit_no++) begin value[bit_no] = uart_tx; repeat (CLKS_PER_BIT) @(posedge clk_27mhz); end
        if (uart_tx !== 1'b1) $fatal(1, "UART stop bit was not high");
    endtask

    logic [7:0] reply;
    initial begin
        $dumpfile("build/waves.vcd");
        $dumpvars(0, tb_top);
        // The design deliberately holds reset for 255 clocks so power-up is
        // deterministic on real hardware.  Wait for that contract instead of
        // coupling the test to an arbitrary delay.
        wait (dut.rst_n === 1'b1);
        repeat (2) @(posedge clk_27mhz);
        fork send_byte("P"); receive_byte(reply); join
        if (reply !== "K") $fatal(1, "Expected friendly K reply, got %h", reply);
        if (dut.event_count !== 8'd1) $fatal(1, "Event counter did not record the command");
        if (dut.error_flag !== 1'b0) $fatal(1, "Unexpected protocol error");
        if (dut.pwm_level !== 8'd81) $fatal(1, "P command did not update the PWM level");
        if (dut.timing_result === 16'h0000) $fatal(1, "Timing lesson path did not produce observable state");
        $display("PASS: UART, FSM, PWM, counter, and optimization-path state verified");
        $finish;
    end

    initial begin
        #100_000;
        $fatal(1, "Simulation timeout");
    end
endmodule

`default_nettype wire

`timescale 1ns/1ps
`default_nettype none

module top (
    input  logic       clk_27mhz,
    input  logic [4:0] btn_n,
    input  logic       uart_rx,
    output logic       uart_tx,
    output logic [5:0] led_n
);
    localparam logic [5:0] GREETING_LAST_INDEX = 6'd29;

    // The configuration image supplies the initial value; a button can then
    // restart the lesson and both UART state machines deterministically.
    /* verilator lint_off PROCASSINIT */
    logic [7:0] power_on_count = '0;
    logic       rst_n;
    logic [7:0] rx_data;
    logic       rx_valid;
    logic       rx_framing_error;
    logic [7:0] tx_data;
    logic       tx_valid;
    logic       tx_ready;
    logic [5:0] greeting_index;
    logic       greeting_active;
    logic [7:0] echo_data;
    logic       echo_pending;
    logic [5:0] last_received;

    // Any user button restarts the lesson. The short delay resets both UARTs.
    always_ff @(posedge clk_27mhz) begin
        if (~&btn_n)
            power_on_count <= '0;
        else if (~&power_on_count)
            power_on_count <= power_on_count + 1'b1;
    end
    /* verilator lint_on PROCASSINIT */
    assign rst_n = &power_on_count;

    function automatic logic [7:0] greeting_byte(input logic [5:0] index);
        case (index)
            0: greeting_byte = "T";  1: greeting_byte = "a";
            2: greeting_byte = "n";  3: greeting_byte = "g";
            4: greeting_byte = " ";  5: greeting_byte = "P";
            6: greeting_byte = "r";  7: greeting_byte = "i";
            8: greeting_byte = "m";  9: greeting_byte = "e";
            10: greeting_byte = "r"; 11: greeting_byte = " ";
            12: greeting_byte = "2"; 13: greeting_byte = "0";
            14: greeting_byte = "K"; 15: greeting_byte = " ";
            16: greeting_byte = "U"; 17: greeting_byte = "A";
            18: greeting_byte = "R"; 19: greeting_byte = "T";
            20: greeting_byte = " "; 21: greeting_byte = "r";
            22: greeting_byte = "e"; 23: greeting_byte = "a";
            24: greeting_byte = "d"; 25: greeting_byte = "y";
            26: greeting_byte = 8'h0d; 27: greeting_byte = 8'h0a;
            28: greeting_byte = ">"; 29: greeting_byte = " ";
            default: greeting_byte = 8'h00;
        endcase
    endfunction

    uart_rx receiver (
        .clk             (clk_27mhz),
        .rst_n           (rst_n),
        .rx_i            (uart_rx),
        .data_o          (rx_data),
        .valid_o         (rx_valid),
        .framing_error_o (rx_framing_error)
    );

    uart_tx transmitter (
        .clk     (clk_27mhz),
        .rst_n   (rst_n),
        .data_i  (tx_data),
        .valid_i (tx_valid),
        .ready_o (tx_ready),
        .tx_o    (uart_tx)
    );

    // Hold valid/data until accepted. The greeting has priority, then RX echoes.
    always_ff @(posedge clk_27mhz) begin
        if (!rst_n) begin
            tx_data         <= '0;
            tx_valid        <= 1'b0;
            greeting_index  <= '0;
            greeting_active <= 1'b1;
            echo_data       <= '0;
            echo_pending    <= 1'b0;
            last_received   <= '0;
        end else begin
            if (rx_valid) begin
                echo_data     <= rx_data;
                echo_pending  <= 1'b1;
                last_received <= rx_data[5:0];
            end

            if (tx_valid && tx_ready) begin
                tx_valid <= 1'b0;
                if (greeting_active) begin
                    if (greeting_index == GREETING_LAST_INDEX)
                        greeting_active <= 1'b0;
                    else
                        greeting_index <= greeting_index + 1'b1;
                end
            end

            if (!tx_valid) begin
                if (greeting_active) begin
                    tx_data  <= greeting_byte(greeting_index);
                    tx_valid <= 1'b1;
                end else if (echo_pending) begin
                    tx_data      <= echo_data;
                    tx_valid     <= 1'b1;
                    echo_pending <= 1'b0;
                end
            end

            if (rx_framing_error)
                last_received <= 6'h3f;
        end
    end

    // Active-low LEDs show the low six bits of the most recent byte.
    assign led_n = ~last_received;
endmodule

`default_nettype wire

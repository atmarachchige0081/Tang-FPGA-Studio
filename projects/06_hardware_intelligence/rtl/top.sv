`timescale 1ns/1ps
`default_nettype none

module top #(
    parameter integer CLOCK_HZ = 27_000_000,
    parameter integer BAUD_RATE = 115_200
) (
    input  wire       clk_27mhz,
    input  wire       uart_rx,
    output wire       uart_tx,
    output wire [5:0] led_n
);
    // Intentional FPGA power-on initialization for this pin-minimal demo.
    /* verilator lint_off PROCASSINIT */
    logic [7:0] reset_pipe = '0;
    wire rst_n = &reset_pipe;
    always_ff @(posedge clk_27mhz) if (!rst_n) reset_pipe <= reset_pipe + 1'b1;
    /* verilator lint_on PROCASSINIT */

    logic [23:0] heartbeat_counter;
    logic [7:0] event_count;
    logic [7:0] last_command;
    logic [2:0] protocol_state;
    logic error_flag;
    logic [7:0] pwm_counter;
    logic [7:0] pwm_level;
    logic [15:0] timing_result;
    logic [15:0] timing_mix;
    wire pwm_out = pwm_counter < pwm_level;

    // This intentionally long, functionally harmless combinational chain gives
    // the Trace and Design Health lessons a meaningful optimization target.
    // The result is registered so nextpnr can report a real register-to-register
    // path; experiments never rewrite this source automatically.
    always_comb begin
        timing_mix = {event_count, last_command};
        timing_mix = (timing_mix + 16'h1357) ^ {last_command, event_count};
        timing_mix = (timing_mix << 3) ^ (timing_mix >> 2) ^ 16'hA53C;
        timing_mix = timing_mix + {8'h00, pwm_level} + 16'h0249;
        timing_mix = (timing_mix ^ (timing_mix << 5)) + 16'h1021;
    end

    logic [7:0] rx_data;
    logic rx_valid, rx_error;
    logic [7:0] tx_data;
    logic tx_valid, tx_ready;

    demo_uart_rx #(.CLOCK_HZ(CLOCK_HZ), .BAUD_RATE(BAUD_RATE)) receiver (
        .clk(clk_27mhz), .rst_n(rst_n), .rx_i(uart_rx),
        .data_o(rx_data), .valid_o(rx_valid), .framing_error_o(rx_error)
    );
    demo_uart_tx #(.CLOCK_HZ(CLOCK_HZ), .BAUD_RATE(BAUD_RATE)) transmitter (
        .clk(clk_27mhz), .rst_n(rst_n), .data_i(tx_data), .valid_i(tx_valid),
        .ready_o(tx_ready), .tx_o(uart_tx)
    );

    always_ff @(posedge clk_27mhz) begin
        if (!rst_n) begin
            heartbeat_counter <= '0;
            event_count <= '0;
            last_command <= '0;
            protocol_state <= '0;
            error_flag <= 1'b0;
            pwm_counter <= '0;
            pwm_level <= 8'd64;
            timing_result <= '0;
            tx_data <= '0;
            tx_valid <= 1'b0;
        end else begin
            heartbeat_counter <= heartbeat_counter + 1'b1;
            pwm_counter <= pwm_counter + 1'b1;
            timing_result <= timing_mix;
            tx_valid <= 1'b0;
            if (rx_error) error_flag <= 1'b1;
            if (rx_valid) begin
                last_command <= rx_data;
                event_count <= event_count + 1'b1;
                if (rx_data == "P") pwm_level <= pwm_level + 8'd17;
                protocol_state <= 3'd1;
                if (tx_ready) begin
                    tx_data <= rx_data == "P" ? "K" : "?";
                    tx_valid <= 1'b1;
                    protocol_state <= rx_data == "P" ? 3'd2 : 3'd3;
                end else begin
                    error_flag <= 1'b1;
                    protocol_state <= 3'd4;
                end
            end else if (protocol_state != 0 && tx_ready) begin
                protocol_state <= '0;
            end
        end
    end

    // Active-low LEDs expose the same state that is useful in the analyzer.
    // Fold every registered timing-result bit into the final lesson LED. This
    // keeps the complete optimization path observable in synthesis and avoids
    // tool-version-dependent pruning of bits 15:1.
    assign led_n = ~{heartbeat_counter[23], error_flag, protocol_state[1:0], pwm_out, ^timing_result};
endmodule

module demo_uart_rx #(
    parameter integer CLOCK_HZ = 27_000_000,
    parameter integer BAUD_RATE = 115_200
) (
    input wire clk, input wire rst_n, input wire rx_i,
    output logic [7:0] data_o, output logic valid_o, output logic framing_error_o
);
    localparam integer CLKS_PER_BIT = (CLOCK_HZ + BAUD_RATE / 2) / BAUD_RATE;
    localparam integer COUNT_WIDTH = CLKS_PER_BIT <= 1 ? 1 : $clog2(CLKS_PER_BIT);
    localparam logic [COUNT_WIDTH-1:0] HALF_COUNT = COUNT_WIDTH'((CLKS_PER_BIT / 2) - 1);
    localparam logic [COUNT_WIDTH-1:0] LAST_COUNT = COUNT_WIDTH'(CLKS_PER_BIT - 1);
    typedef enum logic [1:0] {IDLE, START, DATA, STOP} state_t;
    state_t state;
    logic [COUNT_WIDTH-1:0] count;
    logic [2:0] bit_index;
    logic [7:0] shift;
    always_ff @(posedge clk) begin
        if (!rst_n) begin
            state <= IDLE; count <= '0; bit_index <= '0; shift <= '0;
            data_o <= '0; valid_o <= 1'b0; framing_error_o <= 1'b0;
        end else begin
            valid_o <= 1'b0; framing_error_o <= 1'b0;
            case (state)
                IDLE: begin count <= '0; bit_index <= '0; if (!rx_i) state <= START; end
                START: if (count == HALF_COUNT) begin count <= '0; if (rx_i) state <= IDLE; else state <= DATA; end else count <= count + 1'b1;
                DATA: if (count == LAST_COUNT) begin count <= '0; shift[bit_index] <= rx_i; if (bit_index == 3'd7) begin bit_index <= '0; state <= STOP; end else bit_index <= bit_index + 1'b1; end else count <= count + 1'b1;
                STOP: if (count == LAST_COUNT) begin count <= '0; state <= IDLE; if (rx_i) begin data_o <= shift; valid_o <= 1'b1; end else framing_error_o <= 1'b1; end else count <= count + 1'b1;
                default: state <= IDLE;
            endcase
        end
    end
endmodule

module demo_uart_tx #(
    parameter integer CLOCK_HZ = 27_000_000,
    parameter integer BAUD_RATE = 115_200
) (
    input wire clk, input wire rst_n, input wire [7:0] data_i, input wire valid_i,
    output wire ready_o, output wire tx_o
);
    localparam integer CLKS_PER_BIT = (CLOCK_HZ + BAUD_RATE / 2) / BAUD_RATE;
    localparam integer COUNT_WIDTH = CLKS_PER_BIT <= 1 ? 1 : $clog2(CLKS_PER_BIT);
    localparam logic [COUNT_WIDTH-1:0] LAST_COUNT = COUNT_WIDTH'(CLKS_PER_BIT - 1);
    logic [COUNT_WIDTH-1:0] count;
    logic [3:0] bit_index;
    logic [9:0] frame;
    logic busy;
    assign ready_o = ~busy;
    assign tx_o = busy ? frame[bit_index] : 1'b1;
    always_ff @(posedge clk) begin
        if (!rst_n) begin count <= '0; bit_index <= '0; frame <= 10'h3ff; busy <= 1'b0; end
        else if (!busy) begin count <= '0; bit_index <= '0; if (valid_i) begin frame <= {1'b1, data_i, 1'b0}; busy <= 1'b1; end end
        else if (count == LAST_COUNT) begin count <= '0; if (bit_index == 4'd9) begin bit_index <= '0; busy <= 1'b0; end else bit_index <= bit_index + 1'b1; end
        else count <= count + 1'b1;
    end
endmodule

`default_nettype wire

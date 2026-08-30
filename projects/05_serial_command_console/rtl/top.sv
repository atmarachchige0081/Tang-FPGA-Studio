`timescale 1ns/1ps
`default_nettype none

module top (
    input logic clk_27mhz,
    input logic uart_rx,
    output logic uart_tx,
    output logic [5:0] led_n
);
    localparam logic [3:0] R_WELCOME = 4'd0, R_HELP = 4'd1, R_PONG = 4'd2,
        R_LED_ON = 4'd3, R_LED_OFF = 4'd4, R_STATUS_ON = 4'd5,
        R_STATUS_OFF = 4'd6, R_ABOUT = 4'd7, R_UNKNOWN = 4'd8;
    localparam integer WELCOME_LEN = 45, HELP_LEN = 56, PONG_LEN = 32,
        LED_ON_LEN = 23, LED_OFF_LEN = 24, STATUS_ON_LEN = 40,
        STATUS_OFF_LEN = 41, ABOUT_LEN = 45, UNKNOWN_LEN = 41;
    localparam logic [WELCOME_LEN*8-1:0] WELCOME = "FPGA console ready\r\nType HELP then Enter.\r\n> ";
    localparam logic [HELP_LEN*8-1:0] HELP_TEXT = "Commands: HELP, PING, LED ON, LED OFF, STATUS, ABOUT\r\n> ";
    localparam logic [PONG_LEN*8-1:0] PONG = "PONG - your UART link works!\r\n> ";
    localparam logic [LED_ON_LEN*8-1:0] LED_ON_TEXT = "OK - LED is now ON.\r\n> ";
    localparam logic [LED_OFF_LEN*8-1:0] LED_OFF_TEXT = "OK - LED is now OFF.\r\n> ";
    localparam logic [STATUS_ON_LEN*8-1:0] STATUS_ON = "STATUS: link OK, LED ON, 115200 baud\r\n> ";
    localparam logic [STATUS_OFF_LEN*8-1:0] STATUS_OFF = "STATUS: link OK, LED OFF, 115200 baud\r\n> ";
    localparam logic [ABOUT_LEN*8-1:0] ABOUT_TEXT = "Tang FPGA Studio beginner command console\r\n> ";
    localparam logic [UNKNOWN_LEN*8-1:0] UNKNOWN = "I do not know that command. Try HELP.\r\n> ";

    // Gowin configuration memory initializes this counter so the design can
    // create a short power-on reset without consuming a board input pin.
    /* verilator lint_off PROCASSINIT */
    logic [7:0] power_on_count = '0;
    logic rst_n;
    logic [7:0] rx_data, tx_data;
    logic rx_valid, rx_error, tx_valid, tx_ready;
    logic [55:0] command_buffer;
    logic [4:0] command_length;
    logic command_overflow;
    logic [3:0] response_id;
    logic [6:0] response_index;
    logic response_active;
    logic led_on;

    assign rst_n = &power_on_count;
    assign led_n = {5'b11111, ~led_on};
    always_ff @(posedge clk_27mhz) if (!rst_n) power_on_count <= power_on_count + 1'b1;
    /* verilator lint_on PROCASSINIT */

    function automatic logic [7:0] upper(input logic [7:0] value);
        upper = (value >= "a" && value <= "z") ? value - 8'd32 : value;
    endfunction

    function automatic integer response_length(input logic [3:0] id);
        case (id)
            R_WELCOME: response_length = WELCOME_LEN; R_HELP: response_length = HELP_LEN;
            R_PONG: response_length = PONG_LEN; R_LED_ON: response_length = LED_ON_LEN;
            R_LED_OFF: response_length = LED_OFF_LEN; R_STATUS_ON: response_length = STATUS_ON_LEN;
            R_STATUS_OFF: response_length = STATUS_OFF_LEN; R_ABOUT: response_length = ABOUT_LEN;
            default: response_length = UNKNOWN_LEN;
        endcase
    endfunction

    function automatic logic [7:0] response_byte(input logic [3:0] id, input logic [6:0] index);
        case (id)
            R_WELCOME: response_byte = WELCOME[(WELCOME_LEN-1-integer'(index))*8 +: 8];
            R_HELP: response_byte = HELP_TEXT[(HELP_LEN-1-integer'(index))*8 +: 8];
            R_PONG: response_byte = PONG[(PONG_LEN-1-integer'(index))*8 +: 8];
            R_LED_ON: response_byte = LED_ON_TEXT[(LED_ON_LEN-1-integer'(index))*8 +: 8];
            R_LED_OFF: response_byte = LED_OFF_TEXT[(LED_OFF_LEN-1-integer'(index))*8 +: 8];
            R_STATUS_ON: response_byte = STATUS_ON[(STATUS_ON_LEN-1-integer'(index))*8 +: 8];
            R_STATUS_OFF: response_byte = STATUS_OFF[(STATUS_OFF_LEN-1-integer'(index))*8 +: 8];
            R_ABOUT: response_byte = ABOUT_TEXT[(ABOUT_LEN-1-integer'(index))*8 +: 8];
            default: response_byte = UNKNOWN[(UNKNOWN_LEN-1-integer'(index))*8 +: 8];
        endcase
    endfunction

    uart_rx receiver (.clk(clk_27mhz), .rst_n(rst_n), .rx_i(uart_rx), .data_o(rx_data), .valid_o(rx_valid), .framing_error_o(rx_error));
    uart_tx transmitter (.clk(clk_27mhz), .rst_n(rst_n), .data_i(tx_data), .valid_i(tx_valid), .ready_o(tx_ready), .tx_o(uart_tx));

    always_ff @(posedge clk_27mhz) begin
        if (!rst_n) begin
            command_buffer <= '0; command_length <= '0; command_overflow <= 1'b0; response_id <= R_WELCOME;
            response_index <= '0; response_active <= 1'b1; tx_data <= '0;
            tx_valid <= 1'b0; led_on <= 1'b0;
        end else begin
            if (tx_valid && tx_ready) begin
                tx_valid <= 1'b0;
                if (integer'(response_index) + 1 >= response_length(response_id)) begin
                    response_index <= '0; response_active <= 1'b0;
                end else response_index <= response_index + 1'b1;
            end
            if (!tx_valid && response_active) begin
                tx_data <= response_byte(response_id, response_index);
                tx_valid <= 1'b1;
            end
            if (rx_valid && !response_active) begin
                if (rx_data == 8'h0d || rx_data == 8'h0a) begin
                    if (command_length != 0) begin
                        response_index <= '0; response_active <= 1'b1;
                        if (command_overflow) response_id <= R_UNKNOWN;
                        else if (command_length == 4 && command_buffer[31:0] == "HELP") response_id <= R_HELP;
                        else if (command_length == 4 && command_buffer[31:0] == "PING") response_id <= R_PONG;
                        else if (command_length == 6 && command_buffer[47:0] == "LED ON") begin response_id <= R_LED_ON; led_on <= 1'b1; end
                        else if (command_length == 7 && command_buffer[55:0] == "LED OFF") begin response_id <= R_LED_OFF; led_on <= 1'b0; end
                        else if (command_length == 6 && command_buffer[47:0] == "STATUS") response_id <= led_on ? R_STATUS_ON : R_STATUS_OFF;
                        else if (command_length == 5 && command_buffer[39:0] == "ABOUT") response_id <= R_ABOUT;
                        else response_id <= R_UNKNOWN;
                    end
                    command_buffer <= '0; command_length <= '0; command_overflow <= 1'b0;
                end else if (rx_data >= 8'h20 && rx_data <= 8'h7e) begin
                    if (command_length < 7) begin
                        command_buffer <= {command_buffer[47:0], upper(rx_data)};
                        command_length <= command_length + 1'b1;
                    end else begin
                        command_overflow <= 1'b1;
                    end
                end
            end
            if (rx_error) begin command_buffer <= '0; command_length <= '0; command_overflow <= 1'b0; end
        end
    end
endmodule

`default_nettype wire

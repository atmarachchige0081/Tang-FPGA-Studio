import { describe, expect, it } from "vitest";
import type { WaveSignal } from "../types";
import { busPaths, formatSignalValue, formatVcdTime, scalarPoints, valueAt } from "./waveform";

const signal = (width: number, samples: WaveSignal["samples"]): WaveSignal => ({ id: "!", name: "value", scope: "tb", width, samples });

describe("waveform rendering", () => {
  it("renders a constant bus as two horizontal rails", () => {
    const paths = busPaths(signal(8, [{ time: 0, value: "10100101" }]), { start: 0, end: 100 });
    expect(paths.top).toBe("M0 8 L480 8");
    expect(paths.bottom).toBe("M0 30 L480 30");
  });

  it("uses vertical steps for scalar changes", () => {
    expect(scalarPoints(signal(1, [{ time: 0, value: "0" }, { time: 50, value: "1" }]), { start: 0, end: 100 }))
      .toBe("0,30 240,30 240,7 480,7");
  });

  it("finds and formats values at the visible cursor time", () => {
    const bus = signal(8, [{ time: 0, value: "00000000" }, { time: 20, value: "10100101" }]);
    expect(valueAt(bus, 19)).toBe("00000000");
    expect(formatSignalValue(bus, 20)).toBe("0xA5");
  });

  it("converts raw VCD ticks into readable engineering units", () => {
    expect(formatVcdTime(2_615_000, "1ps", 2_615_000)).toBe("2.615 µs");
    expect(formatVcdTime(523_000, "1 ps", 2_615_000)).toBe("0.523 µs");
  });
});
it("does not render a future first scalar sample as already present",()=>{
 expect(scalarPoints(signal(1,[{time:50,value:"1"}]),{start:0,end:100})).toBe("0,19 240,19 240,7 480,7");
});

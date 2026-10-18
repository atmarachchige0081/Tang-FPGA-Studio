import type { WaveSignal } from "../types";

export interface WaveWindow {
  start: number;
  end: number;
}

const WIDTH = 480;

function normalizedWindow(window: WaveWindow): WaveWindow {
  return window.end > window.start ? window : { start: window.start, end: window.start + 1 };
}

function xAt(time: number, window: WaveWindow): number {
  const safe = normalizedWindow(window);
  return Math.max(0, Math.min(WIDTH, (time - safe.start) / (safe.end - safe.start) * WIDTH));
}

export function valueAt(signal: WaveSignal, time: number): string | undefined {
  let low = 0;
  let high = signal.samples.length - 1;
  let result: string | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const sample = signal.samples[middle]!;
    if (sample.time <= time) {
      result = sample.value;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

export function visibleTransitions(signal: WaveSignal, window: WaveWindow): number {
  return Math.max(0, firstIndexAfter(signal, window.end) - firstIndexAfter(signal, window.start));
}

function firstIndexAfter(signal: WaveSignal, time: number): number {
  let low = 0;
  let high = signal.samples.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (signal.samples[middle]!.time <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function scalarPoints(signal: WaveSignal, window: WaveWindow): string {
  const level = (value: string | undefined) => value === "1" ? 7 : value === "0" ? 30 : 19;
  let previous = valueAt(signal, window.start);
  const points = [`0,${level(previous)}`];
  for (let index = firstIndexAfter(signal, window.start); index < signal.samples.length; index += 1) {
    const sample = signal.samples[index]!;
    if (sample.time > window.end) break;
    const x = xAt(sample.time, window);
    points.push(`${x},${level(previous)}`, `${x},${level(sample.value)}`);
    previous = sample.value;
  }
  points.push(`${WIDTH},${level(previous)}`);
  return points.join(" ");
}

export function busPaths(signal: WaveSignal, window: WaveWindow): { top: string; bottom: string } {
  const top = ["M0 8"];
  const bottom = ["M0 30"];
  for (let index = firstIndexAfter(signal, window.start); index < signal.samples.length; index += 1) {
    const sample = signal.samples[index]!;
    if (sample.time > window.end) break;
    const x = xAt(sample.time, window);
    const shoulder = Math.min(3, x, WIDTH - x);
    top.push(`L${x - shoulder} 8 L${x} 19 L${x + shoulder} 8`);
    bottom.push(`L${x - shoulder} 30 L${x} 19 L${x + shoulder} 30`);
  }
  top.push(`L${WIDTH} 8`);
  bottom.push(`L${WIDTH} 30`);
  return { top: top.join(" "), bottom: bottom.join(" ") };
}

export function formatSignalValue(signal: WaveSignal, time: number): string {
  const value = valueAt(signal, time) ?? "—";
  if (signal.width === 1 || /[xz]/i.test(value)) return value;
  const parsed = Number.parseInt(value, 2);
  return Number.isSafeInteger(parsed) ? `0x${parsed.toString(16).toUpperCase()}` : value;
}

const SECOND_FACTORS: Record<string, number> = {
  fs: 1e-15,
  ps: 1e-12,
  ns: 1e-9,
  us: 1e-6,
  "µs": 1e-6,
  ms: 1e-3,
  s: 1,
};

function secondsPerTick(timescale: string): number | null {
  const match = timescale.trim().match(/^(\d+(?:\.\d+)?)\s*(fs|ps|ns|us|µs|ms|s)$/i);
  if (!match) return null;
  return Number(match[1]) * SECOND_FACTORS[match[2]!.toLowerCase()]!;
}

export function formatVcdTime(ticks: number, timescale: string, referenceTicks = ticks): string {
  const tickSeconds = secondsPerTick(timescale);
  if (tickSeconds == null) return `${Math.round(ticks)} ticks`;
  const referenceSeconds = Math.abs(referenceTicks * tickSeconds);
  const units = [
    { name: "s", seconds: 1 },
    { name: "ms", seconds: 1e-3 },
    { name: "µs", seconds: 1e-6 },
    { name: "ns", seconds: 1e-9 },
    { name: "ps", seconds: 1e-12 },
    { name: "fs", seconds: 1e-15 },
  ];
  const unit = units.find((candidate) => referenceSeconds >= candidate.seconds) ?? units.at(-1)!;
  const value = ticks * tickSeconds / unit.seconds;
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(3);
  return `${rounded.replace(/\.0+$|(?<=\.[0-9]*)0+$/g, "")} ${unit.name}`;
}

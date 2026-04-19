import type { PortSample } from "@/lib/rate-buffer";

export const WINDOW_SECONDS = 600;
export const BIN_SECONDS = 5;
export const TREND_BINS = 6;

export function binRatesForSeries(
  buf: PortSample[],
  nowMono: number,
  kind: "mac" | "antenna",
  port: string | undefined,
): Float64Array {
  const binCount = WINDOW_SECONDS / BIN_SECONDS;
  const counts = new Float64Array(binCount);
  const windowStart = nowMono - WINDOW_SECONDS;
  for (const sample of buf) {
    if (sample.t < windowStart) continue;
    if (kind === "antenna" && String(sample.port) !== String(port ?? "")) {
      continue;
    }
    let idx = Math.floor((sample.t - windowStart) / BIN_SECONDS);
    if (idx < 0) idx = 0;
    else if (idx >= binCount) idx = binCount - 1;
    counts[idx] += 1;
  }
  const rates = new Float64Array(binCount);
  for (let i = 0; i < binCount; i++) {
    rates[i] = counts[i] / BIN_SECONDS;
  }
  return rates;
}

export function trendFromRates(rates: Float64Array): Float64Array {
  const binCount = rates.length;
  const trend = new Float64Array(binCount);
  for (let i = 0; i < binCount; i++) {
    const lo = Math.max(0, i - TREND_BINS + 1);
    let s = 0;
    for (let j = lo; j <= i; j++) s += rates[j];
    trend[i] = s / (i - lo + 1);
  }
  return trend;
}

export function buildXs(): Float64Array {
  const binCount = WINDOW_SECONDS / BIN_SECONDS;
  const xs = new Float64Array(binCount);
  for (let i = 0; i < binCount; i++) {
    xs[i] = i * BIN_SECONDS - WINDOW_SECONDS;
  }
  return xs;
}

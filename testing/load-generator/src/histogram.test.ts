import { describe, it, expect } from "vitest";
import { LatencyHistogram } from "./histogram.js";

describe("LatencyHistogram", () => {
  it("computes accurate percentiles across uniform 1..100ms distribution", () => {
    const hist = new LatencyHistogram();
    for (let i = 1; i <= 1000; i++) {
      hist.record(i * 0.1); // 0.1ms to 100.0ms
    }

    const summary = hist.getSummary();
    expect(summary.count).toBe(1000);
    expect(summary.min).toBeCloseTo(0.1, 1);
    expect(summary.max).toBeCloseTo(100.0, 1);
    expect(summary.p50).toBeGreaterThanOrEqual(48);
    expect(summary.p50).toBeLessThanOrEqual(52);
    expect(summary.p99).toBeGreaterThanOrEqual(97);
    expect(summary.p99).toBeLessThanOrEqual(100);
  });

  it("handles high outlier latencies up to 60s without overflow error", () => {
    const hist = new LatencyHistogram();
    hist.record(5.2);
    hist.record(15.8);
    hist.record(250.0);
    hist.record(2500.0);
    hist.record(35000.0);

    const summary = hist.getSummary();
    expect(summary.count).toBe(5);
    expect(summary.min).toBe(5.2);
    expect(summary.max).toBe(35000.0);
  });

  it("returns zero summary when empty", () => {
    const hist = new LatencyHistogram();
    const summary = hist.getSummary();
    expect(summary.count).toBe(0);
    expect(summary.p50).toBe(0);
  });
});


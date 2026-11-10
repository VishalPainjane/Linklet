/**
 * Low-overhead, bounded-memory Latency Histogram.
 * Buckets latencies in milliseconds with high resolution:
 * - 0.00ms to 10.00ms: 0.1ms buckets
 * - 10.0ms to 100.0ms: 0.5ms buckets
 * - 100ms to 1,000ms: 2ms buckets
 * - 1,000ms to 10,000ms: 10ms buckets
 * - 10,000ms to 60,000ms: 50ms buckets
 * Provides exact O(1) sample recording without array allocation or GC distortion.
 */

export interface LatencyPercentiles {
  min: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
  max: number;
  mean: number;
  count: number;
}

export class LatencyHistogram {
  private count = 0;
  private sum = 0;
  private min = Number.MAX_VALUE;
  private max = 0;

  // Tier 1: [0 .. 10ms), step 0.1ms -> 100 buckets
  private readonly tier1 = new Uint32Array(100);

  // Tier 2: [10 .. 100ms), step 0.5ms -> 180 buckets
  private readonly tier2 = new Uint32Array(180);

  // Tier 3: [100 .. 1000ms), step 2.0ms -> 450 buckets
  private readonly tier3 = new Uint32Array(450);

  // Tier 4: [1000 .. 10000ms), step 10ms -> 900 buckets
  private readonly tier4 = new Uint32Array(900);

  // Tier 5: [10000 .. 60000ms], step 50ms -> 1000 buckets
  private readonly tier5 = new Uint32Array(1000);

  // Overflow for extreme outliers > 60,000ms
  private overflowCount = 0;

  public record(latencyMs: number): void {
    if (latencyMs < 0) return;

    this.count += 1;
    this.sum += latencyMs;
    if (latencyMs < this.min) this.min = latencyMs;
    if (latencyMs > this.max) this.max = latencyMs;

    if (latencyMs < 10) {
      const idx = Math.min(99, Math.floor(latencyMs * 10));
      this.tier1[idx]! += 1;
    } else if (latencyMs < 100) {
      const idx = Math.min(179, Math.floor((latencyMs - 10) * 2));
      this.tier2[idx]! += 1;
    } else if (latencyMs < 1000) {
      const idx = Math.min(449, Math.floor((latencyMs - 100) / 2));
      this.tier3[idx]! += 1;
    } else if (latencyMs < 10000) {
      const idx = Math.min(899, Math.floor((latencyMs - 1000) / 10));
      this.tier4[idx]! += 1;
    } else if (latencyMs <= 60000) {
      const idx = Math.min(999, Math.floor((latencyMs - 10000) / 50));
      this.tier5[idx]! += 1;
    } else {
      this.overflowCount += 1;
    }
  }

  public getPercentile(p: number): number {
    if (this.count === 0) return 0;
    if (p <= 0) return this.min;
    if (p >= 100) return this.max;

    const targetRank = Math.ceil((p / 100) * this.count);
    let cumulative = 0;

    // Search Tier 1
    for (let i = 0; i < this.tier1.length; i++) {
      cumulative += this.tier1[i]!;
      if (cumulative >= targetRank) {
        return (i + 0.5) * 0.1;
      }
    }

    // Search Tier 2
    for (let i = 0; i < this.tier2.length; i++) {
      cumulative += this.tier2[i]!;
      if (cumulative >= targetRank) {
        return 10 + (i + 0.5) * 0.5;
      }
    }

    // Search Tier 3
    for (let i = 0; i < this.tier3.length; i++) {
      cumulative += this.tier3[i]!;
      if (cumulative >= targetRank) {
        return 100 + (i + 0.5) * 2;
      }
    }

    // Search Tier 4
    for (let i = 0; i < this.tier4.length; i++) {
      cumulative += this.tier4[i]!;
      if (cumulative >= targetRank) {
        return 1000 + (i + 0.5) * 10;
      }
    }

    // Search Tier 5
    for (let i = 0; i < this.tier5.length; i++) {
      cumulative += this.tier5[i]!;
      if (cumulative >= targetRank) {
        return 10000 + (i + 0.5) * 50;
      }
    }

    return this.max;
  }

  public getSummary(): LatencyPercentiles {
    if (this.count === 0) {
      return {
        min: 0,
        p50: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        p999: 0,
        max: 0,
        mean: 0,
        count: 0,
      };
    }

    return {
      min: Number(this.min.toFixed(2)),
      p50: Number(this.getPercentile(50).toFixed(2)),
      p90: Number(this.getPercentile(90).toFixed(2)),
      p95: Number(this.getPercentile(95).toFixed(2)),
      p99: Number(this.getPercentile(99).toFixed(2)),
      p999: Number(this.getPercentile(99.9).toFixed(2)),
      max: Number(this.max.toFixed(2)),
      mean: Number((this.sum / this.count).toFixed(2)),
      count: this.count,
    };
  }

  public reset(): void {
    this.count = 0;
    this.sum = 0;
    this.min = Number.MAX_VALUE;
    this.max = 0;
    this.overflowCount = 0;
    this.tier1.fill(0);
    this.tier2.fill(0);
    this.tier3.fill(0);
    this.tier4.fill(0);
    this.tier5.fill(0);
  }
}


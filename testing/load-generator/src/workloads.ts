import { generateCode } from "@linklet/code-generator";
import type { ScenarioType } from "./types.js";

export interface RequestSpec {
  method: "GET" | "POST" | "HEAD";
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Approximate Zipfian distribution generator.
 * Models real-world internet URL popularity where a small fraction of links receive the majority of clicks.
 */
export class ZipfianGenerator {
  private readonly items: string[];
  private readonly cdf: Float64Array;

  constructor(items: string[], s = 1.0) {
    if (items.length === 0) throw new Error("Items cannot be empty");
    this.items = items;
    this.cdf = new Float64Array(items.length);

    // Compute Zipf normalization constant
    let sum = 0;
    for (let i = 1; i <= items.length; i++) {
      sum += 1 / Math.pow(i, s);
    }

    // Cumulative Distribution Function
    let cumulative = 0;
    for (let i = 0; i < items.length; i++) {
      cumulative += 1 / Math.pow(i + 1, s) / sum;
      this.cdf[i] = cumulative;
    }
  }

  public sample(): string {
    const r = Math.random();
    // Binary search in CDF
    let low = 0;
    let high = this.cdf.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.cdf[mid]! < r) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return this.items[low]!;
  }
}

export interface WorkloadGenerator {
  nextRequest(): RequestSpec;
  setup?(baseUrl: string): Promise<void>;
}

export function createWorkload(scenario: ScenarioType): WorkloadGenerator {
  switch (scenario) {
    case "redirect-warm": {
      // Small corpus of 50 keys, easily kept in L0/L1 cache
      const warmCodes = Array.from({ length: 50 }, (_, i) => `warm_${i}`);
      let counter = 0;
      return {
        nextRequest() {
          const code = warmCodes[counter % warmCodes.length]!;
          counter += 1;
          return { method: "GET", path: `/${code}` };
        },
      };
    }

    case "redirect-cold": {
      // Generates completely random keys that will miss cache
      return {
        nextRequest() {
          const randomCode = generateCode(8);
          return { method: "GET", path: `/${randomCode}` };
        },
      };
    }

    case "redirect-zipf": {
      // 10,000 keys with s=0.9 Zipf skew (top 5% of keys get ~70% of traffic)
      const corpus = Array.from({ length: 1000 }, (_, i) => `zipf_${i}`);
      const zipf = new ZipfianGenerator(corpus, 0.9);
      return {
        nextRequest() {
          const code = zipf.sample();
          return { method: "GET", path: `/${code}` };
        },
      };
    }

    case "mixed-99-1": {
      // 99% reads, 1% writes (blueprint benchmark specification)
      const existingCodes = Array.from({ length: 100 }, (_, i) => `mixed_${i}`);
      let writeCounter = 0;
      return {
        nextRequest() {
          const isWrite = Math.random() < 0.01;
          if (isWrite) {
            writeCounter += 1;
            return {
              method: "POST",
              path: "/api/v1/urls",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                url: `https://example.com/generated-bench-${writeCounter}`,
              }),
            };
          }
          const code = existingCodes[Math.floor(Math.random() * existingCodes.length)]!;
          return { method: "GET", path: `/${code}` };
        },
      };
    }

    case "alias-race": {
      // All requests race for the exact same alias to stress database locks/constraints
      return {
        nextRequest() {
          return {
            method: "POST",
            path: "/api/v1/urls",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: "https://example.com/race-target",
              customAlias: "hot-alias-target",
            }),
          };
        },
      };
    }
  }
}


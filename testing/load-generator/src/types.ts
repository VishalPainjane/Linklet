import type { LatencyPercentiles } from "./histogram.js";

export type WorkloadModel = "open" | "closed";

export type ScenarioType =
  | "redirect-warm"
  | "redirect-cold"
  | "redirect-zipf"
  | "mixed-99-1"
  | "alias-race";

export interface BenchmarkConfig {
  baseUrl: string;
  scenario: ScenarioType;
  model: WorkloadModel;
  durationSeconds: number;
  warmupSeconds?: number | undefined;
  targetRps?: number | undefined; // For Open model
  virtualUsers?: number | undefined; // For Closed model
  thinkTimeMs?: number | undefined; // For Closed model
  maxConnections?: number | undefined;
  pipelining?: number | undefined;
  reportPath?: string | undefined;
}

export interface GeneratorProfile {
  cpuUserSec: number;
  cpuSystemSec: number;
  rssMb: number;
}

export interface BenchmarkReport {
  scenario: ScenarioType;
  model: WorkloadModel;
  targetRps?: number | undefined;
  virtualUsers?: number | undefined;
  durationSeconds: number;
  actualDurationSeconds: number;
  requestsScheduled: number;
  requestsDispatched: number;
  requestsCompleted: number;
  throughputRps: number;
  statusCodes: Record<string, number>;
  timeouts: number;
  networkErrors: number;
  latencyMs: LatencyPercentiles;
  generator: GeneratorProfile;
  timestamp: string;
}

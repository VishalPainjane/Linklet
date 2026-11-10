import { Pool, type Dispatcher } from "undici";
import { performance } from "node:perf_hooks";
import { LatencyHistogram } from "./histogram.js";
import type { BenchmarkConfig, BenchmarkReport, GeneratorProfile } from "./types.js";
import { createWorkload } from "./workloads.js";

export class LoadEngine {
  private readonly config: BenchmarkConfig;
  private readonly histogram = new LatencyHistogram();
  private readonly statusCodes: Record<string, number> = {};
  private timeouts = 0;
  private networkErrors = 0;
  private requestsScheduled = 0;
  private requestsDispatched = 0;
  private requestsCompleted = 0;

  constructor(config: BenchmarkConfig) {
    this.config = config;
  }

  public async run(): Promise<BenchmarkReport> {
    const pool = new Pool(this.config.baseUrl, {
      connections: this.config.maxConnections ?? 50,
      pipelining: this.config.pipelining ?? 1,
      keepAliveTimeout: 10_000,
      keepAliveMaxTimeout: 30_000,
    });

    const workload = createWorkload(this.config.scenario);
    if (workload.setup) {
      await workload.setup(this.config.baseUrl);
    }

    const cpuStart = process.cpuUsage();
    const startTime = performance.now();
    const durationMs = this.config.durationSeconds * 1000;

    console.log(`[load-engine] Starting benchmark: scenario=${this.config.scenario}, model=${this.config.model}, duration=${this.config.durationSeconds}s`);

    if (this.config.model === "open") {
      await this.runOpenWorkload(pool, workload, startTime, durationMs);
    } else {
      await this.runClosedWorkload(pool, workload, startTime, durationMs);
    }

    const endTime = performance.now();
    const actualDurationSeconds = (endTime - startTime) / 1000;
    const cpuDiff = process.cpuUsage(cpuStart);

    await pool.close();

    const generatorProfile: GeneratorProfile = {
      cpuUserSec: Number((cpuDiff.user / 1_000_000).toFixed(2)),
      cpuSystemSec: Number((cpuDiff.system / 1_000_000).toFixed(2)),
      rssMb: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1)),
    };

    const throughputRps = Number(
      (this.requestsCompleted / (actualDurationSeconds > 0 ? actualDurationSeconds : 1)).toFixed(1),
    );

    return {
      scenario: this.config.scenario,
      model: this.config.model,
      targetRps: this.config.targetRps,
      virtualUsers: this.config.virtualUsers,
      durationSeconds: this.config.durationSeconds,
      actualDurationSeconds: Number(actualDurationSeconds.toFixed(2)),
      requestsScheduled: this.requestsScheduled,
      requestsDispatched: this.requestsDispatched,
      requestsCompleted: this.requestsCompleted,
      throughputRps,
      statusCodes: this.statusCodes,
      timeouts: this.timeouts,
      networkErrors: this.networkErrors,
      latencyMs: this.histogram.getSummary(),
      generator: generatorProfile,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Open Workload: schedules request dispatches at constant intervals to meet targetRps,
   * regardless of server completion time. Detects server saturation and tail latency inflation.
   */
  private async runOpenWorkload(
    pool: Pool,
    workload: ReturnType<typeof createWorkload>,
    startTime: number,
    durationMs: number,
  ): Promise<void> {
    const targetRps = this.config.targetRps ?? 1000;
    const intervalMs = 1000 / targetRps;
    const maxInFlight = Math.max(1000, targetRps * 2);

    let activeInFlight = 0;
    const inFlightPromises: Promise<void>[] = [];

    while (performance.now() - startTime < durationMs) {
      this.requestsScheduled += 1;

      if (activeInFlight < maxInFlight) {
        this.requestsDispatched += 1;
        activeInFlight += 1;

        const spec = workload.nextRequest();
        const p = this.executeRequest(pool, spec).finally(() => {
          activeInFlight -= 1;
        });
        inFlightPromises.push(p);
      } else {
        // Generator saturation / server unresponsive: record queue drop
        this.timeouts += 1;
      }

      // Schedule next arrival with precise monotonic sleep
      const nextScheduledTime = startTime + this.requestsScheduled * intervalMs;
      const now = performance.now();
      const delay = nextScheduledTime - now;

      if (delay > 1) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    // Await remaining in-flight requests with bounded 5s drain limit
    await Promise.race([
      Promise.allSettled(inFlightPromises),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
  }

  /**
   * Closed Workload: simulates N concurrent virtual users. Each user executes requests,
   * awaits completion, pauses for thinkTimeMs, and repeats.
   */
  private async runClosedWorkload(
    pool: Pool,
    workload: ReturnType<typeof createWorkload>,
    startTime: number,
    durationMs: number,
  ): Promise<void> {
    const userCount = this.config.virtualUsers ?? 50;
    const thinkTimeMs = this.config.thinkTimeMs ?? 0;

    const virtualUsers = Array.from({ length: userCount }, async () => {
      while (performance.now() - startTime < durationMs) {
        this.requestsScheduled += 1;
        this.requestsDispatched += 1;

        const spec = workload.nextRequest();
        await this.executeRequest(pool, spec);

        if (thinkTimeMs > 0) {
          await new Promise((r) => setTimeout(r, thinkTimeMs));
        }
      }
    });

    await Promise.all(virtualUsers);
  }

  private async executeRequest(
    pool: Pool,
    spec: ReturnType<ReturnType<typeof createWorkload>["nextRequest"]>,
  ): Promise<void> {
    const t0 = performance.now();
    try {
      const reqOptions: Dispatcher.RequestOptions = {
        origin: this.config.baseUrl,
        method: spec.method,
        path: spec.path,
        headersTimeout: 5000,
        bodyTimeout: 5000,
      };
      if (spec.headers) {
        reqOptions.headers = spec.headers;
      }
      if (spec.body) {
        reqOptions.body = spec.body;
      }

      const response = await pool.request(reqOptions);

      // Consume response body to free socket back to pool
      await response.body.dump();

      const elapsed = performance.now() - t0;
      this.histogram.record(elapsed);
      this.requestsCompleted += 1;

      const codeStr = String(response.statusCode);
      this.statusCodes[codeStr] = (this.statusCodes[codeStr] ?? 0) + 1;
    } catch (err: any) {
      const elapsed = performance.now() - t0;
      this.histogram.record(elapsed);

      if (err.code === "UND_ERR_HEADERS_TIMEOUT" || err.code === "UND_ERR_BODY_TIMEOUT") {
        this.timeouts += 1;
      } else {
        this.networkErrors += 1;
      }
    }
  }
}

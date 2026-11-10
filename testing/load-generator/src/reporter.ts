import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { BenchmarkReport } from "./types.js";

export class BenchmarkReporter {
  public static printSummary(report: BenchmarkReport): void {
    const lat = report.latencyMs;

    console.log("\n================================================================================");
    console.log(` LINKLET BENCHMARK REPORT: ${report.scenario.toUpperCase()}`);
    console.log("================================================================================");
    console.log(` Model:                 ${report.model.toUpperCase()} ${report.model === "open" ? `(Target: ${report.targetRps} RPS)` : `(Users: ${report.virtualUsers})`}`);
    console.log(` Duration:              ${report.actualDurationSeconds}s (configured: ${report.durationSeconds}s)`);
    console.log(` Requests Scheduled:    ${report.requestsScheduled.toLocaleString()}`);
    console.log(` Requests Dispatched:   ${report.requestsDispatched.toLocaleString()}`);
    console.log(` Requests Completed:    ${report.requestsCompleted.toLocaleString()}`);
    console.log(` Throughput:            ${report.throughputRps.toLocaleString()} requests/sec`);
    console.log(` Timeouts:              ${report.timeouts}`);
    console.log(` Network Errors:        ${report.networkErrors}`);
    console.log("--------------------------------------------------------------------------------");
    console.log(" HTTP STATUS BREAKDOWN:");
    for (const [code, count] of Object.entries(report.statusCodes)) {
      const pct = ((count / report.requestsCompleted) * 100).toFixed(2);
      console.log(`   HTTP ${code}:         ${count.toLocaleString()} (${pct}%)`);
    }
    console.log("--------------------------------------------------------------------------------");
    console.log(" LATENCY DISTRIBUTION (ms):");
    console.log(`   min:                 ${lat.min.toFixed(2)} ms`);
    console.log(`   p50 (median):        ${lat.p50.toFixed(2)} ms`);
    console.log(`   p90:                 ${lat.p90.toFixed(2)} ms`);
    console.log(`   p95:                 ${lat.p95.toFixed(2)} ms`);
    console.log(`   p99:                 ${lat.p99.toFixed(2)} ms`);
    console.log(`   p99.9:               ${lat.p999.toFixed(2)} ms`);
    console.log(`   max:                 ${lat.max.toFixed(2)} ms`);
    console.log(`   mean:                ${lat.mean.toFixed(2)} ms`);
    console.log("--------------------------------------------------------------------------------");
    console.log(" GENERATOR PROFILE:");
    console.log(`   CPU User / System:   ${report.generator.cpuUserSec}s / ${report.generator.cpuSystemSec}s`);
    console.log(`   RSS Memory:          ${report.generator.rssMb} MB`);
    console.log("================================================================================\n");
  }

  public static async saveJson(report: BenchmarkReport, filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`[reporter] Report saved to ${filePath}`);
  }
}


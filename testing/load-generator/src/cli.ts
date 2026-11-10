import { resolve } from "node:path";
import { LoadEngine } from "./engine.js";
import { BenchmarkReporter } from "./reporter.js";
import type { BenchmarkConfig, ScenarioType, WorkloadModel } from "./types.js";

function parseArgs(): BenchmarkConfig {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`);
    if (idx !== -1 && idx + 1 < args.length) {
      return args[idx + 1];
    }
    return undefined;
  };

  const scenario = (getArg("scenario") ?? "redirect-warm") as ScenarioType;
  const model = (getArg("model") ?? "closed") as WorkloadModel;
  const duration = Number(getArg("duration") ?? 10);
  const targetRps = Number(getArg("rps") ?? 1000);
  const virtualUsers = Number(getArg("users") ?? 50);
  const maxConnections = Number(getArg("connections") ?? 50);
  const baseUrl = getArg("url") ?? "http://localhost:3001";
  const defaultReportPath = resolve(
    process.cwd(),
    `reports/bench-${scenario}-${Date.now()}.json`,
  );
  const reportPath = getArg("report") ?? defaultReportPath;

  return {
    baseUrl,
    scenario,
    model,
    durationSeconds: duration,
    targetRps,
    virtualUsers,
    maxConnections,
    reportPath,
  };
}

async function main() {
  const config = parseArgs();
  const engine = new LoadEngine(config);

  try {
    const report = await engine.run();
    BenchmarkReporter.printSummary(report);

    if (config.reportPath) {
      await BenchmarkReporter.saveJson(report, config.reportPath);
    }
  } catch (err) {
    console.error("[load-generator] Benchmark run failed:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[load-generator] Unhandled fatal error:", err);
  process.exit(1);
});


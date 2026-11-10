"use client";

import { useState } from "react";
import { measurePing } from "../lib/api";
import { Zap, Play, CheckCircle, Timer } from "lucide-react";

interface Props {
  activeCode?: string;
}

export function LatencyProbe({ activeCode = "" }: Props) {
  const [code, setCode] = useState(activeCode);
  const [running, setRunning] = useState(false);
  const [samples, setSamples] = useState<number[]>([]);

  const runProbe = async () => {
    if (!code.trim()) return;
    setRunning(true);
    setSamples([]);

    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      try {
        const ms = await measurePing(code.trim());
        results.push(Number(ms.toFixed(2)));
        setSamples([...results]);
        await new Promise((r) => setTimeout(r, 100)); // 100ms pause
      } catch {
        // Ping error
      }
    }
    setRunning(false);
  };

  const avg =
    samples.length > 0
      ? Number((samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2))
      : 0;
  const min = samples.length > 0 ? Math.min(...samples) : 0;
  const max = samples.length > 0 ? Math.max(...samples) : 0;

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="w-5 h-5 text-amber-400" />
        <h2 className="text-lg font-semibold text-white">Live Latency Probe</h2>
      </div>
      <p className="text-xs text-slate-400 mb-4 font-mono">
        Measure real browser-to-service 302 redirect latency and observe cache warmth.
      </p>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Code to probe (e.g. docs)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="flex-1 px-3.5 py-2 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono transition"
        />
        <button
          onClick={runProbe}
          disabled={running || !code.trim()}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm rounded-xl transition flex items-center gap-1.5"
        >
          <Play className="w-4 h-4" />
          <span>{running ? "Probing..." : "Ping (x5)"}</span>
        </button>
      </div>

      {samples.length > 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-5 gap-2">
            {samples.map((ms, idx) => (
              <div
                key={idx}
                className="p-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-center font-mono"
              >
                <span className="text-[10px] text-slate-500 block">#{idx + 1}</span>
                <span
                  className={`text-sm font-semibold ${
                    idx === 0 ? "text-amber-400" : "text-emerald-400"
                  }`}
                >
                  {ms}ms
                </span>
                {idx === 0 && <span className="text-[9px] text-slate-600 block">Cold/Warm</span>}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl text-xs font-mono text-slate-400">
            <div>
              Min: <span className="text-emerald-400 font-semibold">{min}ms</span>
            </div>
            <div>
              Avg: <span className="text-indigo-400 font-semibold">{avg}ms</span>
            </div>
            <div>
              Max: <span className="text-rose-400 font-semibold">{max}ms</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


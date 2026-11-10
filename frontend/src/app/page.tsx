"use client";

import { useState } from "react";
import { Header } from "../components/Header";
import { CreateUrlForm } from "../components/CreateUrlForm";
import { ResultCard } from "../components/ResultCard";
import { StatsInspector } from "../components/StatsInspector";
import { LatencyProbe } from "../components/LatencyProbe";
import type { CreateUrlResponse } from "../lib/api";
import { Cpu, Database, Server, GitFork, ArrowUpRight } from "lucide-react";

export default function Home() {
  const [latestResult, setLatestResult] = useState<CreateUrlResponse | null>(null);
  const [inspectCode, setInspectCode] = useState<string>("");

  const handleCreated = (result: CreateUrlResponse) => {
    setLatestResult(result);
    setInspectCode(result.code);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#090b11]">
      <Header />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
        {/* Hero Section */}
        <div className="mb-8 text-center max-w-2xl mx-auto">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-3">
            High-Performance{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400">
              URL Shortener Lab
            </span>
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed font-mono">
            Zero-modulo-bias Base62 generation, SingleFlight stampede collapse, transactional
            idempotency, and at-least-once asynchronous event analytics.
          </p>
        </div>

        {/* Systems Architecture Highlights */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <div className="p-3 bg-slate-900/40 border border-slate-800/60 rounded-xl">
            <div className="flex items-center gap-2 text-indigo-400 mb-1">
              <Cpu className="w-4 h-4" />
              <span className="text-xs font-mono font-semibold">Base62 Rejection</span>
            </div>
            <p className="text-[11px] text-slate-500 font-mono">62^8 Keyspace (218T codes)</p>
          </div>

          <div className="p-3 bg-slate-900/40 border border-slate-800/60 rounded-xl">
            <div className="flex items-center gap-2 text-violet-400 mb-1">
              <Database className="w-4 h-4" />
              <span className="text-xs font-mono font-semibold">PostgreSQL PK</span>
            </div>
            <p className="text-[11px] text-slate-500 font-mono">B-tree Unique Constraints</p>
          </div>

          <div className="p-3 bg-slate-900/40 border border-slate-800/60 rounded-xl">
            <div className="flex items-center gap-2 text-purple-400 mb-1">
              <Server className="w-4 h-4" />
              <span className="text-xs font-mono font-semibold">SingleFlight LRU</span>
            </div>
            <p className="text-[11px] text-slate-500 font-mono">Stampede Cache-Aside</p>
          </div>

          <div className="p-3 bg-slate-900/40 border border-slate-800/60 rounded-xl">
            <div className="flex items-center gap-2 text-emerald-400 mb-1">
              <GitFork className="w-4 h-4" />
              <span className="text-xs font-mono font-semibold">RabbitMQ Queue</span>
            </div>
            <p className="text-[11px] text-slate-500 font-mono">Idempotent Event Ledger</p>
          </div>
        </div>

        {/* Main Interactive Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Create & Result */}
          <div className="lg:col-span-7 space-y-6">
            <CreateUrlForm onSuccess={handleCreated} />

            {latestResult && (
              <ResultCard
                result={latestResult}
                onInspectStats={(c) => setInspectCode(c)}
              />
            )}

            <LatencyProbe activeCode={latestResult?.code ?? inspectCode} />
          </div>

          {/* Right Column: Analytics & System Info */}
          <div className="lg:col-span-5 space-y-6">
            <StatsInspector initialCode={inspectCode} />

            {/* Architecture Card */}
            <div className="p-5 bg-slate-900/50 border border-slate-800/80 rounded-2xl text-xs font-mono text-slate-400 space-y-3">
              <div className="flex items-center justify-between text-slate-200 font-semibold">
                <span>SYSTEM LAB TOPOLOGY</span>
                <span className="text-[10px] text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/50">
                  DOCKER COMPOSE READY
                </span>
              </div>
              <ul className="space-y-1.5 text-slate-400 text-[11px]">
                <li className="flex items-center justify-between">
                  <span>• API Node:</span>
                  <span className="text-slate-300">Express 5 (:3001)</span>
                </li>
                <li className="flex items-center justify-between">
                  <span>• Database:</span>
                  <span className="text-slate-300">PostgreSQL 17 (:5432)</span>
                </li>
                <li className="flex items-center justify-between">
                  <span>• Shared Cache:</span>
                  <span className="text-slate-300">Redis 7 (:6379)</span>
                </li>
                <li className="flex items-center justify-between">
                  <span>• Message Broker:</span>
                  <span className="text-slate-300">RabbitMQ 4 (:5672)</span>
                </li>
                <li className="flex items-center justify-between">
                  <span>• Management UI:</span>
                  <span className="text-indigo-400">:15672</span>
                </li>
              </ul>
              <div className="pt-2 border-t border-slate-800">
                <a
                  href="/url_shortener_engineering_blueprint.md"
                  target="_blank"
                  className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 text-[11px]"
                >
                  <span>View Complete Engineering Blueprint</span>
                  <ArrowUpRight className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-600 font-mono">
        <p>Linklet Systems Laboratory — Built with Node.js 22 LTS, Express 5, and Next.js</p>
      </footer>
    </div>
  );
}


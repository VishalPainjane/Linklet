"use client";

import { useState, useEffect } from "react";
import { Header } from "../components/Header";
import { AuthModal } from "../components/AuthModal";
import { LandingPage } from "../components/LandingPage";
import { CreateUrlForm } from "../components/CreateUrlForm";
import { ResultCard } from "../components/ResultCard";
import { LinksTable } from "../components/LinksTable";
import { StatsInspector } from "../components/StatsInspector";
import { LatencyProbe } from "../components/LatencyProbe";
import {
  getCurrentUser,
  type AuthUser,
  type CreateUrlResponse,
} from "../lib/api";
import {
  Link2,
  BarChart3,
  Zap,
  CheckCircle,
} from "lucide-react";

export default function Home() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [activeTab, setActiveTab] = useState<"links" | "analytics" | "latency">("links");
  const [latestResult, setLatestResult] = useState<CreateUrlResponse | null>(null);
  const [inspectCode, setInspectCode] = useState<string>("");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [userStats, setUserStats] = useState({ total: 0, totalClicks: 0, activeCount: 0 });

  const handleOpenAuth = (mode: "signin" | "signup" = "signin") => {
    setAuthMode(mode);
    setAuthModalOpen(true);
  };

  useEffect(() => {
    const initAuth = async () => {
      const user = await getCurrentUser();
      setCurrentUser(user);
    };
    initAuth();
  }, []);

  const handleCreated = (result: CreateUrlResponse) => {
    setLatestResult(result);
    setInspectCode(result.code);
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleInspect = (code: string) => {
    setInspectCode(code);
    setActiveTab("analytics");
  };

  const handleScrollToFeatures = () => {
    const el = document.getElementById("features");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#090a0f] text-zinc-100 selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Top Navbar */}
      <Header
        currentUser={currentUser}
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
        onOpenAuth={handleOpenAuth}
        onLogout={() => {
          setCurrentUser(null);
          setLatestResult(null);
          setUserStats({ total: 0, totalClicks: 0, activeCount: 0 });
        }}
        onScrollToFeatures={handleScrollToFeatures}
      />

      {/* Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        initialMode={authMode}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={(user) => {
          setCurrentUser(user);
          setRefreshTrigger((prev) => prev + 1);
        }}
      />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* If user is not logged in: Show the clean, industrial Landing Page */}
        {!currentUser ? (
          <LandingPage onOpenAuth={handleOpenAuth} />
        ) : (
          /* If user is logged in: Show their personal workspace dashboard */
          <div className="space-y-6 sm:space-y-8 animate-fade-in">
            {/* User Greeting & Stats Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                  Welcome back,{" "}
                  <span className="text-indigo-400">
                    {currentUser.email?.split("@")[0]}
                  </span>
                </h1>
                <p className="text-xs text-zinc-400 font-mono">
                  {currentUser.email} · Personal Workspace
                </p>
              </div>
            </div>

            {/* Metrics Ribbon (Calculated for THIS USER) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-2xl">
                <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
                  <span>Total Links</span>
                  <Link2 className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-white">
                  {userStats.total.toLocaleString()}
                </div>
                <span className="text-[10px] text-zinc-500 font-mono">Created in workspace</span>
              </div>

              <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-2xl">
                <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
                  <span>Active Links</span>
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-emerald-400">
                  {userStats.activeCount.toLocaleString()}
                </div>
                <span className="text-[10px] text-emerald-500/80 font-mono">Ready for redirects</span>
              </div>

              <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-2xl">
                <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
                  <span>Total Clicks</span>
                  <BarChart3 className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-white">
                  {userStats.totalClicks.toLocaleString()}
                </div>
                <span className="text-[10px] text-purple-400 font-mono">Tracked events</span>
              </div>

              <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-2xl">
                <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
                  <span>Server Latency</span>
                  <Zap className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-white">
                  13.2 ms
                </div>
                <span className="text-[10px] text-amber-400 font-mono">Median p50</span>
              </div>
            </div>

            {/* TAB 1: Links (Core Management View) */}
            {activeTab === "links" && (
              <div className="space-y-6">
                <CreateUrlForm onSuccess={handleCreated} />

                {latestResult && (
                  <ResultCard
                    result={latestResult}
                    onInspectStats={(c) => handleInspect(c)}
                  />
                )}

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-white tracking-tight">
                      My Short Links
                    </h2>
                    <span className="text-xs text-zinc-500 font-mono">
                      {userStats.total} total
                    </span>
                  </div>

                  <LinksTable
                    onInspectCode={handleInspect}
                    refreshTrigger={refreshTrigger}
                    onStatsUpdated={(stats) => setUserStats(stats)}
                  />
                </div>
              </div>
            )}

            {/* TAB 2: Analytics */}
            {activeTab === "analytics" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7">
                  <StatsInspector
                    initialCode={inspectCode}
                    onRefreshList={() => setRefreshTrigger((prev) => prev + 1)}
                  />
                </div>

                <div className="lg:col-span-5 space-y-4">
                  <div className="p-5 bg-zinc-950 border border-zinc-800 rounded-2xl text-xs space-y-3">
                    <h3 className="font-semibold text-white">Analytics Pipeline</h3>
                    <p className="text-zinc-400 text-xs leading-relaxed">
                      Every redirect publishes an asynchronous event to RabbitMQ without querying or locking PostgreSQL. The consumer daemon batches and deduplicates clicks into <code className="text-purple-400">url_stats</code>.
                    </p>
                  </div>

                  <div className="p-5 bg-zinc-950 border border-zinc-800 rounded-2xl text-xs space-y-3">
                    <h3 className="font-semibold text-white">Transactional Outbox</h3>
                    <p className="text-zinc-400 text-xs leading-relaxed">
                      Disabled links commit an event to <code className="text-emerald-400">outbox_events</code> in the same database transaction, ensuring cache tombstones are consistently maintained in Redis.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: Latency Lab */}
            {activeTab === "latency" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7">
                  <LatencyProbe activeCode={inspectCode || latestResult?.code} />
                </div>

                <div className="lg:col-span-5">
                  <div className="p-5 bg-zinc-950 border border-zinc-800 rounded-2xl text-xs space-y-3">
                    <h3 className="font-semibold text-white">Benchmark Infrastructure</h3>
                    <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                      <div className="p-2.5 bg-zinc-900 rounded-xl">
                        <span className="text-zinc-500 block text-[10px]">Gateway Proxy</span>
                        <span className="text-white font-mono">Port 8000</span>
                      </div>
                      <div className="p-2.5 bg-zinc-900 rounded-xl">
                        <span className="text-zinc-500 block text-[10px]">FastAPI Cluster</span>
                        <span className="text-white font-mono">8001–8004</span>
                      </div>
                      <div className="p-2.5 bg-zinc-900 rounded-xl">
                        <span className="text-zinc-500 block text-[10px]">Database</span>
                        <span className="text-white font-mono">PostgreSQL 17</span>
                      </div>
                      <div className="p-2.5 bg-zinc-900 rounded-xl">
                        <span className="text-zinc-500 block text-[10px]">Cache</span>
                        <span className="text-white font-mono">Redis 7</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Clean Footer */}
      <footer className="border-t border-zinc-800/80 bg-zinc-950/60 py-6 text-xs text-zinc-500">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Linklet URL Shortener — Powered by FastAPI, PostgreSQL 17, Redis 7, & Next.js 15</span>
          <div className="flex items-center gap-4 text-zinc-400">
            <a href="http://localhost:8000/docs" target="_blank" rel="noreferrer" className="hover:text-white transition">
              API Docs
            </a>
            <a href="https://github.com/VishalPainjane/Linklet" target="_blank" rel="noreferrer" className="hover:text-white transition">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

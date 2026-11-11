"use client";

import { useState, useEffect } from "react";
import { getUrlStats, disableShortUrl, enableShortUrl, type UrlStatsResponse, type ApiError } from "../lib/api";
import { BarChart3, Search, RefreshCw, AlertTriangle, CheckCircle2, ShieldCheck, Zap } from "lucide-react";

interface Props {
  initialCode?: string;
  onRefreshList?: () => void;
}

export function StatsInspector({ initialCode = "", onRefreshList }: Props) {
  const [code, setCode] = useState(initialCode);
  const [stats, setStats] = useState<UrlStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabledSuccess, setDisabledSuccess] = useState(false);

  useEffect(() => {
    if (initialCode) {
      setCode(initialCode);
      fetchStats(initialCode);
    }
  }, [initialCode]);

  const fetchStats = async (lookupCode: string) => {
    if (!lookupCode.trim()) return;
    setLoading(true);
    setError(null);
    setDisabledSuccess(false);

    try {
      const data = await getUrlStats(lookupCode.trim());
      setStats(data);
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      if (apiErr.error === "not_found" || apiErr.error === "UrlNotFoundError") {
        setError(`No URL found matching short code '${lookupCode}'.`);
      } else {
        setError(apiErr.message || "Failed to retrieve analytics.");
      }
      setStats(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!stats) return;
    if (
      !confirm(
        `Disable short code '${stats.code}'? This records an atomic Outbox Event and writes a 1-hour Redis tombstone returning HTTP 410 Gone.`
      )
    ) {
      return;
    }

    try {
      await disableShortUrl(stats.code);
      setDisabledSuccess(true);
      await fetchStats(stats.code);
      if (onRefreshList) onRefreshList();
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      alert("Failed to disable link: " + (apiErr.message || "unknown error"));
    }
  };

  const handleEnable = async () => {
    if (!stats) return;
    try {
      await enableShortUrl(stats.code);
      setDisabledSuccess(false);
      await fetchStats(stats.code);
      if (onRefreshList) onRefreshList();
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      alert("Failed to enable link: " + (apiErr.message || "unknown error"));
    }
  };

  return (
    <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-2xl p-5 sm:p-6 shadow-xl backdrop-blur-md text-zinc-100">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <BarChart3 className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white tracking-tight">Real-Time Event Analytics</h2>
            <p className="text-[11px] text-zinc-400">Asynchronously drained via RabbitMQ 4 idempotent consumer</p>
          </div>
        </div>

        {stats && (
          <button
            onClick={() => fetchStats(stats.code)}
            title="Refresh statistics"
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          fetchStats(code);
        }}
        className="flex gap-2 mb-4"
      >
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Inspect code (e.g. docs or aB3de9kP)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full px-3.5 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono transition"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-medium rounded-xl flex items-center gap-1.5 transition disabled:opacity-40"
        >
          {loading ? (
            <span className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <Search className="w-3.5 h-3.5" />
              <span>Inspect</span>
            </>
          )}
        </button>
      </form>

      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-800/40 rounded-xl text-rose-300 text-xs flex items-center gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {disabledSuccess && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-800/40 rounded-xl text-emerald-300 text-xs flex items-center gap-2 mb-4">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Link disabled! Transactional Outbox committed; Redis tombstone set to 410 Gone.</span>
        </div>
      )}

      {stats ? (
        <div className="space-y-4 animate-fade-in">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 bg-zinc-900/90 border border-zinc-800 rounded-xl">
              <span className="text-[10px] uppercase font-mono text-zinc-400">Total Redirect Clicks</span>
              <div className="text-2xl font-bold font-mono text-white mt-1">
                {stats.clickCount.toLocaleString()}
              </div>
              <span className="text-[10px] text-emerald-400 font-mono">Deduplicated in Postgres</span>
            </div>

            <div className="p-3.5 bg-zinc-900/90 border border-zinc-800 rounded-xl">
              <span className="text-[10px] uppercase font-mono text-zinc-400">Last Click Received</span>
              <div className="text-xs font-mono text-zinc-200 mt-2 truncate">
                {stats.lastClickedAt
                  ? new Date(stats.lastClickedAt).toLocaleTimeString()
                  : "No clicks recorded"}
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">
                {stats.lastClickedAt
                  ? new Date(stats.lastClickedAt).toLocaleDateString()
                  : "Awaiting traffic"}
              </span>
            </div>
          </div>

          <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-zinc-300 font-mono">
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              <span>Event Delivery Guarantees</span>
            </div>
            <span className="text-[10px] text-zinc-400 font-mono">At-Least-Once Ledger</span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleDisable}
              className="flex-1 py-2 bg-rose-950/40 hover:bg-rose-950/70 border border-rose-800/40 hover:border-rose-700/60 text-rose-300 hover:text-rose-200 text-xs font-medium rounded-xl transition flex items-center justify-center gap-1.5"
            >
              <span>Disable (Tombstone)</span>
            </button>
            <button
              onClick={handleEnable}
              className="flex-1 py-2 bg-emerald-950/40 hover:bg-emerald-950/70 border border-emerald-800/40 hover:border-emerald-700/60 text-emerald-300 hover:text-emerald-200 text-xs font-medium rounded-xl transition flex items-center justify-center gap-1.5"
            >
              <span>Re-enable Link</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="p-8 text-center text-zinc-500 font-mono text-xs border border-dashed border-zinc-800/80 rounded-xl">
          Enter any short link code above to inspect real-time click volume and invalidation state.
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { getUrlStats, disableShortUrl, type UrlStatsResponse, type ApiError } from "../lib/api";
import { BarChart3, Search, RefreshCw, AlertTriangle, Eye, Ban, CheckCircle2 } from "lucide-react";

interface Props {
  initialCode?: string;
}

export function StatsInspector({ initialCode = "" }: Props) {
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
    } catch (err: any) {
      const apiErr = err as ApiError;
      if (apiErr.error === "not_found") {
        setError(`No URL found with code '${lookupCode}'.`);
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
    if (!confirm(`Are you sure you want to disable short code '${stats.code}'? Once disabled, it returns HTTP 410 Gone.`)) {
      return;
    }

    try {
      await disableShortUrl(stats.code);
      setDisabledSuccess(true);
      await fetchStats(stats.code);
    } catch (err: any) {
      alert("Failed to disable link: " + (err.message || "unknown error"));
    }
  };

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-400" />
          <h2 className="text-lg font-semibold text-white">Analytics & Lifecycle</h2>
        </div>

        {stats && (
          <button
            onClick={() => fetchStats(code)}
            disabled={loading}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
            title="Refresh stats"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Enter short code (e.g. aB3dE9kP)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchStats(code)}
            className="w-full pl-3.5 pr-4 py-2 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono transition"
          />
        </div>
        <button
          onClick={() => fetchStats(code)}
          disabled={loading || !code.trim()}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-medium text-sm rounded-xl transition flex items-center gap-1.5"
        >
          <Search className="w-4 h-4" />
          <span>Lookup</span>
        </button>
      </div>

      {error && (
        <div className="p-3 mb-4 rounded-xl bg-rose-950/40 border border-rose-900/50 text-rose-300 text-xs font-mono">
          {error}
        </div>
      )}

      {disabledSuccess && (
        <div className="p-3 mb-4 rounded-xl bg-emerald-950/40 border border-emerald-900/50 text-emerald-300 text-xs font-mono flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Short link disabled successfully. Cache invalidated.</span>
        </div>
      )}

      {stats ? (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 bg-slate-950/80 border border-slate-800/80 rounded-xl">
              <span className="text-xs font-mono text-slate-500 uppercase tracking-wider block mb-1">
                Total Clicks
              </span>
              <span className="text-2xl font-bold font-mono text-indigo-400">
                {stats.clickCount.toLocaleString()}
              </span>
            </div>

            <div className="p-4 bg-slate-950/80 border border-slate-800/80 rounded-xl">
              <span className="text-xs font-mono text-slate-500 uppercase tracking-wider block mb-1">
                Last Clicked
              </span>
              <span className="text-xs font-mono text-slate-300 block truncate mt-1">
                {stats.lastClickedAt
                  ? new Date(stats.lastClickedAt).toLocaleTimeString() +
                    " " +
                    new Date(stats.lastClickedAt).toLocaleDateString()
                  : "Never"}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <span className="text-xs font-mono text-slate-500">
              Updated: {new Date(stats.updatedAt).toLocaleTimeString()}
            </span>

            <button
              onClick={handleDisable}
              className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/50 text-rose-300 rounded-lg text-xs font-mono flex items-center gap-1.5 transition"
            >
              <Ban className="w-3.5 h-3.5" />
              <span>Disable Link</span>
            </button>
          </div>
        </div>
      ) : (
        !error && (
          <p className="text-xs font-mono text-slate-600 text-center py-4">
            Enter a code to inspect real-time click aggregation and lifecycle status.
          </p>
        )
      )}
    </div>
  );
}


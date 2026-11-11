"use client";

import { useState } from "react";
import { createShortUrl, type CreateUrlResponse, type ApiError } from "../lib/api";
import {
  Link2,
  Sparkles,
  Clock,
  ArrowRight,
  Loader2,
  ChevronDown,
  Globe,
  SlidersHorizontal,
} from "lucide-react";

interface Props {
  onSuccess: (result: CreateUrlResponse) => void;
}

export function CreateUrlForm({ onSuccess }: Props) {
  const [url, setUrl] = useState("");
  const [customAlias, setCustomAlias] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);

    try {
      let targetUrl = url.trim();
      if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
        targetUrl = "https://" + targetUrl;
      }

      const res = await createShortUrl({
        url: targetUrl,
        customAlias: customAlias.trim() || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });

      onSuccess(res);
      setUrl("");
      setCustomAlias("");
      setExpiresAt("");
      setShowOptions(false);
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      if (apiErr.error === "conflict" || apiErr.error === "AliasAlreadyTakenError") {
        setError("This custom alias is already claimed. Please try another.");
      } else if (apiErr.error === "rate_limit_exceeded" || apiErr.error === "RateLimitExceededError") {
        setError("Rate limit reached. Please wait a moment before shortening more URLs.");
      } else {
        setError(apiErr.message || "Failed to create short link.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-2xl p-5 sm:p-6 shadow-xl backdrop-blur-md text-zinc-100">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white tracking-tight">Create Short Link</h2>
            <p className="text-[11px] text-zinc-400">Zero-modulo-bias Base62 with SingleFlight stampede collapse</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowOptions(!showOptions)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
            showOptions
              ? "bg-zinc-800 border-zinc-700 text-white"
              : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <SlidersHorizontal className="w-3 h-3" />
          <span>Options</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${showOptions ? "rotate-180" : ""}`} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <div className="relative">
            <Globe className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
            <input
              type="text"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste any long URL (e.g. https://github.com/astral-sh/uv)..."
              className="w-full pl-10 pr-28 py-3 bg-zinc-900/90 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition font-mono text-xs sm:text-sm"
            />
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="absolute right-2 top-2 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-40 shadow-sm"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  <span>Shorten</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>

        {showOptions && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-800/80 animate-fade-in">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Custom Alias (Optional)
              </label>
              <div className="flex items-center rounded-xl bg-zinc-900/90 border border-zinc-800 px-3 py-2 text-xs font-mono">
                <span className="text-zinc-500">linklet.sh/</span>
                <input
                  type="text"
                  value={customAlias}
                  onChange={(e) => setCustomAlias(e.target.value)}
                  placeholder="launch-2026"
                  className="bg-transparent flex-1 text-zinc-100 focus:outline-none ml-1 placeholder-zinc-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1 flex items-center gap-1">
                <Clock className="w-3 h-3 text-zinc-400" />
                <span>Expiration Date (Optional)</span>
              </label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-900/90 border border-zinc-800 rounded-xl text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 [color-scheme:dark]"
              />
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs">
            {error}
          </div>
        )}
      </form>
    </div>
  );
}

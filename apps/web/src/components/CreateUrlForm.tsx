"use client";

import { useState } from "react";
import { createShortUrl, type CreateUrlResponse, type ApiError } from "../lib/api";
import { Link2, Sparkles, Clock, AlertCircle, ArrowRight, Loader2 } from "lucide-react";

interface Props {
  onSuccess: (result: CreateUrlResponse) => void;
}

export function CreateUrlForm({ onSuccess }: Props) {
  const [url, setUrl] = useState("");
  const [customAlias, setCustomAlias] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await createShortUrl({
        url: url.trim(),
        customAlias: customAlias.trim() || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });

      onSuccess(res);
      setUrl("");
      setCustomAlias("");
      setExpiresAt("");
    } catch (err: any) {
      const apiErr = err as ApiError;
      if (apiErr.error === "conflict") {
        setError("This custom alias is already claimed. Please choose a different alias.");
      } else if (apiErr.error === "validation_error") {
        setError(apiErr.message || "Invalid URL or alias parameters.");
      } else if (apiErr.error === "rate_limit_exceeded") {
        setError("Rate limit exceeded. Please wait a minute before creating more links.");
      } else {
        setError(apiErr.message || "Failed to create short URL. Ensure backend is running.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-indigo-400" />
        <h2 className="text-lg font-semibold text-white">Create Short Link</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-mono text-slate-400 mb-1">
            DESTINATION URL <span className="text-rose-400">*</span>
          </label>
          <div className="relative">
            <Link2 className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-500" />
            <input
              type="url"
              required
              placeholder="https://example.com/very/long/article/path?query=param"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono transition"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">
              CUSTOM ALIAS (OPTIONAL)
            </label>
            <div className="flex items-center">
              <span className="px-3 py-2.5 bg-slate-950/60 border border-r-0 border-slate-800 rounded-l-xl text-xs font-mono text-slate-500">
                /
              </span>
              <input
                type="text"
                placeholder="my-alias"
                pattern="^[A-Za-z0-9_-]{3,32}$"
                title="3-32 characters (letters, numbers, hyphens, underscores)"
                value={customAlias}
                onChange={(e) => setCustomAlias(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-950/80 border border-slate-800 rounded-r-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">
              EXPIRES AT (OPTIONAL)
            </label>
            <div className="relative">
              <Clock className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-500" />
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono transition"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-950/40 border border-rose-900/50 text-rose-300 text-xs font-mono">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm rounded-xl shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 transition"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Generating Short Code...</span>
            </>
          ) : (
            <>
              <span>Shorten URL</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}


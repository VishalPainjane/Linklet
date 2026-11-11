"use client";

import { useState } from "react";
import { createShortUrl, type CreateUrlResponse } from "../lib/api";
import {
  Link2,
  ArrowRight,
  Zap,
  BarChart3,
  ShieldCheck,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Globe,
} from "lucide-react";

interface LandingPageProps {
  onOpenAuth: (mode?: "signin" | "signup") => void;
}

export function LandingPage({ onOpenAuth }: LandingPageProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [guestResult, setGuestResult] = useState<CreateUrlResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGuestShorten = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);
    try {
      let targetUrl = url.trim();
      if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
        targetUrl = "https://" + targetUrl;
      }
      const res = await createShortUrl({ url: targetUrl });
      setGuestResult(res);
      setUrl("");
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setError(apiErr.message || "Failed to shorten URL. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!guestResult) return;
    navigator.clipboard.writeText(guestResult.shortUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-16 py-8">
      {/* Hero Section */}
      <section className="text-center max-w-3xl mx-auto space-y-6">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
          Short links,{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
            built for scale.
          </span>
        </h1>
        <p className="text-base text-zinc-400 max-w-2xl mx-auto leading-relaxed">
          High-performance link shortening with custom aliases, real-time event analytics,
          and sub-15ms redirect latency powered by PostgreSQL 17, Redis 7, and RabbitMQ.
        </p>

        {/* Guest Shortening Box */}
        <div className="max-w-xl mx-auto pt-2">
          <form
            onSubmit={handleGuestShorten}
            className="p-2 rounded-2xl bg-zinc-950 border border-zinc-800 shadow-2xl flex flex-col sm:flex-row gap-2"
          >
            <div className="relative flex-1">
              <Globe className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
              <input
                type="text"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste any long URL to test..."
                className="w-full pl-10 pr-3 py-2.5 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition disabled:opacity-40 shrink-0"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  <span>Shorten URL</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>

          {error && (
            <div className="mt-3 p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/40 text-rose-300 text-xs">
              {error}
            </div>
          )}

          {/* Guest Result Card */}
          {guestResult && (
            <div className="mt-4 p-4 rounded-2xl bg-zinc-900 border border-zinc-800 text-left space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-emerald-400 uppercase">
                  Link Created Successfully
                </span>
                <span className="text-[11px] font-mono text-zinc-500">
                  Code: {guestResult.code}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-zinc-950 border border-zinc-800 font-mono text-sm">
                <span className="text-indigo-300 truncate">{guestResult.shortUrl}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={handleCopy}
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs flex items-center gap-1 transition"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                  <a
                    href={guestResult.shortUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-900/40 flex items-center justify-between text-xs text-zinc-300">
                <span>Want custom aliases and live click analytics?</span>
                <button
                  onClick={() => onOpenAuth("signin")}
                  className="text-indigo-400 hover:text-indigo-300 font-medium transition"
                >
                  Sign in to claim →
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Feature Showcase Grid */}
      <section id="features" className="max-w-5xl mx-auto pt-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-2xl bg-zinc-950 border border-zinc-800/80 space-y-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Zap className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-white">Sub-15ms Redirects</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Memory-first Redis 7 cache-aside architecture with connection pooling and SingleFlight stampede collapse ensures instant redirects.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-zinc-950 border border-zinc-800/80 space-y-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <BarChart3 className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-white">Real-Time Event Ledger</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Redirects offload click tracking to RabbitMQ 4 queues in microseconds. Background workers aggregate metrics without database lock contention.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-zinc-950 border border-zinc-800/80 space-y-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-white">Crash-Proof Consistency</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Transactional Outbox pattern commits link deletions and outbox records in a single ACID transaction, keeping Redis tombstones 100% consistent.
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="text-center py-10 px-6 rounded-3xl bg-zinc-950 border border-zinc-800/80 max-w-3xl mx-auto space-y-4">
        <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
          Ready to manage your links?
        </h2>
        <p className="text-xs text-zinc-400 max-w-md mx-auto">
          Sign in to access your personal dashboard, track click metrics, and create custom branded links.
        </p>
        <button
          onClick={() => onOpenAuth("signup")}
          className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition"
        >
          Create Free Account
        </button>
      </section>
    </div>
  );
}


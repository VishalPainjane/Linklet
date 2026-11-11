"use client";

import { useState } from "react";
import type { CreateUrlResponse } from "../lib/api";
import { Check, Copy, ExternalLink, QrCode, BarChart2 } from "lucide-react";

interface Props {
  result: CreateUrlResponse;
  onInspectStats: (code: string) => void;
}

export function ResultCard({ result, onInspectStats }: Props) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.shortUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="bg-gradient-to-b from-indigo-950/20 to-zinc-950/90 border border-indigo-900/40 rounded-2xl p-5 shadow-xl backdrop-blur-md animate-fade-in text-zinc-100">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Active in Redis Cache</span>
        </span>
        <span className="text-xs font-mono text-zinc-400">
          Code: <span className="text-zinc-200 font-semibold">{result.code}</span>
        </span>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-zinc-900/90 border border-zinc-800 rounded-xl mb-3">
        <div className="truncate font-mono text-sm text-indigo-300 select-all">
          {result.shortUrl}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition"
            title="Copy to clipboard"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-medium">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>

          <a
            href={result.shortUrl}
            target="_blank"
            rel="noreferrer"
            className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg transition"
            title="Open redirect in new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <button
            onClick={() => setShowQr(!showQr)}
            className={`p-2 rounded-lg transition ${
              showQr ? "bg-indigo-600 text-white" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            }`}
            title="Toggle QR Code"
          >
            <QrCode className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-400 font-mono">
        <span className="truncate max-w-[280px] sm:max-w-md">
          Target: {result.destinationUrl}
        </span>
        <button
          onClick={() => onInspectStats(result.code)}
          className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-sans transition shrink-0"
        >
          <BarChart2 className="w-3 h-3" />
          <span>Inspect Stats</span>
        </button>
      </div>

      {showQr && (
        <div className="mt-4 pt-4 border-t border-zinc-800/80 flex flex-col items-center justify-center animate-fade-in">
          <div className="p-3 bg-white rounded-xl shadow-lg mb-2">
            {/* Quick QR code via standard image service */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(
                result.shortUrl
              )}`}
              alt={`QR Code for ${result.shortUrl}`}
              className="w-32 h-32"
            />
          </div>
          <span className="text-[11px] text-zinc-400 font-mono">
            Scan to test live 302 redirect on mobile
          </span>
        </div>
      )}
    </div>
  );
}

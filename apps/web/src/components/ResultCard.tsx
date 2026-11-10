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
      // Fallback copy
    }
  };

  return (
    <div className="bg-gradient-to-b from-indigo-950/30 to-slate-900/60 border border-indigo-900/40 rounded-2xl p-6 shadow-xl backdrop-blur-sm animate-in fade-in slide-in-from-top-4 duration-300">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2.5 py-0.5 rounded-full">
          Short Link Active
        </span>
        <span className="text-xs font-mono text-slate-500">
          Code: <span className="text-slate-300 font-semibold">{result.code}</span>
        </span>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-slate-950/90 border border-slate-800 rounded-xl mb-4">
        <div className="truncate font-mono text-sm sm:text-base text-indigo-300 select-all">
          {result.shortUrl}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleCopy}
            className="flex-1 sm:flex-none px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition"
            title="Copy to clipboard"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
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
            rel="noopener noreferrer"
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition"
          >
            <span>Visit</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <button
            onClick={() => setShowQr(!showQr)}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
            title="Toggle QR Code"
          >
            <QrCode className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-400 gap-2 border-t border-slate-800/60 pt-3">
        <div className="truncate max-w-md font-mono text-slate-500">
          Target: <span className="text-slate-400">{result.destinationUrl}</span>
        </div>

        <button
          onClick={() => onInspectStats(result.code)}
          className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition text-xs font-mono self-start sm:self-auto"
        >
          <BarChart2 className="w-3.5 h-3.5" />
          <span>Inspect Analytics</span>
        </button>
      </div>

      {showQr && (
        <div className="mt-4 pt-4 border-t border-slate-800 flex flex-col items-center justify-center bg-white p-4 rounded-xl text-black">
          {/* Simple crisp QR Code API rendering */}
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
              result.shortUrl,
            )}`}
            alt="QR Code"
            className="w-40 h-40"
          />
          <span className="text-[11px] font-mono text-slate-600 mt-2">
            Scan to test 302 redirect
          </span>
        </div>
      )}
    </div>
  );
}


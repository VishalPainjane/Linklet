"use client";

import { useEffect, useState } from "react";
import { checkApiHealth, API_BASE_URL } from "../lib/api";
import { Activity, ShieldCheck, Terminal, ExternalLink } from "lucide-react";

export function Header() {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const ok = await checkApiHealth();
      if (mounted) setIsOnline(ok);
    };

    check();
    const interval = setInterval(check, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <header className="border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Terminal className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg text-white tracking-tight">Linklet</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-950/80 text-indigo-400 border border-indigo-800/50 font-mono">
                v1.0
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Systems-Engineered URL Shortener</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono">
            <span
              className={`w-2 h-2 rounded-full ${
                isOnline === true
                  ? "bg-emerald-400 animate-pulse"
                  : isOnline === false
                  ? "bg-rose-500"
                  : "bg-amber-400"
              }`}
            />
            <span className="text-slate-300">
              {isOnline === true
                ? "Backend Ready"
                : isOnline === false
                ? "Backend Disconnected"
                : "Probing API..."}
            </span>
          </div>

          <a
            href="https://github.com/nikhilds/Linklet"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-400 hover:text-white transition flex items-center gap-1 hover:underline"
          >
            GitHub
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </header>
  );
}


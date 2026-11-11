"use client";

import { useState } from "react";
import { logoutUser, type AuthUser } from "../lib/api";
import {
  Link2,
  Activity,
  Layers,
  BarChart3,
  LogOut,
  User,
  ChevronDown,
  Github,
} from "lucide-react";

interface HeaderProps {
  currentUser: AuthUser | null;
  activeTab: "links" | "analytics" | "latency";
  onTabChange: (tab: "links" | "analytics" | "latency") => void;
  onOpenAuth: (mode?: "signin" | "signup") => void;
  onLogout: () => void;
  onScrollToFeatures?: () => void;
}

export function Header({
  currentUser,
  activeTab,
  onTabChange,
  onOpenAuth,
  onLogout,
  onScrollToFeatures,
}: HeaderProps) {
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  const handleLogout = async () => {
    await logoutUser();
    setUserDropdownOpen(false);
    onLogout();
  };

  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => onTabChange("links")}>
            <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-600/20">
              <Link2 className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-base tracking-tight text-white">Linklet</span>
          </div>

          {/* Navigation for Logged-In Users */}
          {currentUser && (
            <nav className="hidden sm:flex items-center gap-1 p-1 bg-zinc-900/60 border border-zinc-800 rounded-xl">
              <button
                onClick={() => onTabChange("links")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  activeTab === "links"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Links</span>
              </button>

              <button
                onClick={() => onTabChange("analytics")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  activeTab === "analytics"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Analytics</span>
              </button>

              <button
                onClick={() => onTabChange("latency")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  activeTab === "latency"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Latency Lab</span>
              </button>
            </nav>
          )}

          {/* Navigation for Guests (Marketing) */}
          {!currentUser && (
            <nav className="hidden md:flex items-center gap-6 text-xs text-zinc-400">
              <button
                onClick={onScrollToFeatures}
                className="hover:text-zinc-200 transition"
              >
                Features
              </button>
              <a
                href="http://localhost:8000/docs"
                target="_blank"
                rel="noreferrer"
                className="hover:text-zinc-200 transition"
              >
                API Docs
              </a>
              <a
                href="https://github.com/VishalPainjane/Linklet"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 hover:text-zinc-200 transition"
              >
                <Github className="w-3.5 h-3.5" />
                <span>GitHub</span>
              </a>
            </nav>
          )}
        </div>

        {/* Right Section: Auth State */}
        <div className="flex items-center gap-3">
          {currentUser ? (
            <div className="relative">
              <button
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition text-xs text-zinc-200"
              >
                <div className="w-5 h-5 rounded-full bg-indigo-600/30 text-indigo-400 border border-indigo-500/40 flex items-center justify-center font-bold text-[10px]">
                  {currentUser.email ? currentUser.email.charAt(0).toUpperCase() : "U"}
                </div>
                <span className="max-w-[140px] truncate font-medium">
                  {currentUser.email}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
              </button>

              {userDropdownOpen && (
                <div className="absolute right-0 mt-2 w-52 rounded-xl bg-zinc-900 border border-zinc-800 shadow-xl p-1.5 text-xs text-zinc-200 animate-fade-in z-50">
                  <div className="px-3 py-2 border-b border-zinc-800/80 mb-1">
                    <p className="text-[10px] uppercase font-mono text-zinc-500">Signed in as</p>
                    <p className="font-semibold text-white truncate">{currentUser.email}</p>
                  </div>

                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-rose-400 hover:bg-rose-950/40 transition text-left"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onOpenAuth("signin")}
                className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition"
              >
                Sign In
              </button>
              <button
                onClick={() => onOpenAuth("signup")}
                className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition shadow-sm"
              >
                Sign Up
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

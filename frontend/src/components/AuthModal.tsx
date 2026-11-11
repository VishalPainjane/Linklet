"use client";

import { useEffect, useRef, useState } from "react";
import {
  loginWithEmail,
  registerWithEmail,
  loginWithGoogle,
  type AuthUser,
} from "../lib/api";
import { X, ArrowRight, Mail, Lock, Eye, EyeOff, UserPlus, LogIn } from "lucide-react";

interface GoogleCredentialResponse {
  credential?: string;
  select_by?: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (res: GoogleCredentialResponse) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              shape?: "rectangular" | "pill" | "circle" | "square";
              width?: string | number;
              logo_alignment?: "left" | "center";
            }
          ) => void;
          prompt?: () => void;
        };
      };
    };
  }
}

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: "signin" | "signup";
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
}

export function AuthModal({
  isOpen,
  initialMode = "signin",
  onClose,
  onSuccess,
}: AuthModalProps) {
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleLoaded, setGoogleLoaded] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  const clientId =
    process.env["NEXT_PUBLIC_GOOGLE_CLIENT_ID"] ||
    "232921905265-abpm3g9j2r3nqeehg211dvpus4pn0n8k.apps.googleusercontent.com";

  // Synchronize initial mode when modal opens
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError(null);
      setPassword("");
    }
  }, [isOpen, initialMode]);

  // Setup Google Identity Services Button
  useEffect(() => {
    if (!isOpen) return;

    let timer: NodeJS.Timeout | null = null;

    const setupGoogleButton = () => {
      if (typeof window !== "undefined" && window.google?.accounts?.id && googleBtnRef.current) {
        try {
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: async (res: GoogleCredentialResponse) => {
              if (res.credential) {
                setLoading(true);
                setError(null);
                try {
                  const authRes = await loginWithGoogle(res.credential);
                  onSuccess(authRes.user);
                  onClose();
                } catch (err: unknown) {
                  const apiErr = err as { message?: string; detail?: string };
                  setError(
                    apiErr.detail ||
                      apiErr.message ||
                      "Google authentication failed. Please try again."
                  );
                } finally {
                  setLoading(false);
                }
              }
            },
          });

          googleBtnRef.current.innerHTML = "";
          window.google.accounts.id.renderButton(googleBtnRef.current, {
            theme: "filled_black",
            size: "large",
            text: mode === "signin" ? "signin_with" : "signup_with",
            shape: "rectangular",
            width: 336,
            logo_alignment: "left",
          });
          setGoogleLoaded(true);
        } catch (e) {
          console.error("Google Auth initialization error:", e);
        }
      }
    };

    if (window.google?.accounts?.id) {
      setupGoogleButton();
    } else {
      timer = setInterval(() => {
        if (window.google?.accounts?.id) {
          setupGoogleButton();
          if (timer) clearInterval(timer);
        }
      }, 150);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isOpen, mode, clientId, onClose, onSuccess]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!password || password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res =
        mode === "signin"
          ? await loginWithEmail(trimmedEmail, password)
          : await registerWithEmail(trimmedEmail, password);
      onSuccess(res.user);
      onClose();
    } catch (err: unknown) {
      const apiErr = err as { message?: string; detail?: string };
      setError(
        apiErr.detail ||
          apiErr.message ||
          `Failed to ${mode === "signin" ? "sign in" : "create account"}. Please check your credentials.`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-sm rounded-2xl bg-zinc-950 border border-zinc-800 p-6 shadow-2xl text-zinc-100">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg text-zinc-500 hover:text-white transition"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Tab Switcher: Sign In vs Sign Up */}
        <div className="grid grid-cols-2 p-1 bg-zinc-900/90 border border-zinc-800 rounded-xl mb-5">
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setError(null);
            }}
            className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-lg transition ${
              mode === "signin"
                ? "bg-zinc-800 text-white shadow-sm border border-zinc-700/60"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setError(null);
            }}
            className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-lg transition ${
              mode === "signup"
                ? "bg-zinc-800 text-white shadow-sm border border-zinc-700/60"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Sign Up</span>
          </button>
        </div>

        {/* Header Title & Description */}
        <h2 className="text-lg font-bold tracking-tight text-white mb-1">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h2>
        <p className="text-xs text-zinc-400 mb-5">
          {mode === "signin"
            ? "Sign in to access your links, redirects, and click ledger."
            : "Get started with your isolated link workspace in seconds."}
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-950/50 border border-rose-800/50 text-rose-300 text-xs">
            {error}
          </div>
        )}

        {/* Google 1-Click Sign-In / Sign-Up */}
        <div className="mb-4">
          <div
            ref={googleBtnRef}
            className="flex justify-center min-h-[40px] items-center"
          />
          {!googleLoaded && (
            <div className="w-full py-2.5 px-4 rounded-xl border border-zinc-800 bg-zinc-900 flex items-center justify-center gap-2 text-xs text-zinc-400">
              <span className="w-3.5 h-3.5 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />
              <span>
                Loading Google {mode === "signin" ? "Sign-In" : "Sign-Up"}...
              </span>
            </div>
          )}
        </div>

        <div className="relative my-4 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-800" />
          </div>
          <span className="relative bg-zinc-950 px-2 text-[10px] uppercase font-semibold text-zinc-500 tracking-wider">
            or continue with email & password
          </span>
        </div>

        {/* Email & Password Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              {mode === "signin" ? "Password" : "Create Password"}
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signin" ? "••••••••" : "At least 6 characters"}
                className="w-full pl-9 pr-10 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-300 transition"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition disabled:opacity-40 shadow-sm"
          >
            {loading ? (
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>
                  {mode === "signin" ? "Sign In" : "Create Account"}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </form>

        {/* Mode Switcher Footer */}
        <div className="mt-5 pt-4 border-t border-zinc-800/80 text-center text-xs text-zinc-400">
          {mode === "signin" ? (
            <span>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
                className="text-indigo-400 hover:text-indigo-300 font-medium transition"
              >
                Sign up free
              </button>
            </span>
          ) : (
            <span>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
                className="text-indigo-400 hover:text-indigo-300 font-medium transition"
              >
                Sign in
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

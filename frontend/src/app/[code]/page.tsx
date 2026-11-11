"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { API_BASE_URL } from "../../lib/api";
import { Link2, AlertCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function RedirectPage() {
  const params = useParams();
  const router = useRouter();
  const code = (params?.["code"] as string) || "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;

    if (["favicon.ico", "robots.txt", "sitemap.xml"].includes(code)) {
      setError("File not found");
      setLoading(false);
      return;
    }

    let isMounted = true;

    async function resolveAndRedirect() {
      try {
        const res = await fetch(`${API_BASE_URL}/${encodeURIComponent(code)}`, {
          method: "HEAD",
          redirect: "manual",
          cache: "no-store",
        });

        const locationHeader = res.headers.get("Location");
        if (locationHeader) {
          window.location.replace(locationHeader);
          return;
        }

        if (res.status === 404 || res.status === 410) {
          if (isMounted) {
            setError(
              res.status === 410
                ? "This short link has expired or has been disabled."
                : `Short link "/${code}" does not exist.`
            );
            setLoading(false);
          }
          return;
        }

        window.location.replace(`${API_BASE_URL}/${encodeURIComponent(code)}`);
      } catch {
        window.location.replace(`${API_BASE_URL}/${encodeURIComponent(code)}`);
      }
    }

    resolveAndRedirect();

    return () => {
      isMounted = false;
    };
  }, [code, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4 text-zinc-100">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shadow-lg shadow-indigo-600/20">
            <Link2 className="w-6 h-6 text-indigo-400 animate-pulse" />
          </div>
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          <p className="text-sm text-zinc-400 font-mono tracking-tight animate-pulse">
            Redirecting to destination...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 text-zinc-100">
      <div className="max-w-md w-full rounded-2xl bg-zinc-950 border border-zinc-800 p-8 text-center space-y-6 shadow-2xl">
        <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
          <AlertCircle className="w-7 h-7" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-white tracking-tight">Link Not Found</h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            {error || `The short link "/${code}" does not exist or has expired.`}
          </p>
        </div>

        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-lg shadow-indigo-600/20"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Go to Linklet</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

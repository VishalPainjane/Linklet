"use client";

import { useEffect, useState, useMemo } from "react";
import {
  listUrls,
  disableShortUrl,
  enableShortUrl,
  type UrlListItem,
} from "../lib/api";
import {
  ExternalLink,
  Copy,
  Check,
  Trash2,
  BarChart3,
  Search,
  RefreshCw,
  Globe,
  Link2,
  RotateCcw,
} from "lucide-react";

interface LinksTableProps {
  onInspectCode: (code: string) => void;
  refreshTrigger: number;
  onStatsUpdated?: (stats: { total: number; totalClicks: number; activeCount: number }) => void;
}

export function LinksTable({ onInspectCode, refreshTrigger, onStatsUpdated }: LinksTableProps) {
  const [links, setLinks] = useState<UrlListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [enablingCode, setEnablingCode] = useState<string | null>(null);

  const fetchLinks = async () => {
    setLoading(true);
    try {
      const res = await listUrls({
        limit: 100,
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setLinks(res.items);
      if (onStatsUpdated) {
        onStatsUpdated({
          total: res.total,
          totalClicks: res.totalClicks ?? 0,
          activeCount: res.activeCount ?? 0,
        });
      }
    } catch (err) {
      console.error("Failed to load user links:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLinks();
  }, [statusFilter, refreshTrigger]);

  const filteredLinks = useMemo(() => {
    if (!search.trim()) return links;
    const q = search.toLowerCase();
    return links.filter(
      (l) =>
        l.code.toLowerCase().includes(q) ||
        l.destinationUrl.toLowerCase().includes(q) ||
        l.shortUrl.toLowerCase().includes(q)
    );
  }, [links, search]);

  const handleCopy = (shortUrl: string, code: string) => {
    navigator.clipboard.writeText(shortUrl);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleDelete = async (code: string) => {
    if (!confirm(`Are you sure you want to disable link /${code}?`)) {
      return;
    }
    setDeletingCode(code);
    try {
      await disableShortUrl(code);
      await fetchLinks();
    } catch (err) {
      alert("Failed to disable link: " + String(err));
    } finally {
      setDeletingCode(null);
    }
  };

  const handleEnable = async (code: string) => {
    setEnablingCode(code);
    try {
      await enableShortUrl(code);
      await fetchLinks();
    } catch (err) {
      alert("Failed to enable link: " + String(err));
    } finally {
      setEnablingCode(null);
    }
  };

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl shadow-xl overflow-hidden text-zinc-100">
      {/* Search and Filters */}
      <div className="p-4 border-b border-zinc-800 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search links..."
            className="w-full pl-9 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
          />
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <div className="flex items-center p-1 bg-zinc-900 rounded-xl border border-zinc-800 text-xs font-medium">
            <button
              onClick={() => setStatusFilter("all")}
              className={`px-3 py-1 rounded-lg transition ${
                statusFilter === "all" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setStatusFilter("active")}
              className={`px-3 py-1 rounded-lg transition ${
                statusFilter === "active" ? "bg-zinc-800 text-emerald-400" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setStatusFilter("tombstone")}
              className={`px-3 py-1 rounded-lg transition ${
                statusFilter === "tombstone" ? "bg-zinc-800 text-amber-400" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Disabled
            </button>
          </div>

          <button
            onClick={fetchLinks}
            title="Refresh links"
            className="p-1.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/30 text-[11px] font-mono text-zinc-400 uppercase tracking-wider">
              <th className="py-3 px-4">Short Link</th>
              <th className="py-3 px-4">Destination</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Clicks</th>
              <th className="py-3 px-4">Created</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {loading && links.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-zinc-500">
                  <div className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                    <span>Loading links...</span>
                  </div>
                </td>
              </tr>
            ) : filteredLinks.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-zinc-500">
                  <div className="max-w-xs mx-auto space-y-2">
                    <Link2 className="w-6 h-6 mx-auto text-zinc-600" />
                    <p className="text-xs font-medium text-zinc-300">No links found</p>
                    <p className="text-[11px] text-zinc-500">
                      {search ? "No links match your search query." : "Paste a destination URL above to create your first short link."}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredLinks.map((link) => {
                const isTombstone = !link.isActive || link.disabledAt !== null;
                const formattedDate = new Date(link.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                });

                return (
                  <tr key={link.code} className="hover:bg-zinc-900/40 transition-colors group">
                    {/* Short Link */}
                    <td className="py-3 px-4 font-mono">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white tracking-tight">
                          /{link.code}
                        </span>
                        <button
                          onClick={() => handleCopy(link.shortUrl, link.code)}
                          title="Copy short URL"
                          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
                        >
                          {copiedCode === link.code ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>

                    {/* Destination */}
                    <td className="py-3 px-4 max-w-xs truncate">
                      <a
                        href={link.destinationUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-zinc-300 hover:text-indigo-400 flex items-center gap-1.5 transition truncate"
                      >
                        <Globe className="w-3 h-3 text-zinc-500 shrink-0" />
                        <span className="truncate">{link.destinationUrl}</span>
                        <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </a>
                    </td>

                    {/* Status Badge */}
                    <td className="py-3 px-4">
                      {isTombstone ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-950/40 text-amber-400 border border-amber-800/40">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          <span>Disabled (410)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-950/40 text-emerald-400 border border-emerald-800/40">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          <span>Active</span>
                        </span>
                      )}
                    </td>

                    {/* Total Clicks */}
                    <td className="py-3 px-4 font-mono text-zinc-200">
                      <span className="font-semibold">{link.clickCount.toLocaleString()}</span>
                    </td>

                    {/* Created Date */}
                    <td className="py-3 px-4 font-mono text-zinc-400 text-[11px]">
                      {formattedDate}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => onInspectCode(link.code)}
                          title="View Analytics"
                          className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white transition"
                        >
                          <BarChart3 className="w-3.5 h-3.5" />
                        </button>

                        <a
                          href={link.shortUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Open Link"
                          className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white transition"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>

                        {isTombstone ? (
                          <button
                            onClick={() => handleEnable(link.code)}
                            disabled={enablingCode === link.code}
                            title="Re-enable link (Restore 302 redirect)"
                            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-emerald-700 text-zinc-400 hover:text-emerald-400 transition"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleDelete(link.code)}
                            disabled={deletingCode === link.code}
                            title="Disable link (Returns HTTP 410 Gone)"
                            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-rose-900 text-zinc-400 hover:text-rose-400 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const API_BASE_URL =
  process.env["NEXT_PUBLIC_API_BASE_URL"] || "http://localhost:3001";

export interface CreateUrlPayload {
  url: string;
  customAlias?: string;
  expiresAt?: string | null;
}

export interface CreateUrlResponse {
  code: string;
  shortUrl: string;
  destinationUrl: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface UrlStatsResponse {
  code: string;
  clickCount: number;
  lastClickedAt: string | null;
  updatedAt: string;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

export async function createShortUrl(payload: CreateUrlPayload): Promise<CreateUrlResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/urls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `web-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw data as ApiError;
  }
  return data as CreateUrlResponse;
}

export async function getUrlStats(code: string): Promise<UrlStatsResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/urls/${encodeURIComponent(code)}/stats`, {
    method: "GET",
  });

  const data = await res.json();
  if (!res.ok) {
    throw data as ApiError;
  }
  return data as UrlStatsResponse;
}

export async function disableShortUrl(code: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/v1/urls/${encodeURIComponent(code)}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const data = await res.json();
    throw data as ApiError;
  }
}

export async function checkApiHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/health`, {
      method: "GET",
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function measurePing(code: string): Promise<number> {
  const start = performance.now();
  await fetch(`${API_BASE_URL}/${encodeURIComponent(code)}`, {
    method: "HEAD",
    redirect: "manual",
    cache: "no-store",
  });
  return performance.now() - start;
}


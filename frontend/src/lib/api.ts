export const API_BASE_URL =
  process.env["NEXT_PUBLIC_API_BASE_URL"] || "http://localhost:8000";

const TOKEN_STORAGE_KEY = "linklet_auth_token";

export interface AuthUser {
  id: string;
  email: string | null;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

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

export interface UrlListItem {
  code: string;
  shortUrl: string;
  destinationUrl: string;
  isCustom: boolean;
  createdAt: string;
  expiresAt: string | null;
  disabledAt: string | null;
  isActive: boolean;
  clickCount: number;
  lastClickedAt: string | null;
}

export interface UrlListResponse {
  items: UrlListItem[];
  total: number;
  totalClicks?: number;
  activeCount?: number;
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

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function getHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

export async function loginWithEmail(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw data as ApiError;
  }
  setAuthToken(data.token);
  return data as AuthResponse;
}

export async function registerWithEmail(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw data as ApiError;
  }
  setAuthToken(data.token);
  return data as AuthResponse;
}

export async function loginWithGoogle(credential: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw data as ApiError;
  }
  setAuthToken(data.token);
  return data as AuthResponse;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
      method: "GET",
      headers: getHeaders(),
    });
    if (!res.ok) {
      clearAuthToken();
      return null;
    }
    const data = await res.json();
    return {
      id: data.id,
      email: data.email,
      createdAt: data.created_at || data.createdAt,
    };
  } catch {
    return null;
  }
}

export async function logoutUser(): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
      method: "POST",
      headers: getHeaders(),
    });
  } finally {
    clearAuthToken();
  }
}

export async function listUrls(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<UrlListResponse> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.offset) query.set("offset", String(params.offset));

  const url = `${API_BASE_URL}/api/v1/urls${query.toString() ? `?${query.toString()}` : ""}`;
  const res = await fetch(url, {
    method: "GET",
    headers: getHeaders(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw data as ApiError;
  }
  return data as UrlListResponse;
}

export async function createShortUrl(payload: CreateUrlPayload): Promise<CreateUrlResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/urls`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": "application/json",
      "Idempotency-Key": `web-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    }),
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
    headers: getHeaders(),
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
    headers: getHeaders(),
  });

  if (!res.ok) {
    const data = await res.json();
    throw data as ApiError;
  }
}

export async function enableShortUrl(code: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/v1/urls/${encodeURIComponent(code)}/enable`, {
    method: "POST",
    headers: getHeaders(),
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

import { API_BASE_URL, authStorageKey } from "../config/app.config";
import type { AuthTokens } from "../types/domain";

export function apiUrl(path: string) {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

// Dispatched when all auth attempts fail — App listens to show login panel.
export const AUTH_EXPIRED_EVENT = "auth:expired";

function getStoredTokens(): AuthTokens | null {
  return JSON.parse(localStorage.getItem(authStorageKey) || "null") as AuthTokens | null;
}

function clearAuth() {
  localStorage.removeItem(authStorageKey);
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
}

// Tracks an in-flight refresh to avoid parallel refresh calls.
let refreshPromise: Promise<AuthTokens | null> | null = null;

async function attemptTokenRefresh(): Promise<AuthTokens | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const tokens = getStoredTokens();
    if (!tokens?.refreshToken) return null;

    try {
      const response = await fetch(apiUrl("/auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      if (!response.ok) return null;

      const data = await response.json() as { tokens: AuthTokens };
      if (!data?.tokens?.accessToken) return null;

      localStorage.setItem(authStorageKey, JSON.stringify(data.tokens));
      return data.tokens;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function isTokenExpiredOrSoon(): boolean {
  const tokens = getStoredTokens();
  if (!tokens?.expiresAt) return false;
  // Treat as expired if ≤60 s remain — proactive refresh before the server rejects.
  return new Date(tokens.expiresAt).getTime() - Date.now() < 60_000;
}

export async function api<T>(path: string, options?: RequestInit, _retry = false): Promise<T> {
  let tokens = getStoredTokens();

  // Proactively refresh if the access token is about to expire.
  if (tokens && isTokenExpiredOrSoon() && !_retry) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) tokens = refreshed;
    else {
      clearAuth();
      throw new Error("Session expired. Please log in again.");
    }
  }

  const headers = new Headers(options?.headers);
  if (tokens?.accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${tokens.accessToken}`);
  }

  const response = await fetch(apiUrl(path), { ...options, headers });
  const text = await response.text();
  let data: any = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }

  // On 401: try refresh once, then retry the original request.
  if (response.status === 401 && !_retry) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      // Retry with new access token.
      return api<T>(path, options, true);
    }
    // Refresh also failed — session is fully expired.
    clearAuth();
    throw new Error("Session expired. Please log in again.");
  }

  if (!response.ok) {
    throw new Error(data?.message || data?.error || text || `Request failed: ${response.status}`);
  }

  return data as T;
}

export function storageUrl(filePath?: string) {
  if (!filePath) return "";
  const marker = "/storage/";
  const index = filePath.indexOf(marker);
  if (index >= 0) return apiUrl(filePath.slice(index));
  return apiUrl(`/storage/${filePath.replace(/^.*storage\//, "")}`);
}

export async function downloadStorageFile(filePath?: string) {
  if (!filePath) return;

  // Ensure token is valid before download (same proactive check).
  if (isTokenExpiredOrSoon()) {
    const refreshed = await attemptTokenRefresh();
    if (!refreshed) { clearAuth(); throw new Error("Session expired. Please log in again."); }
  }

  const tokens = getStoredTokens();
  const headers = new Headers();
  if (tokens?.accessToken) headers.set("Authorization", `Bearer ${tokens.accessToken}`);

  const response = await fetch(storageUrl(filePath), { headers });
  if (!response.ok) {
    if (response.status === 401) {
      const refreshed = await attemptTokenRefresh();
      if (!refreshed) { clearAuth(); throw new Error("Session expired. Please log in again."); }
      return downloadStorageFile(filePath); // one retry
    }
    const t = await response.text().catch(() => "");
    throw new Error(t || `Download failed: ${response.status}`);
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  const cleanPath = filePath.split(/[\\/]/).filter(Boolean).pop() || "download";
  link.href = url;
  link.download = cleanPath;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

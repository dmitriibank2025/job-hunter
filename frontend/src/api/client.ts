import { API_BASE_URL, authStorageKey } from "../config/app.config";
import type { AuthTokens } from "../types/domain";

export function apiUrl(path: string) {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const storedTokens = JSON.parse(localStorage.getItem(authStorageKey) || "null") as AuthTokens | null;
  const headers = new Headers(options?.headers);
  if (storedTokens?.accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${storedTokens.accessToken}`);
  }
  const response = await fetch(apiUrl(path), { ...options, headers });
  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
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
  const storedTokens = JSON.parse(localStorage.getItem(authStorageKey) || "null") as AuthTokens | null;
  const headers = new Headers();
  if (storedTokens?.accessToken) headers.set("Authorization", `Bearer ${storedTokens.accessToken}`);

  const response = await fetch(storageUrl(filePath), { headers });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Download failed: ${response.status}`);
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

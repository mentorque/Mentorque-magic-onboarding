const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

/** Normalized API base URL from env. Empty string keeps same-origin behavior. */
export const API_BASE_URL = rawApiBaseUrl.trim().replace(/\/+$/, "");

/** Prefix a path with API base URL when configured. */
export function withApiBase(path: string): string {
  if (!path.startsWith("/")) return path;
  return `${API_BASE_URL}${path}`;
}

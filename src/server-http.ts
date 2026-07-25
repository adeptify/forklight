/**
 * Shared HTTP primitives for the loopback Console and Setup servers.
 * Both servers serve static assets and JSON over 127.0.0.1 with the same
 * MIME map, security headers, and safe-serialization fallback; centralizing
 * them prevents the two copies from drifting (e.g. the safeJson error string).
 */

export const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '{"error":"JSON serialization failed"}';
  }
}

/** Keep origin + path only: query strings, hashes and userinfo often carry secrets. Paths are kept. */
export function sanitizeUrl(u: string): string {
  try {
    const p = new URL(u);
    if (p.protocol === 'blob:' || p.protocol === 'data:') return p.protocol + '[omitted]';
    return p.origin === 'null' ? p.protocol : p.origin + p.pathname;
  } catch {
    return '[unparseable-url]';
  }
}

const KV = /\b(password|passwd|pwd|secret|token|access_token|refresh_token|id_token|api[_-]?key|apikey|authorization|session|cookie)\b(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi;
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Best-effort scrub of free text: URLs reduced to origin+path, Bearer values, key=value secrets,
 * user home paths, and the given secrets (case-insensitive, also URL-encoded). Capped at 300 chars.
 * App-authored text cannot be fully sanitized; pass app secrets via `secrets`.
 */
export function redact(text: string, secrets: string[] = []): string {
  let out = text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]*/gi, (m) => sanitizeUrl(m))
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(KV, '$1$2[redacted]')
    .replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/g, '~')
    .replace(/\/(?:Users|home)\/[^/\s]+/g, '~');
  for (const s of secrets) {
    if (!s) continue;
    for (const v of new Set([s, encodeURIComponent(s)])) out = out.replace(new RegExp(reEscape(v), 'gi'), '[redacted]');
  }
  return out.length > 300 ? out.slice(0, 300) + '…' : out;
}

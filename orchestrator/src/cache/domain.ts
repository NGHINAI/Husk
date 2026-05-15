/**
 * Domain normalization for the site graph cache.
 *
 * We want example.com, www.example.com, and EXAMPLE.COM to all share the
 * same cache. We do NOT want example.com and mail.example.com to share —
 * subdomains often serve completely different apps.
 *
 * v0 rule: hostname (no port/path/query) → lowercased → leading "www."
 * stripped. No Public Suffix List handling.
 */
export function normalizeDomain(url: string): string {
  const u = new URL(url); // throws on invalid input
  let host = u.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  return host;
}

/**
 * Reject domain strings that would be unsafe as filenames or are
 * implausibly long. Used as a defense-in-depth check before opening a
 * `~/.husk/site-graph/{domain}.db` file.
 */
export function isValidDomain(domain: string): boolean {
  if (!domain) return false;
  if (domain.length > 253) return false;
  // Reject anything that looks like a path traversal or whitespace
  if (/[\s/\\]/.test(domain)) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  if (domain.includes("..")) return false;
  return true;
}

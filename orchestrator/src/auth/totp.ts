import { createHmac } from "node:crypto";

/**
 * Decode an RFC 4648 base32 string into bytes. Tolerates lowercase, spaces,
 * and trailing `=` padding.
 */
export function decodeBase32(input: string): Buffer {
  const cleaned = input.replace(/\s+/g, "").replace(/=+$/, "").toUpperCase();
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`decodeBase32: invalid character "${ch}"`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export interface TotpOptions {
  /** Unix milliseconds. Default: `Date.now()`. Tests inject. */
  now?: number;
  /** Number of digits in the code. Standard is 6. */
  digits?: number;
  /** Period in seconds. Standard is 30. */
  period?: number;
}

/**
 * Generate a TOTP code (RFC 6238) from a base32-encoded secret.
 * HMAC-SHA1 is the standard algorithm; SHA256/512 are not implemented in v0.
 */
export function totpCode(secret: string, opts: TotpOptions = {}): string {
  const now = opts.now ?? Date.now();
  const period = opts.period ?? 30;
  const digits = opts.digits ?? 6;
  const counter = Math.floor(now / 1000 / period);

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const key = decodeBase32(secret);
  const hmac = createHmac("sha1", key).update(counterBuf).digest();

  // RFC 4226 §5.3 dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const mod = 10 ** digits;
  return String(bin % mod).padStart(digits, "0");
}

import { describe, expect, it } from "vitest";
import { totpCode, decodeBase32 } from "../../src/auth/totp.js";

const SECRET_HEX = "3132333435363738393031323334353637383930";
const SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("decodeBase32", () => {
  it("decodes a standard base32 string", () => {
    const buf = decodeBase32(SECRET_BASE32);
    expect(buf.toString("hex")).toBe(SECRET_HEX);
  });

  it("tolerates lowercase and spaces", () => {
    const buf = decodeBase32("gezd gnbv gy3t qojq gezd gnbv gy3t qojq");
    expect(buf.toString("hex")).toBe(SECRET_HEX);
  });

  it("strips trailing padding", () => {
    const buf = decodeBase32("MFRGG===");
    expect(buf.toString("ascii")).toBe("abc");
  });
});

describe("totpCode (RFC 6238)", () => {
  // RFC 6238 Appendix B vectors, 6-digit truncations:
  //   T=59       → 8-digit 94287082 → 6-digit 287082
  //   T=1111111109 → 8-digit 07081804 → 6-digit 081804
  //   T=1234567890 → 8-digit 89005924 → 6-digit 005924
  it("matches RFC 6238 vector at T=59 with SHA1", () => {
    const code = totpCode(SECRET_BASE32, { now: 59 * 1000, digits: 6, period: 30 });
    expect(code).toBe("287082");
  });

  it("matches RFC 6238 vector at T=1111111109", () => {
    const code = totpCode(SECRET_BASE32, { now: 1111111109 * 1000, digits: 6, period: 30 });
    expect(code).toBe("081804");
  });

  it("matches RFC 6238 vector at T=1234567890", () => {
    const code = totpCode(SECRET_BASE32, { now: 1234567890 * 1000, digits: 6, period: 30 });
    expect(code).toBe("005924");
  });

  it("uses Date.now() when `now` is omitted (smoke check format)", () => {
    const code = totpCode(SECRET_BASE32);
    expect(code).toMatch(/^\d{6}$/);
  });
});

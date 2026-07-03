/**
 * pushNative.ts — Apple Push Notification service (APNs) sender.
 *
 * Delivers a notification to an iOS device token over APNs' HTTP/2 provider API
 * using ONLY Node built-ins (node:http2 + node:crypto) — no npm dependency. This
 * is the native-iOS counterpart to the Web Push path in push.ts; sendPush() fans
 * out to both. It is entirely best-effort: a missing config or a dead connection
 * resolves to { ok:false } and never throws.
 *
 * Auth is a provider JWT (ES256) signed with an APNs Auth Key (.p8), cached and
 * re-signed roughly every 45 minutes (Apple rejects tokens older than 1h and
 * throttles re-minting more often than every 20 min).
 *
 * Config (env) — module is INERT unless all three are present:
 *   APNS_KEY_P8    contents of the AuthKey_XXXX.p8 (PEM), or base64 of the file
 *   APNS_KEY_ID    the 10-char Key ID for that .p8
 *   APPLE_TEAM_ID  the 10-char Apple Team ID (already used by fastlane)
 *   APNS_TOPIC     bundle id (default com.divvysol.app)
 *   APNS_SANDBOX=1 target api.sandbox.push.apple.com (development builds) instead
 *                  of api.push.apple.com (TestFlight / App Store)
 */

import http2 from "node:http2";
import * as crypto from "node:crypto";

const KEY_ID = (process.env.APNS_KEY_ID || "").trim();
const TEAM_ID = (process.env.APPLE_TEAM_ID || "").trim();
const TOPIC = (process.env.APNS_TOPIC || "com.divvysol.app").trim();
const SANDBOX = process.env.APNS_SANDBOX === "1" || process.env.APNS_SANDBOX === "true";
const HOST = SANDBOX ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";

/**
 * Accept the .p8 either as raw PEM (what Apple downloads) or base64. A base64
 * blob is usually the base64 of the PEM text (so it decodes back to a
 * "BEGIN PRIVATE KEY" block); if instead it's bare base64 DER, wrap it in PEM
 * armor so crypto can read it. Returns null when unusable.
 */
function normalizeP8(raw: string): string | null {
  const t = (raw || "").trim();
  if (!t) return null;
  if (t.includes("BEGIN")) return t;
  try {
    const decoded = Buffer.from(t, "base64").toString("utf8");
    if (decoded.includes("BEGIN")) return decoded;
  } catch {
    /* fall through */
  }
  // Bare base64 DER — armor it as PKCS#8.
  const wrapped = t.replace(/\s+/g, "").replace(/(.{64})/g, "$1\n");
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
}

const P8 = normalizeP8(process.env.APNS_KEY_P8 || "");

export function pushNativeConfigured(): boolean {
  return !!(KEY_ID && TEAM_ID && P8);
}

function base64url(input: Buffer | string): string {
  const b = typeof input === "string" ? Buffer.from(input) : input;
  return b.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Sign an APNs provider JWT (ES256). Exported for the selftest: pass a throwaway
 * EC P-256 key and assert the decoded header/payload. `iat` is unix seconds.
 */
export function signApnsJwt(opts: {
  keyId: string;
  teamId: string;
  key: crypto.KeyObject | string | Buffer;
  iat: number;
}): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: opts.keyId }));
  const payload = base64url(JSON.stringify({ iss: opts.teamId, iat: opts.iat }));
  const signingInput = `${header}.${payload}`;
  // JOSE requires the raw r||s (IEEE-P1363) signature, not crypto's default DER.
  // A PEM string / Buffer is a SignPrivateKeyInput; a KeyObject (what the
  // selftest passes) is a SignKeyObjectInput — both carry dsaEncoding.
  const signOpts: crypto.SignPrivateKeyInput | crypto.SignKeyObjectInput =
    typeof opts.key === "string" || Buffer.isBuffer(opts.key)
      ? { key: opts.key, dsaEncoding: "ieee-p1363" }
      : { key: opts.key, dsaEncoding: "ieee-p1363" };
  const sig = crypto.sign("sha256", Buffer.from(signingInput), signOpts);
  return `${signingInput}.${base64url(sig)}`;
}

let cachedJwt = "";
let cachedAt = 0;
function providerToken(): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedAt < 45 * 60) return cachedJwt;
  cachedJwt = signApnsJwt({ keyId: KEY_ID, teamId: TEAM_ID, key: P8 as string, iat: now });
  cachedAt = now;
  return cachedJwt;
}

export interface NativePayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Build the APNs JSON body. Exported for the selftest (assert payload shape). */
export function buildApnsBody(payload: NativePayload): string {
  const aps: Record<string, unknown> = {
    alert: { title: payload.title, body: payload.body },
    sound: "default",
  };
  if (payload.tag) aps["thread-id"] = payload.tag;
  return JSON.stringify({ aps, url: payload.url || "/" });
}

export interface ApnsResult {
  ok: boolean;
  status?: number;
  /** Apple considers this token gone — the caller should delete it. */
  dead?: boolean;
  reason?: string;
}

/**
 * Deliver one notification to one device token. Never throws; resolves to
 * { ok:false } on any config/transport error. `dead:true` means Apple reported
 * the token as invalid (410 Unregistered / BadDeviceToken) and it should be
 * pruned from the store.
 */
export function sendApns(token: string, payload: NativePayload): Promise<ApnsResult> {
  if (!pushNativeConfigured()) return Promise.resolve({ ok: false });
  return new Promise<ApnsResult>((resolve) => {
    let settled = false;
    const finish = (r: ApnsResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let client: http2.ClientHttp2Session;
    try {
      client = http2.connect(HOST);
    } catch {
      return finish({ ok: false });
    }
    client.on("error", () => finish({ ok: false }));

    let req: http2.ClientHttp2Stream;
    try {
      req = client.request({
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${providerToken()}`,
        "apns-topic": TOPIC,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      });
    } catch {
      try { client.close(); } catch { /* ignore */ }
      return finish({ ok: false });
    }

    let status = 0;
    let data = "";
    req.on("response", (headers) => {
      status = Number(headers[":status"]) || 0;
    });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      data += chunk;
    });
    req.on("error", () => {
      try { client.close(); } catch { /* ignore */ }
      finish({ ok: false });
    });
    req.on("end", () => {
      try { client.close(); } catch { /* ignore */ }
      let reason = "";
      try {
        reason = (JSON.parse(data || "{}") as { reason?: string }).reason || "";
      } catch {
        /* non-JSON body — leave reason blank */
      }
      const dead = status === 410 || reason === "BadDeviceToken" || reason === "Unregistered";
      finish({ ok: status === 200, status, dead, reason });
    });
    req.setTimeout(10_000, () => {
      try { req.close(); } catch { /* ignore */ }
      try { client.close(); } catch { /* ignore */ }
      finish({ ok: false });
    });
    req.end(buildApnsBody(payload));
  });
}

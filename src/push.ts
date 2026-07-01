/**
 * push.ts — Web Push notifications (VAPID) + a sendPush() helper.
 *
 * Owns the `push_subscriptions` table and the /api/push/* routes only. The rest
 * of the app calls `sendPush(userId, payload)` at notify-worthy moments (a share
 * paid, a nudge received). Best-effort throughout: a missing config or a dead
 * subscription never throws into a request path.
 *
 * Config (env): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 * (a mailto: or https: contact URL). Without them, push is disabled and the
 * client is told so (GET /api/push/vapid -> { enabled:false }).
 *
 * NATIVE (Capacitor iOS/Android): the browser Web Push path here covers desktop
 * + Android PWA. Native iOS/Android push uses @capacitor/push-notifications with
 * APNs/FCM at native-build time (see docs/CAPACITOR.md); the native token is
 * accepted at POST /api/push/native-token and stored for that future delivery.
 */

import webpush from "web-push";
import { Router, Request, Response } from "express";
import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";
import { requireAuth } from "./auth";

db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    p256dh TEXT,
    auth TEXT,
    kind TEXT NOT NULL DEFAULT 'web',
    created_at TEXT NOT NULL
  );
`);

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:support@divvy.app";

let configured = false;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    configured = true;
  } catch (e) {
    console.warn(`push: bad VAPID config — ${(e as Error).message}`);
  }
}

export function pushConfigured(): boolean {
  return configured;
}

interface SubRow {
  endpoint: string;
  user_id: string;
  p256dh: string | null;
  auth: string | null;
  kind: string;
}

async function saveSubscription(userId: string, sub: { endpoint: string; keys?: { p256dh?: string; auth?: string } }): Promise<void> {
  const now = new Date().toISOString();
  const p256dh = sub.keys?.p256dh || null;
  const auth = sub.keys?.auth || null;
  if (usingSupabase) {
    const { error } = await supabase()
      .from("push_subscriptions")
      .upsert(
        { endpoint: sub.endpoint, user_id: userId, p256dh, auth, kind: "web", created_at: now },
        { onConflict: "endpoint" }
      );
    if (error) throw new Error(`push.save: ${error.message}`);
    return;
  }
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, kind, created_at)
     VALUES (?, ?, ?, ?, 'web', ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(sub.endpoint, userId, p256dh, auth, now);
}

async function deleteSubscription(endpoint: string): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase().from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) throw new Error(`push.delete: ${error.message}`);
    return;
  }
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

async function listSubscriptions(userId: string): Promise<SubRow[]> {
  if (usingSupabase) {
    const { data, error } = await supabase().from("push_subscriptions").select("*").eq("user_id", userId);
    if (error) throw new Error(`push.list: ${error.message}`);
    return (data as SubRow[]) || [];
  }
  return db.prepare("SELECT * FROM push_subscriptions WHERE user_id = ?").all(userId) as SubRow[];
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Deliver a notification to every web subscription a user has. Best-effort:
 * swallows errors, and prunes subscriptions the push service reports as gone
 * (404/410). Never throws — safe to call from inside a verify loop.
 */
export async function sendPush(userId: string | null | undefined, payload: PushPayload): Promise<void> {
  if (!configured || !userId) return;
  let subs: SubRow[];
  try {
    subs = await listSubscriptions(userId);
  } catch {
    return;
  }
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/",
    tag: payload.tag,
  });
  await Promise.all(
    subs
      .filter((s) => s.kind === "web" && s.p256dh && s.auth)
      .map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh as string, auth: s.auth as string } },
            body
          );
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            try { await deleteSubscription(s.endpoint); } catch { /* ignore */ }
          }
        }
      })
  );
}

export const pushRouter = Router();

pushRouter.get("/api/push/vapid", (_req: Request, res: Response) => {
  res.json({ enabled: configured, publicKey: configured ? VAPID_PUBLIC : null });
});

pushRouter.post("/api/push/subscribe", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const sub = (req.body || {}) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!sub.endpoint || typeof sub.endpoint !== "string") {
    return res.status(400).json({ error: "missing subscription endpoint" });
  }
  try {
    await saveSubscription(userId, sub as { endpoint: string; keys?: { p256dh?: string; auth?: string } });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

pushRouter.post("/api/push/unsubscribe", requireAuth, async (req: Request, res: Response) => {
  const { endpoint } = (req.body || {}) as { endpoint?: string };
  if (!endpoint) return res.status(400).json({ error: "missing endpoint" });
  try {
    await deleteSubscription(endpoint);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// Native (Capacitor) device token registration. Stored for future APNs/FCM
// delivery; harmless no-op on the web path.
pushRouter.post("/api/push/native-token", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const { token, platform } = (req.body || {}) as { token?: string; platform?: string };
  if (!token) return res.status(400).json({ error: "missing token" });
  const now = new Date().toISOString();
  try {
    if (usingSupabase) {
      await supabase().from("push_subscriptions").upsert(
        { endpoint: `native:${token}`, user_id: userId, p256dh: null, auth: null, kind: platform === "ios" ? "apns" : "fcm", created_at: now },
        { onConflict: "endpoint" }
      );
    } else {
      db.prepare(
        `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, kind, created_at)
         VALUES (?, ?, NULL, NULL, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id`
      ).run(`native:${token}`, userId, platform === "ios" ? "apns" : "fcm", now);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

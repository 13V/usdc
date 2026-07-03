/**
 * ratelimit.ts — the app's single tiny in-memory IP rate limiter.
 *
 * Fixed-window, per-IP, no external dependency. Tracks recent request
 * timestamps per IP in a Map and rejects with 429 once a client exceeds `max`
 * requests within `windowMs`. Lives in its own module so both server.ts and the
 * feature routers (chat/reactions/friends/push/recurring/ious) can share the
 * SAME limiter tiers without a circular import through server.ts.
 *
 * Memory safety: stale IP buckets are pruned on ANY insert once the Map grows
 * past a threshold — NOT only in the 429 branch — so a flood of distinct
 * never-limited IPs (IP churn behind a proxy) can't grow the Map unbounded.
 *
 * IMPORTANT: correct per-IP accounting REQUIRES `app.set("trust proxy", 1)` in
 * server.ts. Without it, req.ip behind Railway's proxy is the shared proxy IP
 * and every user shares one bucket (a global limiter). See server.ts.
 */

import { Request, Response } from "express";

export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: () => void): void => {
    const now = Date.now();
    const ip = req.ip || "unknown";
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    // Prune stale IPs on any insert once the Map gets large — NOT only in the 429
    // branch, or a flood of distinct never-limited IPs would grow it unboundedly.
    if (hits.size > 10000) {
      for (const [k, v] of hits) {
        if (v.every((t) => now - t >= windowMs)) hits.delete(k);
      }
    }
    if (recent.length >= max) {
      res.status(429).json({ error: "too many requests, slow down" });
      return;
    }
    recent.push(now);
    hits.set(ip, recent);
    next();
  };
}

// Money endpoints: tighter caps so the settle/verify + bill paths can't be
// hammered and RPC-backed verifies can't be used as a chain-scan sink. Shared by
// server.ts (bills/trips settle+verify) and ious.ts (IOU verify).
export const moneyRateLimit = rateLimit(30, 60_000); // ~30 req/min per IP

// Shared write tiers for ordinary mutations and creation spam across server.ts
// and the routers. Kept to exactly TWO new tiers on purpose (no per-endpoint
// constant zoo):
//   writeRateLimit — ordinary authenticated mutations: create/edit/delete an
//     expense, member, group, chat message, reaction, push sub, recurring rule,
//     IOU, profile PATCH. Generous enough to never bite a real collaborator.
//   spamRateLimit  — endpoints where MASS CREATION or notifying other users is
//     the abuse: new trips, new friend requests. Tighter.
export const writeRateLimit = rateLimit(40, 60_000); // ~40 writes/min per IP
export const spamRateLimit = rateLimit(10, 60_000); // ~10 creates/min per IP

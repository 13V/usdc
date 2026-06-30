/**
 * alerts.ts — operational alerting for money-path anomalies.
 *
 * logMoney() (in server.ts) already writes a structured audit line for every
 * money event. This module adds the *paging* layer the pre-mainnet checklist
 * asks for: turn a few high-signal conditions into an out-of-band alert so an
 * operator hears about them instead of having to grep logs after the fact.
 *
 * Transport: if ALERT_WEBHOOK_URL is set (Slack / Discord / any JSON webhook)
 * we POST a compact payload; otherwise we just emit a structured `ALERT` line
 * to stderr. Either way this NEVER throws and never blocks a request — alerting
 * must not be able to break settlement.
 *
 * Signals wired today (see server.ts):
 *  - `signature_reuse_blocked` — claimSignature rejected a signature that was
 *    already spent on another share. This is the exact double-credit attempt the
 *    global consumed-signature store exists to stop; a real one should page.
 *  - `verify_failure_spike` — an unusual burst of failed payment verifications
 *    (probing, a broken client, or an attack), rate-limited to one page/window.
 *  - `fund_volume` — the devnet faucet dripping faster than expected (abuse).
 */

export type Severity = "critical" | "high" | "medium" | "low";

const WEBHOOK = process.env.ALERT_WEBHOOK_URL || "";

/** Fire-and-forget alert. Structured stderr line always; webhook if configured. */
export function alert(
  severity: Severity,
  event: string,
  details: Record<string, unknown> = {}
): void {
  const payload = {
    t: new Date().toISOString(),
    evt: "alert",
    severity,
    event,
    ...details,
  };
  // Always emit a greppable line — this is the durable record even with no webhook.
  try {
    console.error(JSON.stringify(payload));
  } catch {
    /* ignore */
  }
  if (!WEBHOOK) return;
  // Best-effort POST. We don't await; a slow/broken webhook can't stall a request.
  try {
    const body = JSON.stringify({
      // Slack/Discord both render a top-level `text`/`content`; include both plus
      // the raw payload so generic webhooks get the structured data too.
      text: `[${severity.toUpperCase()}] divvy ${event}: ${JSON.stringify(details)}`,
      content: `[${severity.toUpperCase()}] divvy ${event}: ${JSON.stringify(details)}`,
      ...payload,
    });
    void fetch(WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }).catch(() => {
      /* swallow — alerting is best-effort */
    });
  } catch {
    /* never let alerting break a request */
  }
}

/**
 * Sliding-window spike detector. Records an event timestamp and returns true
 * only when the count in the trailing `windowMs` first crosses `threshold`, and
 * then at most once per `cooldownMs` — so a sustained problem pages once, not on
 * every event. Used for verify-failure and fund-volume bursts.
 */
export function makeSpikeDetector(threshold: number, windowMs: number, cooldownMs = windowMs) {
  let hits: number[] = [];
  let lastFired = 0;
  function record(now = Date.now()): { fired: boolean; count: number } {
    hits.push(now);
    // Drop anything outside the window. Reassign (cheap) to keep it bounded.
    const cutoff = now - windowMs;
    if (hits.length > 512 || hits[0] < cutoff) hits = hits.filter((t) => t >= cutoff);
    const count = hits.length;
    if (count >= threshold && now - lastFired >= cooldownMs) {
      lastFired = now;
      return { fired: true, count };
    }
    return { fired: false, count };
  }
  return { record };
}

/**
 * og.ts — Open Graph / Twitter share-card meta for the growth loop.
 *
 * Share links (the trip `/t/:token` page and the `/pay/...` pages) are Divvy's
 * main organic surface: when someone drops a link in iMessage / WhatsApp /
 * Slack / Twitter it should unfurl into a beautiful card. This module builds the
 * dynamic <head> meta (title/description/image) and — for the SPA-served trip
 * page — injects it into public/index.html at serve time.
 *
 * SCOPE: pure helpers only. No DB, no routes. The og:image itself is a static,
 * committed PNG (public/og/card.png); only the TEXT is dynamic. There is no
 * server-side image rendering.
 */

import * as fs from "fs";
import * as path from "path";
import { fmt } from "./split";

// Escape a string for an HTML attribute / text context. Same table as the
// renderers in server.ts — kept local so og.ts stays dependency-free. Handles
// quotes, angle brackets and ampersands; emoji pass through untouched (they are
// not in the escape set), so a trip named `"quo & <tag> 🎉"` is safe here.
export function escAttr(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

export interface OgMetaInput {
  title: string;
  description: string;
  /** ABSOLUTE image URL (crawlers require an absolute og:image). */
  imageUrl: string;
  /** ABSOLUTE canonical URL of the page. */
  url: string;
}

/**
 * The dynamic <head> meta block: a <title>, description, the Open Graph tags and
 * the Twitter summary_large_image tags. Every value is escaped for attribute
 * context. Returns a string of tags (no wrapping element) so it can be dropped
 * straight into a <head>.
 */
export function ogMeta(input: OgMetaInput): string {
  const title = escAttr(input.title);
  const desc = escAttr(input.description);
  const image = escAttr(input.imageUrl);
  const url = escAttr(input.url);
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Divvy" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${desc}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ].join("\n");
}

/** Canonical path to the static journal-styled share card (served from public/). */
export const OG_CARD_PATH = "/og/card.png";

// ---- Trip share page (SPA) meta injection ---------------------------------

const INDEX_HTML_PATH = path.resolve(process.cwd(), "public/index.html");
let cachedIndexHtml: string | null = null;
function indexHtml(): string {
  if (cachedIndexHtml == null) cachedIndexHtml = fs.readFileSync(INDEX_HTML_PATH, "utf8");
  return cachedIndexHtml;
}

/**
 * Insert a meta block into the SPA shell's <head> right after the charset meta,
 * so the dynamic tags appear BEFORE index.html's static defaults. Crawlers use
 * the first occurrence of a scalar og property, so ours win the unfurl while the
 * static tags remain a harmless fallback. Charset stays first (well under the
 * 1024-byte window) so the document still parses correctly.
 */
function injectHead(html: string, meta: string): string {
  const marker = '<meta charset="utf-8" />';
  const at = html.indexOf(marker);
  if (at < 0) return html.replace("<head>", `<head>\n${meta}`);
  const end = at + marker.length;
  return `${html.slice(0, end)}\n${meta}\n${html.slice(end)}`;
}

/**
 * The ROOT landing shell (GET /): the SPA served with a static-yet-branded OG
 * card injected, so a cold link tapped on X/iMessage unfurls into the journal
 * card instead of index.html's generic defaults. Text is fixed (no per-request
 * data) but goes through the same injectHead path so it wins the unfurl over the
 * static fallback tags. Image is the committed share card (public/og/card.png).
 */
export function rootShellHtml(base: string): string {
  const meta = ogMeta({
    title: "divvy — split bills, settle in dollars",
    description:
      "scan the receipt, tap who had what, friends pay from a text. instant, on solana.",
    imageUrl: `${base}${OG_CARD_PATH}`,
    url: `${base}/`,
  });
  return injectHead(indexHtml(), meta);
}

export interface TripShareCard {
  name: string;
  token: string;
  memberCount: number;
  totalCents: number;
  /** ABSOLUTE origin, e.g. "https://divvy.app". */
  base: string;
}

/**
 * The full trip share page: the SPA shell with a trip-specific OG card injected.
 * Title: "<name> — you're invited to split on divvy".
 * Description: "3 people · $170 split so far · settle in dollars, instantly".
 */
export function tripShareHtml(card: TripShareCard): string {
  const people = card.memberCount === 1 ? "1 person" : `${card.memberCount} people`;
  const meta = ogMeta({
    title: `${card.name} — you're invited to split on divvy`,
    description: `${people} · ${fmt(card.totalCents)} split so far · settle in dollars, instantly`,
    imageUrl: `${card.base}${OG_CARD_PATH}`,
    url: `${card.base}/t/${card.token}`,
  });
  return injectHead(indexHtml(), meta);
}

/**
 * server.ts — Express web app.
 *
 * API:
 *   POST /api/bills            create a bill (returns the bill with per-person URLs)
 *   GET  /api/bills            list bills
 *   GET  /api/bills/:id        fetch one bill
 *   POST /api/bills/:id/verify check the chain for payments, flip PAID
 *
 * Pages:
 *   GET  /                     mobile-first UI (public/index.html)
 *   GET  /pay/:id/:name        shareable server-rendered pay page (wallet QR +
 *                              "Pay with card" buttons) for one participant
 */

import "dotenv/config";
import * as path from "path";
import express, { Request, Response } from "express";
import { Connection, clusterApiUrl, PublicKey } from "@solana/web3.js";
import { createBill, Bill, BillFx, collectedCents, outstandingCents } from "./bill";
import { store } from "./store";
import {
  listGroups,
  createGroup,
  deleteGroup,
  getGroup,
  touchGroup,
} from "./groups";
import { validatePayment } from "./verify";
import { qrToDataUrl } from "./qr";
import { cardOptions } from "./onramp";
import { fmt, toCents, withTip, SplitMode } from "./split";
import { Cluster } from "./solanaPay";
import { scanReceipt, parseDataUrl, NoScanProvider } from "./scan";
import {
  convertForeignCentsToUsd,
  convertMajorToUsd,
  formatForeign,
  isSupported,
} from "./fx";

const PORT = Number(process.env.PORT || 3000);
const CLUSTER = (process.env.CLUSTER as Cluster) || "devnet";
const COLLECTOR =
  process.env.COLLECTOR_WALLET || "11111111111111111111111111111111"; // system program as a harmless default

function rpcUrl(cluster: Cluster): string {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  return clusterApiUrl(cluster);
}

const app = express();
// Receipt images arrive as base64 in the JSON body, so allow a larger payload.
app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.resolve(process.cwd(), "public")));

// ---- API ------------------------------------------------------------------

interface CreateBillBody {
  title?: string;
  total?: number | string; // dollars
  tipPercent?: number;
  names?: string[];
  mode?: SplitMode;
  weights?: number[];
  customCents?: number[];
  collector?: string;
  cluster?: Cluster;
  groupId?: string;
  count?: number;
  saveGroupName?: string;
  fx?: BillFx;
}

app.post("/api/bills", (req: Request, res: Response) => {
  try {
    const body = req.body as CreateBillBody;

    // Resolve participant names. Precedence: groupId > explicit names > count.
    let names = (body.names || []).map((n) => String(n).trim()).filter(Boolean);

    if (body.groupId) {
      const group = getGroup(body.groupId);
      if (!group) return res.status(404).json({ error: "group not found" });
      names = group.members.map((m) => String(m).trim()).filter(Boolean);
      touchGroup(body.groupId);
    } else if (names.length === 0 && Number.isInteger(body.count) && (body.count as number) > 0) {
      names = Array.from({ length: body.count as number }, (_v, i) => `Person ${i + 1}`);
    }

    if (names.length === 0) return res.status(400).json({ error: "need at least one name" });
    if (body.total == null) return res.status(400).json({ error: "need a total" });

    // Best-effort: persist this set of names as a reusable group. Never let a
    // group-save failure block bill creation.
    const saveGroupName = body.saveGroupName && String(body.saveGroupName).trim();
    if (saveGroupName) {
      try {
        createGroup(saveGroupName, names);
      } catch {
        /* ignore — saving a group is a convenience, not a requirement */
      }
    }

    let totalCents = toCents(body.total);
    if (body.tipPercent) totalCents = withTip(totalCents, body.tipPercent);

    const bill = createBill({
      title: body.title || "Dinner",
      cluster: body.cluster || CLUSTER,
      collector: body.collector || COLLECTOR,
      totalCents,
      names,
      mode: body.mode || "equal",
      weights: body.weights,
      customCents: body.customCents,
      fx: body.fx,
    });
    store.put(bill);
    res.json(serializeBill(bill));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get("/api/bills", (_req: Request, res: Response) => {
  res.json(store.all().map(serializeBill));
});

app.get("/api/bills/:id", (req: Request, res: Response) => {
  const bill = store.get(req.params.id);
  if (!bill) return res.status(404).json({ error: "not found" });
  res.json(serializeBill(bill));
});

app.post("/api/bills/:id/verify", async (req: Request, res: Response) => {
  const bill = store.get(req.params.id);
  if (!bill) return res.status(404).json({ error: "not found" });
  try {
    const connection = new Connection(rpcUrl(bill.cluster), "confirmed");
    const updated: string[] = [];
    for (const p of bill.participants) {
      if (p.paid) continue;
      // Production gate: only mark PAID once the transfer is validated at
      // "finalized" with the exact amount, token, and collector ATA.
      const valid = await validatePayment(connection, {
        reference: p.reference,
        recipient: bill.collector,
        splToken: bill.splToken,
        amountCents: p.amountCents,
      });
      if (valid.ok) {
        p.paid = true;
        p.signature = valid.signature;
        updated.push(p.name);
      }
    }
    store.put(bill);
    res.json({ ...serializeBill(bill), updated });
  } catch (err) {
    res.status(502).json({ error: `verify failed: ${(err as Error).message}` });
  }
});

// ---- Saved groups ---------------------------------------------------------

app.get("/api/groups", (_req: Request, res: Response) => {
  res.json(listGroups());
});

app.post("/api/groups", (req: Request, res: Response) => {
  const body = req.body as { name?: string; members?: string[] };
  try {
    const group = createGroup(body.name || "", body.members || []);
    res.json(group);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete("/api/groups/:id", (req: Request, res: Response) => {
  if (deleteGroup(req.params.id)) return res.json({ ok: true });
  res.status(404).json({ error: "not found" });
});

// Scan a receipt photo -> detected total (so the host can skip typing it).
// Body: { image: "data:image/jpeg;base64,..." | "<base64>" }
app.post("/api/scan", async (req: Request, res: Response) => {
  const image = (req.body as { image?: string }).image;
  if (!image || typeof image !== "string") {
    return res.status(400).json({ error: "need an image" });
  }
  try {
    const { data, mediaType } = parseDataUrl(image);
    const result = await scanReceipt(data, mediaType);

    // If the receipt is in a foreign currency, convert it to USD ONCE here so
    // the split runs on USD cents. The original amount + locked rate are echoed
    // back for transparency. Any conversion problem falls back to "as today".
    if (result.currency && result.currency !== "USD" && isSupported(result.currency)) {
      try {
        const { usdCents, rate, asOf, source } = await convertForeignCentsToUsd(
          result.totalCents,
          result.currency
        );
        return res.json({
          total: (usdCents / 100).toFixed(2), // USD dollars used for the split
          totalFmt: fmt(usdCents), // USD
          currency: result.currency,
          merchant: result.merchant,
          confidence: result.confidence,
          converted: true,
          originalAmount: result.totalCents / 100,
          originalCurrency: result.currency,
          originalFmt: formatForeign(result.totalCents / 100, result.currency),
          rate,
          fxAsOf: asOf,
          fxSource: source,
        });
      } catch {
        /* fall through to the USD/passthrough response below */
      }
    }

    res.json({
      ...result,
      totalFmt: fmt(result.totalCents),
      // Dollars for prefilling the form (the client re-derives cents via the API).
      total: (result.totalCents / 100).toFixed(2),
      converted: false,
    });
  } catch (err) {
    if (err instanceof NoScanProvider) {
      // Honest, graceful fallback: tell the client to ask for the total manually.
      return res.status(503).json({ needsManualEntry: true, error: (err as Error).message });
    }
    res.status(502).json({ error: `scan failed: ${(err as Error).message}` });
  }
});

// FX quote: convert a local-currency MAJOR amount to USD at the current locked
// rate. e.g. GET /api/fx/THB/2450 -> USD value + rate/source/timestamp.
app.get("/api/fx/:from/:amount", async (req: Request, res: Response) => {
  const from = String(req.params.from || "").toUpperCase();
  const amount = Number(req.params.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "bad amount" });
  }
  if (!isSupported(from)) {
    return res.status(400).json({ error: `unsupported currency: ${from}` });
  }
  try {
    const { usdCents, rate, asOf, source } = await convertMajorToUsd(amount, from);
    res.json({
      from,
      amount,
      rate,
      asOf,
      source,
      usdCents,
      usdFmt: fmt(usdCents),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Card on-ramp links for an arbitrary wallet + amount. Used by the embedded
// pay page to top up a freshly created wallet.
app.get("/api/onramp/:wallet/:amountCents", (req: Request, res: Response) => {
  const amountCents = Number(req.params.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return res.status(400).json({ error: "bad amount" });
  }
  try {
    // eslint-disable-next-line no-new
    new PublicKey(req.params.wallet);
  } catch {
    return res.status(400).json({ error: "bad wallet address" });
  }
  res.json(cardOptions({ walletAddress: req.params.wallet, amountCents }));
});

// ---- Pay page (server-rendered) -------------------------------------------

app.get("/pay/:id/:name", async (req: Request, res: Response) => {
  const bill = store.get(req.params.id);
  if (!bill) return res.status(404).send("Bill not found");
  const name = decodeURIComponent(req.params.name);
  const p = bill.participants.find((x) => x.name === name);
  if (!p) return res.status(404).send("Participant not found");

  const qr = await qrToDataUrl(p.url);
  const cards = cardOptions({ walletAddress: bill.collector, amountCents: p.amountCents });
  res.type("html").send(renderPayPage(bill, name, p.url, p.amountCents, qr, cards, p.paid));
});

// ---- helpers --------------------------------------------------------------

function serializeBill(bill: Bill) {
  const fxNote = bill.fx
    ? `Originally ${formatForeign(bill.fx.sourceAmount, bill.fx.sourceCurrency)} ${
        bill.fx.sourceCurrency
      } @ $${bill.fx.rate.toFixed(4)} (as of ${bill.fx.asOf})`
    : undefined;
  return {
    ...bill,
    totalFmt: fmt(bill.totalCents),
    collectedFmt: fmt(collectedCents(bill)),
    outstandingFmt: fmt(outstandingCents(bill)),
    settled: outstandingCents(bill) === 0,
    fx: bill.fx ?? null,
    ...(fxNote ? { fxNote } : {}),
    participants: bill.participants.map((p) => ({
      ...p,
      amountFmt: fmt(p.amountCents),
      payPath: `/pay/${bill.id}/${encodeURIComponent(p.name)}`,
    })),
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

function renderPayPage(
  bill: Bill,
  name: string,
  url: string,
  amountCents: number,
  qrDataUrl: string,
  cards: { moonpay: string; coinbase: string },
  paid: boolean
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(bill.title)} — ${esc(name)}'s share</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 24px;
         max-width: 480px; margin-inline: auto; line-height: 1.5; }
  h1 { font-size: 1.25rem; margin: 0 0 4px; }
  .muted { color: #888; font-size: .9rem; }
  .amount { font-size: 2.25rem; font-weight: 700; margin: 12px 0; }
  .card { border: 1px solid #8884; border-radius: 14px; padding: 18px; margin: 16px 0; text-align: center; }
  img.qr { width: 260px; height: 260px; image-rendering: pixelated; }
  a.btn { display: block; padding: 14px; border-radius: 12px; text-decoration: none;
          font-weight: 600; margin: 8px 0; border: 1px solid #8884; }
  a.btn.primary { background: #14f195; color: #04121a; }
  .paid { background: #14f195; color: #04121a; padding: 10px; border-radius: 10px; text-align:center; font-weight:700; }
  code { word-break: break-all; font-size: .75rem; color:#888; }
</style>
</head>
<body>
  <h1>${esc(bill.title)}</h1>
  <div class="muted">${esc(name)}'s share · settle in USDC on ${esc(bill.cluster)}</div>
  <div class="amount">${fmt(amountCents)}</div>
  ${paid ? `<div class="paid">✓ Paid — thank you!</div>` : `
  <div class="card">
    <strong>Pay with a Solana wallet</strong>
    <div class="muted">Scan with Phantom, Solflare, etc.</div>
    <p><img class="qr" src="${qrDataUrl}" alt="Solana Pay QR" /></p>
    <a class="btn primary" href="${esc(url)}">Open in wallet</a>
    <code>${esc(url)}</code>
  </div>
  <div class="card">
    <strong>No crypto? Pay with card</strong>
    <div class="muted">Buys USDC and sends it to the collector.</div>
    <a class="btn" href="${esc(cards.moonpay)}" target="_blank" rel="noopener">Pay with card · MoonPay</a>
    <a class="btn" href="${esc(cards.coinbase)}" target="_blank" rel="noopener">Pay with card · Coinbase</a>
  </div>
  <div class="card">
    <strong>No wallet at all?</strong>
    <div class="muted">Sign in with email/phone — we make you a wallet, no seed phrase.</div>
    <a class="btn" href="/embedded/?bill=${esc(bill.id)}&name=${encodeURIComponent(name)}">Create a wallet &amp; pay</a>
  </div>`}
  <p class="muted">Collector: <code>${esc(bill.collector)}</code></p>
</body>
</html>`;
}

if (require.main === module) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Divvy web app on http://localhost:${PORT}  (cluster: ${CLUSTER})`);
    if (COLLECTOR === "11111111111111111111111111111111") {
      // eslint-disable-next-line no-console
      console.log("⚠  COLLECTOR_WALLET not set — using a placeholder. Set it in .env.");
    }
  });
}

export { app };

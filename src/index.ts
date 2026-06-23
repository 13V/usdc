/**
 * index.ts — CLI: demo / new / status / qr / verify
 *
 * Usage:
 *   npm run demo
 *   npm run new -- --title "Dinner" --total 87.40 --names "Ava,Ben,Cy" [--mode equal] [--tip 18]
 *   npm run status -- <billId>
 *   npm run qr     -- <billId> [name]
 *   npm run verify -- <billId>
 */

import "dotenv/config";
import { Connection, clusterApiUrl } from "@solana/web3.js";
import {
  createBill,
  saveBill,
  loadBill,
  collectedCents,
  outstandingCents,
  Bill,
} from "./bill";
import { fmt, toCents, withTip, SplitMode } from "./split";
import { Cluster } from "./solanaPay";
import { qrToTerminal } from "./qr";
import { validatePayment } from "./verify";

const CLUSTER = (process.env.CLUSTER as Cluster) || "devnet";
const COLLECTOR = process.env.COLLECTOR_WALLET || "11111111111111111111111111111111";

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[key] = val;
    }
  }
  return out;
}

function rpcUrl(cluster: Cluster): string {
  return process.env.RPC_URL || clusterApiUrl(cluster);
}

function printBill(bill: Bill): void {
  console.log(`\n${bill.title}  [${bill.id}]`);
  console.log(`cluster=${bill.cluster}  total=${fmt(bill.totalCents)}  collector=${bill.collector}`);
  console.log(
    `collected=${fmt(collectedCents(bill))}  outstanding=${fmt(outstandingCents(bill))}\n`
  );
  for (const p of bill.participants) {
    const mark = p.paid ? "✓ PAID" : "· owes";
    console.log(`  ${mark}  ${p.name.padEnd(12)} ${fmt(p.amountCents).padStart(8)}`);
    console.log(`         ${p.url}`);
  }
  console.log("");
}

async function cmdDemo(): Promise<void> {
  // $74.07 + 18% tip = $87.40 -> 29.14 / 29.13 / 29.13
  const totalCents = withTip(toCents(74.07), 18);
  const bill = createBill({
    title: "Dinner (demo)",
    cluster: CLUSTER,
    collector: COLLECTOR,
    totalCents,
    names: ["Ava", "Ben", "Cy"],
    mode: "equal",
  });
  saveBill(bill);
  console.log(`Created demo bill. total=${fmt(totalCents)} (= $74.07 + 18% tip)`);
  printBill(bill);
}

async function cmdNew(flags: Record<string, string>): Promise<void> {
  if (!flags.total || !flags.names) {
    throw new Error('new requires --total <dollars> and --names "A,B,C"');
  }
  const names = flags.names.split(",").map((s) => s.trim()).filter(Boolean);
  let totalCents = toCents(flags.total);
  if (flags.tip) totalCents = withTip(totalCents, Number(flags.tip));

  const mode = (flags.mode as SplitMode) || "equal";
  const weights = flags.weights ? flags.weights.split(",").map(Number) : undefined;

  const bill = createBill({
    title: flags.title || "Bill",
    cluster: CLUSTER,
    collector: COLLECTOR,
    totalCents,
    names,
    mode,
    weights,
  });
  saveBill(bill);
  printBill(bill);
}

async function cmdStatus(id: string): Promise<void> {
  printBill(loadBill(id));
}

async function cmdQr(id: string, name?: string): Promise<void> {
  const bill = loadBill(id);
  const targets = name ? bill.participants.filter((p) => p.name === name) : bill.participants;
  for (const p of targets) {
    console.log(`\n${p.name} — ${fmt(p.amountCents)}`);
    console.log(await qrToTerminal(p.url));
  }
}

async function cmdVerify(id: string): Promise<void> {
  const bill = loadBill(id);
  const connection = new Connection(rpcUrl(bill.cluster), "confirmed");
  for (const p of bill.participants) {
    if (p.paid) continue;
    const valid = await validatePayment(connection, {
      reference: p.reference,
      recipient: bill.collector,
      splToken: bill.splToken,
      amountCents: p.amountCents,
    });
    if (valid.ok) {
      p.paid = true;
      p.signature = valid.signature;
      console.log(`✓ ${p.name} paid (validated) — ${valid.signature}`);
    }
  }
  saveBill(bill);
  printBill(bill);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const positional = rest.filter((a) => !a.startsWith("--"));

  switch (cmd) {
    case "demo":
      return cmdDemo();
    case "new":
      return cmdNew(flags);
    case "status":
      return cmdStatus(positional[0]);
    case "qr":
      return cmdQr(positional[0], positional[1]);
    case "verify":
      return cmdVerify(positional[0]);
    default:
      console.log(
        "Commands:\n  demo\n  new --title T --total D --names A,B,C [--mode equal|weighted] [--tip 18] [--weights 2,1,1]\n  status <billId>\n  qr <billId> [name]\n  verify <billId>"
      );
  }
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});

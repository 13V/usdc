/**
 * mainnet-preflight.ts — go/no-go gate for the mainnet flip. READ-ONLY.
 *
 *   npm run preflight:mainnet                      # checks the process env
 *   npm run preflight:mainnet -- --env-file .env.mainnet
 *   npm run preflight:mainnet -- --env-file .env.mainnet --allow-high-caps --ping-webhooks
 *
 * Reads the CANDIDATE environment (a dotenv-style file via --env-file, else
 * this process's env), runs every launch check, prints one colored line per
 * check (✓ green / ⚠ yellow / ✗ red), and exits non-zero if ANY check is red.
 * Nothing here writes — not to the chain, not to the database, not to disk.
 *
 * NOTE on --env-file: the file is used EXCLUSIVELY (process env is ignored) so
 * a dev shell's devnet variables can't leak into the verdict.
 *
 * Companion: docs/GO-LIVE.md (the morning runbook).
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { parse as parseDotenv } from "dotenv";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getMint } from "@solana/spl-token";
import { createClient } from "@supabase/supabase-js";

// ---- args -------------------------------------------------------------------

const argv = process.argv.slice(2);
function flag(name: string): boolean {
  return argv.includes(name);
}
function opt(name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

const ENV_FILE = opt("--env-file");
const ALLOW_HIGH_CAPS = flag("--allow-high-caps");
const PING_WEBHOOKS = flag("--ping-webhooks");

/** The candidate env under test. */
const env: Record<string, string | undefined> = (() => {
  if (!ENV_FILE) return { ...process.env };
  const p = path.resolve(process.cwd(), ENV_FILE);
  const parsed = parseDotenv(fs.readFileSync(p));
  // Exclusive: only what the candidate file declares (empty values = unset).
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(parsed)) if (String(v).trim() !== "") out[k] = String(v);
  return out;
})();

// ---- output helpers ------------------------------------------------------------

const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m", DIM = "\x1b[2m", RESET = "\x1b[0m";
let reds = 0, yellows = 0;
function green(name: string, detail = ""): void {
  console.log(`${GREEN}  ✓ ${name}${RESET}${detail ? `${DIM}  — ${detail}${RESET}` : ""}`);
}
function yellow(name: string, detail = ""): void {
  yellows++;
  console.log(`${YELLOW}  ⚠ ${name}${detail ? `  — ${detail}` : ""}${RESET}`);
}
function red(name: string, detail = ""): void {
  reds++;
  console.log(`${RED}  ✗ ${name}${detail ? `  — ${detail}` : ""}${RESET}`);
}

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

// Local replica of onramp.ts#ramsConfigured evaluated against the CANDIDATE env
// (the module reads process.env, which is not the env under test here).
function railsLiveOnMainnet(): boolean {
  const mp = env.MOONPAY_API_KEY;
  const cb = env.COINBASE_ONRAMP_APP_ID;
  const mpLive =
    Boolean(mp && !/PLACEHOLDER/i.test(mp)) &&
    Boolean(mp && mp.startsWith("pk_live_")) &&
    Boolean(env.MOONPAY_SECRET_KEY);
  const cbSet = Boolean(cb && !/PLACEHOLDER/i.test(cb));
  return mpLive || cbSet;
}

async function main(): Promise<void> {
  console.log(`\nDivvy mainnet preflight ${DIM}(${ENV_FILE ? `env file: ${ENV_FILE}` : "process env"})${RESET}\n`);

  // ---- 1. CLUSTER ------------------------------------------------------------
  const cluster = String(env.CLUSTER || "").trim();
  if (cluster === "mainnet-beta") {
    green("CLUSTER is exactly \"mainnet-beta\"");
  } else if (/^mainnet(-beta)?$/i.test(cluster)) {
    red("CLUSTER", `"${cluster}" — the boot normalizes this with a warning, but the env must say mainnet-beta EXACTLY`);
  } else {
    red("CLUSTER", `"${cluster || "(unset)"}" — must be exactly "mainnet-beta"`);
  }

  // ---- 2. devnet leftovers must be ABSENT -------------------------------------
  for (const key of ["MINT_AUTHORITY_SECRET", "TEST_USDC_MINT", "PAYER_SECRET_KEY"]) {
    if (env[key]) red(`${key} present`, "devnet-only material must be DELETED from the mainnet environment");
    else green(`${key} absent`);
  }
  if (env.CONSUMED_SIG_FAIL_OPEN === "1") {
    red("CONSUMED_SIG_FAIL_OPEN=1", "double-credit guard would fail OPEN — delete this var");
  } else if (env.CONSUMED_SIG_FAIL_OPEN) {
    yellow("CONSUMED_SIG_FAIL_OPEN set (not \"1\")", "harmless but confusing — delete it");
  } else {
    green("CONSUMED_SIG_FAIL_OPEN absent", "signature guard fails closed");
  }

  // ---- 3. RPC_URL + live probe -------------------------------------------------
  let conn: Connection | null = null;
  const rpc = env.RPC_URL || "";
  if (!rpc) {
    red("RPC_URL unset", "must be a paid mainnet endpoint (Helius/QuickNode)");
  } else if (/devnet/i.test(rpc)) {
    red("RPC_URL contains \"devnet\"", rpc.replace(/api-key=[^&]+/i, "api-key=***"));
  } else if (/api\.(mainnet-beta|devnet|testnet)\.solana\.com/i.test(rpc)) {
    red("RPC_URL is a public clusterApiUrl host", "rate-limited, \"not intended for production applications\"");
  } else {
    try {
      const probe = new Connection(rpc, "confirmed");
      const genesis = await probe.getGenesisHash();
      if (genesis !== MAINNET_GENESIS) {
        red("RPC genesis hash mismatch", `got ${genesis} — this endpoint is NOT mainnet-beta`);
      } else {
        const epoch = await probe.getEpochInfo();
        green("RPC_URL live probe", `mainnet-beta genesis ok · epoch ${epoch.epoch}, slot ${epoch.absoluteSlot}`);
        conn = probe;
      }
    } catch (err) {
      red("RPC_URL probe failed", (err as Error).message);
    }
  }

  // ---- 4. USDC mint on that RPC --------------------------------------------------
  if (!conn) {
    red("USDC mint check skipped", "no working mainnet RPC (fix check 3 first)");
  } else {
    try {
      const mint = await getMint(conn, new PublicKey(MAINNET_USDC));
      if (mint.decimals === 6 && mint.isInitialized) {
        green("USDC mint EPjFWdd5…TDt1v", `initialized, decimals 6, supply ${mint.supply}`);
      } else {
        red("USDC mint parsed but looks wrong", `decimals ${mint.decimals}, initialized ${mint.isInitialized}`);
      }
    } catch (err) {
      red("USDC mint unreadable on this RPC", (err as Error).message);
    }
  }

  // ---- 5. COLLECTOR_WALLET ---------------------------------------------------------
  const collector = env.COLLECTOR_WALLET || "";
  let collectorPk: PublicKey | null = null;
  if (!collector) {
    red("COLLECTOR_WALLET unset");
  } else if (collector === SYSTEM_PROGRAM) {
    red("COLLECTOR_WALLET is the system program placeholder", "money sent there is unspendable");
  } else {
    try {
      collectorPk = new PublicKey(collector);
      green("COLLECTOR_WALLET parses as base58", `${collector.slice(0, 6)}…${collector.slice(-6)}`);
    } catch {
      red("COLLECTOR_WALLET is not a valid base58 pubkey", collector);
    }
  }
  if (collectorPk && conn) {
    try {
      const info = await conn.getAccountInfo(collectorPk);
      if (!info) yellow("collector wallet has no on-chain account yet (0 lamports)", "fund it with a little SOL before launch");
      else green("collector wallet exists on-chain", `${info.lamports} lamports`);
      const ata = await getAssociatedTokenAddress(new PublicKey(MAINNET_USDC), collectorPk);
      const ataInfo = await conn.getAccountInfo(ata);
      if (ataInfo) {
        green("collector USDC ATA exists", ata.toBase58());
      } else {
        red(
          "collector USDC ATA missing",
          `first inbound payment may fail. Pre-create it:  spl-token create-account ${MAINNET_USDC} --owner ${collector} --fee-payer <FUNDED_KEYPAIR.json> --url mainnet-beta`
        );
      }
    } catch (err) {
      red("collector on-chain checks failed", (err as Error).message);
    }
  } else if (collectorPk) {
    red("collector on-chain checks skipped", "no working mainnet RPC");
  }

  // ---- 6. MoonPay / rails ------------------------------------------------------------
  const mp = env.MOONPAY_API_KEY;
  if (mp) {
    const live = mp.startsWith("pk_live_");
    const host = `https://buy${!live ? "-sandbox" : ""}.moonpay.com`; // mirrors onramp.ts#moonpayHost
    if (!live) {
      red("MOONPAY_API_KEY is not a pk_live_ key", `derived widget host would be ${host} (SANDBOX — users \"add money\" and nothing arrives)`);
    } else if (!env.MOONPAY_SECRET_KEY) {
      red("MOONPAY_SECRET_KEY missing", "MoonPay requires HMAC-signed URLs in production — the live widget will reject requests");
    } else {
      green("MoonPay live keys", `pk_live_ + secret present · widget host ${host}`);
    }
  } else if (env.RAILS_REQUIRE_LIVE === "1") {
    red("rails dark but RAILS_REQUIRE_LIVE=1", "boot will refuse; set live keys or unset RAILS_REQUIRE_LIVE");
  } else {
    green("MoonPay unset — rails dark", "add-money/cash-out degrade to the \"coming soon\" UI");
  }
  if (env.COINBASE_ONRAMP_APP_ID) {
    if (/PLACEHOLDER/i.test(env.COINBASE_ONRAMP_APP_ID)) yellow("COINBASE_ONRAMP_APP_ID is a placeholder", "unset it");
    else green("Coinbase Onramp app id present");
  }

  // ---- 7. Supabase backend + stale devnet-era money -----------------------------------
  if ((env.DATA_BACKEND || "sqlite").toLowerCase() !== "supabase") {
    red("DATA_BACKEND is not supabase", "SQLite is ephemeral on Railway — money data would vanish on redeploy");
  } else if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    red("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY incomplete");
  } else {
    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Live read of the double-credit guard table (the one table that MUST work).
    const { error: csErr } = await sb.from("consumed_signatures").select("signature").limit(1);
    if (csErr) red("consumed_signatures not readable", csErr.message);
    else green("supabase reachable · consumed_signatures readable");

    // Stale-data scan: open devnet-era money that would surface as real asks.
    try {
      let devnetBillsOpen = 0;
      const { data: bills, error: bErr } = await sb.from("bills").select("data").limit(5000);
      if (bErr) throw new Error(`bills: ${bErr.message}`);
      for (const row of bills || []) {
        const d = typeof (row as any).data === "string" ? JSON.parse((row as any).data) : (row as any).data;
        if (!d || d.cluster === "mainnet-beta") continue;
        if (Array.isArray(d.participants) && d.participants.some((p: any) => !p.paid)) devnetBillsOpen++;
      }

      const { data: trips, error: tErr } = await sb.from("trips").select("id, cluster").limit(5000);
      if (tErr) throw new Error(`trips: ${tErr.message}`);
      const devnetTrips = new Set((trips || []).filter((t: any) => t.cluster !== "mainnet-beta").map((t: any) => t.id));
      let devnetLegsOpen = 0;
      const { data: setts, error: sErr } = await sb.from("settlements").select("trip_id, transfers").limit(5000);
      if (sErr) throw new Error(`settlements: ${sErr.message}`);
      for (const s of setts || []) {
        if (!devnetTrips.has((s as any).trip_id)) continue;
        const transfers = (s as any).transfers || [];
        devnetLegsOpen += (Array.isArray(transfers) ? transfers : []).filter((t: any) => t.url && !t.paid).length;
      }

      const { count: tabOpen, error: tabErr } = await sb
        .from("tab_settlements")
        .select("id", { count: "exact", head: true })
        .in("status", ["open", "open_partial"])
        .or("cluster.is.null,cluster.eq.devnet");
      if (tabErr) throw new Error(`tab_settlements: ${tabErr.message}`);

      const { count: iouOpen, error: iErr } = await sb
        .from("ious")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .or("cluster.is.null,cluster.eq.devnet");
      if (iErr) throw new Error(`ious: ${iErr.message}`);

      const total = devnetBillsOpen + devnetLegsOpen + (tabOpen || 0) + (iouOpen || 0);
      if (total > 0) {
        red(
          "open devnet-era money found",
          `${devnetBillsOpen} unpaid bill shares · ${devnetLegsOpen} unpaid trip settle legs · ` +
            `${tabOpen || 0} open tab settlements · ${iouOpen || 0} open IOUs — the B4/H1 code refuses them, ` +
            `but decide the data story (fresh project / truncate) per docs/GO-LIVE.md`
        );
      } else {
        green("no open devnet-era money in the database");
      }
    } catch (err) {
      red("stale-data scan failed", (err as Error).message);
    }
  }

  // ---- 8. secrets ---------------------------------------------------------------------
  if ((env.SESSION_SECRET || "").length >= 32) green("SESSION_SECRET set (≥32 chars)");
  else red("SESSION_SECRET missing or shorter than 32 chars", "mint a FRESH one for mainnet (rotating invalidates devnet sessions — good)");
  if (env.PRIVY_APP_ID && env.PRIVY_APP_SECRET) green("PRIVY_APP_ID + PRIVY_APP_SECRET set");
  else red("PRIVY_APP_ID / PRIVY_APP_SECRET incomplete", "sign-up is dead without both");

  // ---- 9. ops niceties (warn-only) -------------------------------------------------------
  for (const [key, why] of [
    ["ALERT_WEBHOOK_URL", "money-path anomaly alerts have nowhere to go"],
    ["ALERT_WEBHOOK", "client error-rate alerts have nowhere to go"],
    ["ADMIN_TOKEN", "/api/telemetry/recent read-back disabled"],
  ] as const) {
    if (env[key]) green(`${key} set`);
    else yellow(`${key} unset`, why);
  }
  if (PING_WEBHOOKS) {
    for (const key of ["ALERT_WEBHOOK_URL", "ALERT_WEBHOOK"] as const) {
      const url = env[key];
      if (!url) continue;
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: `divvy mainnet-preflight ping (${new Date().toISOString()})` }),
        });
        if (r.ok) green(`${key} ping delivered`, `HTTP ${r.status}`);
        else yellow(`${key} ping got HTTP ${r.status}`);
      } catch (err) {
        yellow(`${key} ping failed`, (err as Error).message);
      }
    }
  }

  // ---- 10. caps ---------------------------------------------------------------------------
  const railCents = Number(env.RAIL_MAX_CENTS || 200_000);
  const ledgerCents = Number(env.LEDGER_MAX_CENTS || 100_000_000);
  const caps = `RAIL_MAX_CENTS=$${(railCents / 100).toLocaleString()} · LEDGER_MAX_CENTS=$${(ledgerCents / 100).toLocaleString()}`;
  if (!Number.isInteger(railCents) || railCents < 1) red("RAIL_MAX_CENTS invalid", String(env.RAIL_MAX_CENTS));
  else if (railCents > 500_000 && !ALLOW_HIGH_CAPS) red("rail cap above $5,000 for launch", `${caps} — pass --allow-high-caps to accept deliberately`);
  else green("caps", caps);
  if (!Number.isInteger(ledgerCents) || ledgerCents < 100) red("LEDGER_MAX_CENTS invalid", String(env.LEDGER_MAX_CENTS));

  // ---- 11. built client bundles free of devnet wiring ---------------------------------------
  try {
    const embHtml = fs.readFileSync(path.resolve(process.cwd(), "public/embedded/index.html"), "utf8");
    const m = embHtml.match(/src="(\/embedded\/assets\/index-[^"]+\.js)"/);
    if (!m) {
      red("embedded bundle not found in public/embedded/index.html");
    } else {
      const bundle = fs.readFileSync(path.resolve(process.cwd(), "public" + m[1]), "utf8");
      const stale: string[] = [];
      if (bundle.includes("devnet test funds")) stale.push('"devnet test funds"');
      if (bundle.includes("USDC on devnet")) stale.push('"USDC on devnet"');
      if (stale.length) {
        red("embedded bundle carries stale devnet copy", `${stale.join(", ")} in ${m[1]} — rebuild with npm run build:web and commit`);
      } else {
        green("embedded bundle free of hardcoded devnet copy", m[1]);
      }
      if (bundle.includes("/api/me/fund")) {
        // Expected: SettlePay keeps the DEVNET faucet path behind a cluster
        // check (fetch /api/auth/config). Only worth a look, not a stop.
        yellow("embedded bundle references /api/me/fund", "expected — the faucet call is cluster-gated (devnet only); verify SettlePay gates on cluster");
      } else {
        green("embedded bundle has no faucet reference");
      }
    }
    const screensDir = path.resolve(process.cwd(), "public/screens");
    const offenders: string[] = [];
    for (const f of fs.readdirSync(screensDir)) {
      if (!f.endsWith(".js")) continue;
      if (fs.readFileSync(path.join(screensDir, f), "utf8").includes("?cluster=devnet")) offenders.push(f);
    }
    if (offenders.length) red("hardcoded ?cluster=devnet in screens", offenders.join(", "));
    else green("public/screens/*.js free of hardcoded ?cluster=devnet");
  } catch (err) {
    red("client bundle scan failed", (err as Error).message);
  }

  // ---- 12. replicate the boot gate (assertMainnetReadiness) ----------------------------------
  const refusals: string[] = [];
  if (cluster !== "mainnet-beta" && !/^mainnet(-beta)?$/i.test(cluster)) refusals.push("CLUSTER invalid (boot dies at import)");
  if (!env.RPC_URL) refusals.push("RPC_URL unset");
  if (!env.SESSION_SECRET) refusals.push("SESSION_SECRET unset");
  if ((env.DATA_BACKEND || "sqlite").toLowerCase() !== "supabase") refusals.push("DATA_BACKEND != supabase");
  if (!env.COLLECTOR_WALLET || env.COLLECTOR_WALLET === SYSTEM_PROGRAM) refusals.push("COLLECTOR_WALLET unset/placeholder");
  if (env.MINT_AUTHORITY_SECRET) refusals.push("MINT_AUTHORITY_SECRET present");
  if (env.TEST_USDC_MINT) refusals.push("TEST_USDC_MINT present");
  if (env.CONSUMED_SIG_FAIL_OPEN === "1") refusals.push("CONSUMED_SIG_FAIL_OPEN=1");
  if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) refusals.push("PRIVY_APP_ID/PRIVY_APP_SECRET incomplete");
  if (env.MOONPAY_API_KEY && !/PLACEHOLDER/i.test(env.MOONPAY_API_KEY) && !env.MOONPAY_API_KEY.startsWith("pk_live_")) {
    refusals.push("MOONPAY_API_KEY is a test key");
  }
  if (env.MOONPAY_API_KEY && !env.MOONPAY_SECRET_KEY) refusals.push("MOONPAY_SECRET_KEY missing");
  if (env.RAILS_REQUIRE_LIVE === "1" && !railsLiveOnMainnet()) refusals.push("RAILS_REQUIRE_LIVE=1 but rails not live");
  if (refusals.length) {
    red("boot gate (assertMainnetReadiness) WOULD REFUSE", refusals.join(" · "));
  } else {
    green("boot gate (assertMainnetReadiness) would pass");
  }

  // ---- verdict ---------------------------------------------------------------------------------
  console.log("");
  if (reds > 0) {
    console.log(`${RED}NO-GO: ${reds} red${reds === 1 ? "" : "s"}, ${yellows} yellow${yellows === 1 ? "" : "s"}.${RESET}\n`);
    process.exit(1);
  }
  console.log(`${GREEN}GO: all checks green${yellows ? ` (${yellows} yellow warning${yellows === 1 ? "" : "s"} — read them)` : ""}.${RESET}\n`);
}

main().catch((err) => {
  console.error(`${RED}preflight crashed:${RESET}`, err);
  process.exit(1);
});

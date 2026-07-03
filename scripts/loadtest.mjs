#!/usr/bin/env node
/**
 * scripts/loadtest.mjs — dependency-free load test for the Divvy web server.
 *
 * Fires a fixed number of concurrent "virtual users" for a wall-clock duration,
 * each looping a mix of GET requests against a *running* local server, reusing a
 * keep-alive agent (so we measure the app, not TCP/TLS setup). Reports req/s and
 * latency percentiles (p50/p95/p99) plus a status-code histogram.
 *
 * No npm deps — raw node:http with an Agent that pins keepAlive on.
 *
 * Usage:
 *   node scripts/loadtest.mjs [--base http://127.0.0.1:3082] [--conc 50]
 *                             [--dur 20] [--token <shareToken>]
 *
 * The mix (per iteration, weighted):
 *   GET /                    app shell (static index.html)
 *   GET /api/auth/config     cheap JSON endpoint
 *   GET /t/<token>           OG-injected share page (store-backed) when --token given,
 *                            else GET / again.
 */

import http from "node:http";
import { performance } from "node:perf_hooks";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const BASE = arg("base", "http://127.0.0.1:3082");
const CONC = Number(arg("conc", "50"));
const DUR_S = Number(arg("dur", "20"));
const TOKEN = arg("token", "");

const { hostname, port } = new URL(BASE);
const agent = new http.Agent({ keepAlive: true, maxSockets: CONC, maxFreeSockets: CONC });

// Weighted request plan. Share page only if we were handed a token.
const PLAN = TOKEN
  ? ["/", "/", "/api/auth/config", `/t/${TOKEN}`]
  : ["/", "/", "/api/auth/config", "/"];

function once(path) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const req = http.request(
      { hostname, port, path, method: "GET", agent, headers: { "accept-encoding": "gzip" } },
      (res) => {
        let n = 0;
        res.on("data", (c) => (n += c.length));
        res.on("end", () => resolve({ ms: performance.now() - t0, status: res.statusCode, bytes: n }));
      }
    );
    req.on("error", () => resolve({ ms: performance.now() - t0, status: 0, bytes: 0 }));
    req.end();
  });
}

async function vu(deadline, out) {
  let i = 0;
  while (performance.now() < deadline) {
    const path = PLAN[i++ % PLAN.length];
    const r = await once(path);
    out.lat.push(r.ms);
    out.status[r.status] = (out.status[r.status] || 0) + 1;
    out.bytes += r.bytes;
  }
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const out = { lat: [], status: {}, bytes: 0 };
  const start = performance.now();
  const deadline = start + DUR_S * 1000;
  await Promise.all(Array.from({ length: CONC }, () => vu(deadline, out)));
  const elapsed = (performance.now() - start) / 1000;

  const sorted = out.lat.slice().sort((a, b) => a - b);
  const total = sorted.length;
  const rps = total / elapsed;
  const mean = sorted.reduce((a, b) => a + b, 0) / (total || 1);

  console.log(`\n── loadtest ${BASE}  (conc=${CONC}, dur=${DUR_S}s, plan=[${PLAN.join(" ")}]) ──`);
  console.log(`requests      : ${total}`);
  console.log(`elapsed       : ${elapsed.toFixed(2)}s`);
  console.log(`throughput    : ${rps.toFixed(1)} req/s`);
  console.log(`bytes recv'd  : ${(out.bytes / 1e6).toFixed(2)} MB`);
  console.log(`latency mean  : ${mean.toFixed(2)} ms`);
  console.log(`latency p50   : ${pct(sorted, 50).toFixed(2)} ms`);
  console.log(`latency p95   : ${pct(sorted, 95).toFixed(2)} ms`);
  console.log(`latency p99   : ${pct(sorted, 99).toFixed(2)} ms`);
  console.log(`latency max   : ${sorted[sorted.length - 1]?.toFixed(2) || 0} ms`);
  console.log(`status codes  : ${JSON.stringify(out.status)}`);
}

main();

# Divvy — Backups & Recovery Runbook

Divvy moves real money (USDC on Solana), so the datastore must be recoverable.
This is the operational runbook for both backends selected by `DATA_BACKEND`:
`sqlite` (a local file) and `supabase` (hosted Postgres). Read the custody
section at the bottom first — it decides how bad a data loss actually is.

Scope note: the database holds **app metadata** (trips, bills, expenses,
settlement plans, friends, referrals, push subscriptions, consumed on-chain
signatures). It does **not** hold funds or private keys — see "Custody & what
losing the DB means" below.

---

## Mode A — SQLite (`DATA_BACKEND=sqlite`, default)

The DB is a single file at `DB_PATH` (default `./divvy.db`), opened in **WAL**
mode (`src/db.ts`). WAL means there are also `divvy.db-wal` and `divvy.db-shm`
sidecar files with uncheckpointed writes — **never** copy `divvy.db` alone with
`cp`; you can capture a torn, missing-the-last-writes snapshot.

### Railway reality: the filesystem is ephemeral
Railway containers have an **ephemeral** filesystem. Without a mounted Volume,
`divvy.db` is wiped on every redeploy/restart (see `DEPLOY.md` appendix). SQLite
mode is only durable if a **Volume** is mounted at `/data` with
`DB_PATH=/data/divvy.db`, and even then it is **single-instance** and lives or
dies with that one volume — no off-box copy. For anything beyond dev/demo, use
Supabase (the mainnet boot guard in `src/server.ts` already refuses SQLite).

### Backup command (safe under WAL)
Use SQLite's online `.backup` — it takes a consistent snapshot across the main
file + WAL without stopping the server:
```bash
sqlite3 /data/divvy.db ".backup '/tmp/divvy-$(date +%Y%m%d-%H%M%S).db'"
# then ship it off-box (S3/R2/etc.), e.g.:
gzip /tmp/divvy-*.db && aws s3 cp /tmp/divvy-*.db.gz s3://divvy-backups/sqlite/
```
`.backup` is safe under concurrent writes; a plain `cp` is not.

### Suggested cron / GitHub Action pattern
Run it on a schedule from a box that can reach the volume (or a Railway cron
service sharing the volume):
```yaml
# .github/workflows/*.yml is OUT OF SCOPE for this repo change — create it
# manually. Pattern only:
on:
  schedule: [{ cron: "0 */6 * * *" }]   # every 6h
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - run: sqlite3 "$DB_PATH" ".backup '/tmp/divvy.db'"
      - run: gzip /tmp/divvy.db && <upload to object storage with a 30-day lifecycle>
```
Keep ~30 days, rotate off oldest. Store snapshots in a **different** account/region
than the app.

### Restore steps
1. Stop the service (or put it in maintenance) so nothing writes mid-restore.
2. Fetch + decompress the snapshot: `gunzip divvy-YYYYmmdd-HHMMSS.db.gz`.
3. Replace the live file and **delete stale WAL sidecars** so they don't
   shadow the restored data:
   ```bash
   cp divvy-YYYYmmdd-HHMMSS.db /data/divvy.db
   rm -f /data/divvy.db-wal /data/divvy.db-shm
   ```
4. Integrity check before booting: `sqlite3 /data/divvy.db "PRAGMA integrity_check;"`
   → expect `ok`.
5. Start the service; hit `/healthz` (expects `{ ok: true, backend: "sqlite" }`).

---

## Mode B — Supabase / Postgres (`DATA_BACKEND=supabase`, recommended for prod)

Managed Postgres. Automated backup/PITR configuration lives in the **Supabase
dashboard** and **cannot be set from this repo** — there is no backup config in
the codebase to change; it is a project-level setting.

### Plan tiers (verify current values in the dashboard — pricing changes)
- **Free**: no dashboard-restorable managed backups and **no PITR**. Rely on your
  own `pg_dump` (below).
- **Pro**: **daily** logical backups with ~7-day retention.
- **PITR** (Point-In-Time Recovery, second-granularity restore) is a **paid
  add-on** on Pro and above — enable it explicitly; it is not on by default.

### Verify it's actually on (exact dashboard path)
`Supabase dashboard → your project → Database → Backups`. Confirm you see recent
daily backups and, if you paid for it, that **PITR** shows an active retention
window. Screenshot it into your ops log each quarter.

### Manual snapshot with pg_dump
Get the connection string from `Project → Settings → Database → Connection string`
(URI form). Then:
```bash
pg_dump "postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" \
  --no-owner --no-privileges -Fc -f divvy-$(date +%Y%m%d-%H%M%S).dump
```
`-Fc` (custom format) restores with `pg_restore`. Ship it off-box like the SQLite
snapshot. The server uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (see
`src/supabase.ts`); `pg_dump` needs the **direct Postgres** connection string,
not the REST URL.

### Recovery drill checklist (do this quarterly — an untested backup is a rumor)
1. Create a **scratch** Postgres (a throwaway Supabase project or local Postgres).
2. Load the schema, then the dump:
   `psql "<scratch-uri>" -f supabase/schema.sql` then
   `pg_restore --no-owner --no-privileges -d "<scratch-uri>" divvy-*.dump`.
3. Point a local app at it: `DATA_BACKEND=supabase SUPABASE_URL=<scratch>
   SUPABASE_SERVICE_ROLE_KEY=<scratch key> npm run web`.
4. Hit `/healthz` (expects `{ ok: true, backend: "supabase" }`).
5. **Verify balances**: sign in as a known user, open a trip, confirm
   `GET /api/me/balances` and the trip's who-owes-who match what production shows.
   Spot-check `consumed_signatures` row count (guards against double-credit).
6. Tear down the scratch project.

---

## RPO / RTO honesty table

RPO = worst-case data lost. RTO = time to be back up. These assume the backup
*exists and was tested* — untested backups have infinite RTO.

| Mode | Config | RPO (data at risk) | RTO (restore time) |
|------|--------|--------------------|--------------------|
| SQLite, no Volume | default on Railway | **everything since last deploy** — resets every redeploy | n/a (data gone) |
| SQLite + Volume, cron `.backup` every 6h | single-instance | up to **6h** of writes | ~15–30 min (fetch + swap file) |
| Supabase Free + own `pg_dump` daily | manual | up to **24h** | ~30–60 min (restore to scratch, cut over) |
| Supabase Pro, daily backups | managed | up to **24h** | ~30–60 min (dashboard restore) |
| Supabase Pro + PITR | managed | **seconds–minutes** | ~30–60 min (dashboard PITR restore) |

For a money app, target **Supabase Pro + PITR** before mainnet.

---

## What is NOT backed up

### Environment secrets (live in Railway → service → Variables, NOT in any dump)
Restoring the DB does not restore config. Keep these in a secrets manager /
password vault; re-enter on a fresh deploy:
- `SESSION_SECRET` — signs auth sessions. **If lost, every session is invalidated**
  (users must re-sign-in). If *leaked*, anyone can forge sessions — rotate.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — DB access (service_role bypasses
  RLS; never ship to the browser).
- `RPC_URL` — paid Solana RPC (Helius) endpoint/key.
- `COLLECTOR_WALLET` — default payout address.
- `MINT_AUTHORITY_SECRET`, `TEST_USDC_MINT` — **devnet faucet key** (see custody).
- `PRIVY_APP_ID` / `PRIVY_APP_SECRET`, `VAPID_*`, APNs keys, `MOONPAY_*`,
  `ALERT_WEBHOOK_URL` — third-party integrations.

### Custody & what losing the DB means for funds
Read `src/auth.ts` / `src/users.ts`: **the server holds no user private key
material.** It stores wallet *addresses* only. User funds live on-chain in wallets
the server does not control:
- **Embedded wallets** are custodied by **Privy** (their infra holds the keys, not
  Divvy).
- **External wallets** are self-custodied; ownership is proven per-session via
  SIWS (ed25519 signature over a nonce), never by the server storing a key.

Therefore **losing the database does not lose anyone's money.** What you lose is
*metadata*: who owed whom, trip/bill history, settlement plans, friends,
referrals, push subscriptions, and the `consumed_signatures` dedup ledger. The
one operational risk from losing `consumed_signatures`: the guard that "one
on-chain payment settles at most one share" resets, so a previously-used
signature could theoretically be re-presented — a reason to prioritize its
recovery, not a loss of custody.

The **only** private key the server ever holds is `MINT_AUTHORITY_SECRET`, the
**devnet-only** test-USDC faucet (`src/funding.ts`). It is not user funds, and the
mainnet boot guard requires it to be **removed** before going live. Back it up
like any secret (vault), never in the DB.

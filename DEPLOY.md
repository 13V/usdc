# Deploying Divvy to Railway

Divvy is a single Node/Express service that serves both the API and the web app
on one port. This guide gets it live on [Railway](https://railway.app).

> **Data backend:** the app supports two, chosen by `DATA_BACKEND`:
> - **`supabase`** (recommended for prod) — hosted Postgres. Durable, backed up,
>   multi-instance, no volume needed. Apply the schema once (step 2) and set the
>   Supabase env vars (step 3).
> - **`sqlite`** (default) — a local file via `better-sqlite3`. For persistence on
>   Railway you must mount a **Volume** and point `DB_PATH` at it; without the
>   volume, data resets on every redeploy.
>
> The two are mutually exclusive — pick one. The steps below cover **Supabase**;
> the SQLite volume path is in the appendix at the bottom.

## 1. Connect the repo
1. Go to **railway.app → New Project → Deploy from GitHub repo**.
2. Pick **`13v/usdc`**, branch **`claude/divvy-repo-setup-61epmw`**.
3. Railway reads `railway.json` automatically:
   - build: `npm install` (auto) + `npm run build`
   - start: `node dist/src/server.js`
   - health check: `/api/auth/config`

## 2. Apply the database schema (once)
In **Supabase → SQL Editor**, paste the entire contents of
[`supabase/schema.sql`](supabase/schema.sql) and **Run**. It is idempotent (safe
to re-run) and creates all tables + the additive column patches. Verify with:
```bash
DATA_BACKEND=supabase npx ts-node scripts/supabase-health.ts
```
You should see every table `✓` and "Supabase is ready."

## 3. Set environment variables
Service → **Variables** tab. Add:

| Variable          | Value                                   | Why |
|-------------------|-----------------------------------------|-----|
| `DATA_BACKEND`    | `supabase`                              | use the hosted Postgres backend |
| `SUPABASE_URL`    | `https://<ref>.supabase.co`             | your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | *(service_role JWT)*          | server-side key (bypasses RLS — never ship to the browser) |
| `SESSION_SECRET`  | *(generate — see below)*                | signs auth sessions (required; app refuses to boot in production without it) |
| `NODE_ENV`        | `production`                            | enables the SESSION_SECRET guard + prod behavior |
| `CLUSTER`         | `devnet`                                | Solana cluster (never mainnet without review) |
| `COLLECTOR_WALLET`| *(your Phantom **devnet** address)*     | the Solana Pay recipient for settles |
| `ANTHROPIC_API_KEY` | *(optional)*                          | enables receipt-photo scanning |

With `DATA_BACKEND=supabase` you do **not** need a Railway Volume or `DB_PATH`.

**Do NOT set `PORT`** — Railway injects it and the server reads it.

Generate a session secret locally:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 4. Get a public URL
Service → **Settings → Networking → Generate Domain** → you get
`https://<name>.up.railway.app`. That's the live app.

## 5. Use it
Open the URL → **create a wallet** → create a group → add a tab → settle.
To move real (devnet) money: in Phantom switch to Devnet, fund the wallet with
devnet SOL (faucet.solana.com) + devnet USDC, then **settle up** and scan the QR.

---

### Appendix — SQLite + Volume (alternative to Supabase)
To run on the local-file backend instead, skip steps 2–3's Supabase vars and use:
1. **Volume:** service → Settings → Volumes → New Volume, mount path **`/data`**.
2. **Variables:** set `DATA_BACKEND=sqlite` (or omit — it's the default) and
   `DB_PATH=/data/divvy.db`; keep `SESSION_SECRET`, `NODE_ENV`, `CLUSTER`,
   `COLLECTOR_WALLET`. Do **not** set the Supabase vars.

Single-instance only, and data lives or dies with the volume.

### Troubleshooting
- **Native build fails on `better-sqlite3`:** Nixpacks normally pulls prebuilt
  binaries. If it tries to compile and fails, add a `nixpacks.toml` with
  `[phases.setup] nixPkgs = ["nodejs", "python3", "gcc", "gnumake"]`.
- **Supabase: "relation does not exist" / missing-column errors:** re-run
  `supabase/schema.sql` in the SQL Editor (it's idempotent and includes the
  additive column patches), then re-run `scripts/supabase-health.ts`.
- **SQLite: app boots but data resets:** the Volume isn't mounted at `/data` or
  `DB_PATH` isn't `/data/divvy.db`.
- **Mainnet later:** never point `CLUSTER` at `mainnet-beta` without a security
  review.

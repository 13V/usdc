# Deploying Divvy to Railway

Divvy is a single Node/Express service that serves both the API and the web app
on one port. This guide gets it live on [Railway](https://railway.app).

> **Data note:** the app currently stores everything in a local **SQLite** file
> (`better-sqlite3`). Supabase is configured but not yet the live data path, so
> for persistence on Railway you mount a **Volume** and point `DB_PATH` at it
> (step 4). Without the volume, data resets on every redeploy.

## 1. Connect the repo
1. Go to **railway.app → New Project → Deploy from GitHub repo**.
2. Pick **`13v/usdc`**, branch **`claude/divvy-repo-setup-61epmw`**.
3. Railway reads `railway.json` automatically:
   - build: `npm install` (auto) + `npm run build`
   - start: `node dist/src/server.js`
   - health check: `/api/auth/config`

## 2. Add a persistent Volume (so data survives redeploys)
In the service → **Settings → Volumes → New Volume**, mount path: **`/data`**.

## 3. Set environment variables
Service → **Variables** tab. Add:

| Variable          | Value                                   | Why |
|-------------------|-----------------------------------------|-----|
| `DB_PATH`         | `/data/divvy.db`                        | puts SQLite on the persistent volume |
| `SESSION_SECRET`  | *(generate — see below)*                | signs auth sessions (required; app refuses to boot in production without it) |
| `NODE_ENV`        | `production`                            | enables the SESSION_SECRET guard + prod behavior |
| `CLUSTER`         | `devnet`                                | Solana cluster (never mainnet without review) |
| `COLLECTOR_WALLET`| *(your Phantom **devnet** address)*     | the Solana Pay recipient for settles |
| `ANTHROPIC_API_KEY` | *(optional)*                          | enables receipt-photo scanning |

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

### Troubleshooting
- **Native build fails on `better-sqlite3`:** Nixpacks normally pulls prebuilt
  binaries. If it tries to compile and fails, add a `nixpacks.toml` with
  `[phases.setup] nixPkgs = ["nodejs", "python3", "gcc", "gnumake"]`.
- **App boots but data resets:** the Volume isn't mounted at `/data` or
  `DB_PATH` isn't `/data/divvy.db`.
- **Switching to always-on / mainnet later:** wire Supabase as the real data
  backend first (the routers currently use SQLite directly), and never point
  `CLUSTER` at `mainnet-beta` without a security review.

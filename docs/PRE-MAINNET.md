# Pre-mainnet hardening & checklist

Divvy currently runs on **Solana devnet** with **test-USDC** (freely minted, no
real value). Nothing in this app should touch real money until the items below
are closed. This file tracks that state honestly — it is not a claim that the
app is "safe"; it is the list of what must be true before it can be.

## Status of the 5 pre-mainnet items

| # | Item | Status |
|---|------|--------|
| 1 | Third-party security audit | ❌ Not done — **required** before mainnet. Internal sweeps ≠ an audit. |
| 2 | Payment-verification hardening | ⚠️ Substantially done (see below); one belt-and-suspenders piece deferred |
| 3 | RPC key out of the client bundle | ✅ Done — client uses the same-origin `/api/rpc` proxy; key lives in `RPC_URL` server-side |
| 4 | Custody / recovery decision | ⏳ Documented below — **product decision still required** |
| 5 | Monitoring + rate limits on money endpoints | ✅ Done — per-IP caps + structured `money` audit log |

## 2. Payment verification — what's in place

`src/verify.ts` + the two verify loops (`/api/bills/:id/verify`,
`/api/trips/:id/settle/verify`):

- A payment is marked PAID only when an on-chain transfer matches **token mint +
  exact amount + collector ATA** at **finalized** commitment.
- **Signature uniqueness**: one on-chain signature can settle **at most one**
  share (across a verify pass and across repeated calls, via the persisted
  signature). This closes the multi-credit vector — a single transfer can't mark
  several equal-amount participants paid.
- **Reference binding**: the matched transaction must carry the participant's
  reference pubkey in its account keys.
- **Zero-amount guard**: a 0-base-unit transfer never counts as proof.

**Deferred (mainnet):** binding the reference to the *specific* transfer
instruction (not just the transaction) requires raw-instruction parsing and must
be validated against live on-chain fixtures before shipping — rushing it risks
false negatives that strand real payments. The signature-uniqueness guard
already closes the fund-loss path, so this is defense-in-depth.

## 4. Custody / recovery — decision required

**Current model:** Privy embedded Solana wallets, self-custodial, auto-created on
login (`createOnLogin: "users-without-wallets"`). Auth methods: email, Google,
Apple, SMS. There is **no seed phrase** the user manages; key material is held by
Privy's infrastructure and reconstructed when the user re-authenticates.

**Implication:** account recovery == regaining access to the login method
(email/phone/OAuth). If a user permanently loses that, recovery depends entirely
on Privy. There is currently **no user-held backup** and **no key export**.

**Decisions to make before mainnet:**
1. Offer **key export** (Privy supports it) so users aren't locked to Privy.
2. Decide whether to require a **user-controlled recovery factor** (passkey /
   password) for stronger self-custody guarantees.
3. Write the **"I lost my login" support path** explicitly.
4. Confirm Privy's custody terms are acceptable for the amounts you'll allow.

## Also before mainnet

- **Rotate** any RPC/keys that ever shipped in a client bundle (the prior
  devnet Helius key was bundled before #3; treat it as exposed and rotate when
  moving to a paid mainnet RPC).
- Move `RPC_URL` to a **mainnet** paid RPC; keep it server-side (already proxied).
- Set hard **per-user amount caps** and review the rate limits under real load.
- Replace the devnet **funding faucet** (`/api/me/fund`, `src/funding.ts`) — it
  mints test-USDC and must be removed/disabled on mainnet.
- Add alerting on the `money` audit log (failed verifies, unusual volume).

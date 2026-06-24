# Divvy Mobile (Expo / React Native)

A native iOS/Android client for Divvy that reuses the same REST API as the web
app. Sign up by **creating a Solana wallet on-device** (stored in the OS secure
keychain via `expo-secure-store`), add friends, start groups, and use the
**group chat + receipt feed** — all settling in USDC on Solana.

> **Status:** scaffold. The structure, API client, on-device wallet/auth, and
> screens are complete and idiomatic, but this hasn't been run on a device yet —
> stand up the API server, set the URL, and `expo start`.

## Run it

```bash
cd mobile
npm install
npx expo install --fix     # aligns native module versions to the Expo SDK

# Point the app at your running Divvy API server (the repo root app).
# On a phone, localhost = the phone, so use your computer's LAN IP:
cp .env.example .env        # then edit EXPO_PUBLIC_API_URL
#   e.g. EXPO_PUBLIC_API_URL=http://192.168.1.50:3000

# In another terminal, from the repo root, run the API + a devnet RPC:
#   (cd ..  &&  RPC_URL=https://devnet.helius-rpc.com/?api-key=... npm run web)

npx expo start             # scan the QR with Expo Go (iOS/Android)
```

## What's here

| Path | Purpose |
| --- | --- |
| `index.ts` | Loads crypto polyfills (`react-native-get-random-values`, `Buffer`) **before** `@solana/web3.js`, then mounts the app. |
| `src/config.ts` | `API_BASE_URL` (from `EXPO_PUBLIC_API_URL`) + theme colors. |
| `src/api.ts` | Typed fetch client (`Bearer` token, `X-Trip-Token` capability) + response types. |
| `src/wallet.ts` | On-device Solana keypair: generate / import / sign, stored in the secure keychain. |
| `src/auth.tsx` | Auth context — create/import a wallet → SIWS handshake → session token; auto re-sign-in on launch. |
| `src/nav.tsx` | Tiny dependency-free navigator (bottom tabs + a push stack for group/chat). |
| `src/ui.tsx` | Shared dark-theme components (Button, Field, Card, …). |
| `App.tsx` | Auth gate → tabs (Groups / Friends / Balances) → group detail → chat. |
| `src/screens/*` | Sign-in, Groups, Friends, Balances, Group detail (expenses + settle-up), Chat (messages + receipt photos). |

## Auth / wallet model (honest)

Sign-in is **Sign-In-With-Solana**: the on-device keypair signs a server nonce,
and the server (which already verifies SIWS with tweetnacl) issues a session
token. The keypair lives in the OS secure enclave (Keychain/Keystore) — a real
upgrade over the web app's `localStorage`. It's still a **starter self-custody**
model: a production build should add seed backup/recovery and could swap in an
embedded-wallet provider (Privy/Coinbase) or Mobile Wallet Adapter for
connecting an existing Phantom wallet.

## Next steps for a production app

- Mobile Wallet Adapter (connect an existing Phantom/Solflare wallet) alongside
  the create-wallet path.
- Push notifications (Expo push) for new expenses / settle reminders.
- Build & submit via EAS (`eas build`).
- Swap the lightweight `nav.tsx` for `expo-router` if you want deep links / URLs.

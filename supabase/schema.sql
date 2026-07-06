-- Divvy — Supabase/Postgres schema.
--
-- Apply this ONCE in your Supabase project:
--   • Supabase Dashboard → SQL Editor → paste this whole file → Run, OR
--   • set SUPABASE_DB_URL in .env and run:  npx ts-node scripts/apply-schema.ts
--
-- This mirrors the local SQLite schema (src/*.ts) but in Postgres types. All
-- money stays integer cents (bigint). Tables are accessed server-side with the
-- service_role key, which bypasses RLS, so RLS is intentionally left disabled
-- here — the Express API is the only client and it does its own authz.
--
-- Idempotent: safe to re-run.

-- ---- bills (src/store.ts) -------------------------------------------------
create table if not exists bills (
  id          text primary key,
  created_at  text not null,
  data        jsonb not null
);
create index if not exists bills_created_at_idx on bills (created_at desc);

-- ---- saved groups (src/groups.ts) -----------------------------------------
create table if not exists groups (
  id           text primary key,
  name         text not null,
  members      jsonb not null,
  created_at   text not null,
  last_used_at text not null,
  user_id      text
);
alter table groups add column if not exists user_id text;
create index if not exists groups_last_used_idx on groups (last_used_at desc);
create index if not exists groups_user_idx on groups (user_id);

-- ---- trips + members + expenses + settlements (src/trips.ts) ---------------
create table if not exists trips (
  id            text primary key,
  name          text not null,
  share_token   text not null unique,
  cluster       text not null,
  created_at    text not null,
  owner_user_id text
);
-- Group quality-of-life (src/trips.ts): a chosen group emoji + archive flag.
-- Additive: existing rows keep NULL emoji (client falls back to name-derived)
-- and archived = 0.
alter table trips add column if not exists emoji text;
alter table trips add column if not exists archived integer not null default 0;
create index if not exists trips_owner_idx on trips (owner_user_id);
create index if not exists trips_created_at_idx on trips (created_at desc);

create table if not exists trip_members (
  id        text primary key,
  trip_id   text not null references trips(id) on delete cascade,
  name      text not null,
  wallet    text,
  user_id   text,
  emoji     text,
  color     text
);
create index if not exists trip_members_trip_idx on trip_members (trip_id);
create index if not exists trip_members_user_idx on trip_members (user_id);

create table if not exists expenses (
  id            text primary key,
  trip_id       text not null references trips(id) on delete cascade,
  title         text not null,
  amount_cents  bigint not null,
  paid_by       text not null,
  participants  jsonb not null,
  fx            jsonb,
  created_at    text not null,
  voided        integer not null default 0
);
create index if not exists expenses_trip_idx on expenses (trip_id);

create table if not exists settlements (
  trip_id     text primary key references trips(id) on delete cascade,
  signature   text not null,
  transfers   jsonb not null,
  created_at  text not null
);

-- ---- users / identities / wallets (src/users.ts) --------------------------
create table if not exists users (
  id            text primary key,
  handle        text unique,
  display_name  text,
  created_at    text not null,
  emoji         text,
  color         text
);

create table if not exists identities (
  provider  text not null,
  subject   text not null,
  user_id   text not null references users(id) on delete cascade,
  primary key (provider, subject)
);
create index if not exists identities_user_idx on identities (user_id);

create table if not exists user_wallets (
  user_id     text not null references users(id) on delete cascade,
  wallet      text not null,
  is_primary  integer not null default 0,
  primary key (user_id, wallet)
);
create index if not exists user_wallets_wallet_idx on user_wallets (wallet);

-- ---- friendships (src/friends.ts) -----------------------------------------
create table if not exists friendships (
  user_id        text not null references users(id) on delete cascade,
  friend_user_id text not null references users(id) on delete cascade,
  created_at     text not null,
  primary key (user_id, friend_user_id)
);

-- ---- IOUs (src/ious.ts) ----------------------------------------------------
create table if not exists ious (
  id                  text primary key,
  owner_user_id       text not null,
  direction           text not null,
  counterparty_name   text not null,
  counterparty_wallet text,
  amount_cents        bigint not null,
  note                text,
  status              text not null,
  reference           text,
  pay_wallet          text,
  signature           text,
  created_at          text not null
);
create index if not exists ious_owner_idx on ious (owner_user_id);

-- ---- recurring splits (src/recurring.ts) ----------------------------------
create table if not exists recurring (
  id             text primary key,
  owner_user_id  text,
  trip_id        text,
  title          text,
  amount_cents   bigint,
  paid_by        text,
  participants   jsonb,
  interval       text,
  next_due       text,
  created_at     text,
  active         integer default 1,
  paused         integer not null default 0
);
create index if not exists recurring_owner_idx on recurring (owner_user_id);
create index if not exists recurring_due_idx on recurring (next_due);

-- ---- shared subscriptions (src/subscriptions.ts) ---------------------------
create table if not exists subscriptions (
  id              text primary key,
  owner_user_id   text not null,
  trip_id         text not null,
  name            text not null,
  icon            text,
  service         text,
  amount_cents    bigint not null,
  interval        text not null,
  renewal_day     integer not null,
  payer_member_id text not null,
  members         jsonb not null,
  shares          jsonb not null,
  next_renewal    text not null,
  created_at      text not null,
  active          integer not null default 1
);
create index if not exists subscriptions_owner_idx on subscriptions (owner_user_id);
create index if not exists subscriptions_trip_idx on subscriptions (trip_id);
create index if not exists subscriptions_renewal_idx on subscriptions (next_renewal);

create table if not exists subscription_renewals (
  id              text primary key,
  subscription_id text not null,
  amount_cents    bigint not null,
  period          text not null,
  created_at      text not null
);
create index if not exists subscription_renewals_sub_idx on subscription_renewals (subscription_id);

-- ---- trip chat messages (src/chat.ts) -------------------------------------
create table if not exists trip_messages (
  id          text primary key,
  trip_id     text not null references trips(id) on delete cascade,
  user_id     text,
  author      text not null,
  text        text,
  image       text,
  created_at  text not null,
  reactions   text
);
create index if not exists trip_messages_trip_idx on trip_messages (trip_id, created_at);

-- ---- money-card reactions (src/reactions.ts) ------------------------------
create table if not exists trip_reactions (
  trip_id     text not null,
  target      text not null,
  emoji       text not null,
  user_id     text not null,
  created_at  text not null,
  primary key (trip_id, target, emoji, user_id)
);
create index if not exists trip_reactions_trip_idx on trip_reactions (trip_id);

-- ---- telemetry (src/telemetry.ts) -----------------------------------------
-- First-party error + product-analytics ring buffer. Mirrors the SQLite
-- CREATE TABLE in src/telemetry.ts. Privacy by design: no PII, no wallet
-- addresses, no amounts — `uhash` is a sha256 hex slice of the user id (never
-- the id itself), and `detail` is PII-scrubbed server-side before insert. Rows
-- older than 14 days are deleted on insert (application-side ring buffer), so no
-- retention policy is needed here.
create table if not exists telemetry (
  id          text primary key,
  kind        text not null,          -- 'error' | 'event'
  name        text not null,
  detail      text,
  url         text,
  uhash       text,
  created_at  text not null
);
create index if not exists telemetry_created_idx on telemetry (created_at);
create index if not exists telemetry_kind_idx on telemetry (kind);

-- ---- consumed_signatures (src/consumedSignatures.ts) -----------------------
-- Global "one on-chain payment settles one share" ledger. Each confirmed
-- signature can be claimed by exactly one owner (bill:<id>:<ref> or
-- trip:<id>:<from>-><to>); a second, different owner is rejected so a single
-- crafted transfer can't discharge debts across multiple bills/trips.
create table if not exists consumed_signatures (
  signature  text primary key,
  owner      text not null,
  created_at text not null
);

-- ---- auth_handoff_codes (src/auth.ts) ---------------------------------------
-- Single-use, short-TTL (60s) codes for the native OAuth handoff: the iOS
-- shell's system browser completes OAuth, mints a code bound to the signed-in
-- user, and the shell redeems it exactly once (atomic delete…returning) for a
-- session token. Only SHA-256(code) is stored — a leaked row can't be replayed.
create table if not exists auth_handoff_codes (
  code_hash  text primary key,
  user_id    text not null,
  expires_at bigint not null,
  created_at text not null
);

-- ---- nudges (src/nudges.ts) -----------------------------------------------
-- Payment reminders. NON-money: never moves funds. to_user_id is nullable
-- because a nudge can target someone who isn't a reachable Divvy user (then
-- only to_name is stored).
create table if not exists nudges (
  id            text primary key,
  from_user_id  text not null,
  to_user_id    text,
  to_name       text,
  trip_id       text,
  kind          text not null,
  created_at    text not null
);
create index if not exists nudges_to_user_idx on nudges (to_user_id);
create index if not exists nudges_from_user_idx on nudges (from_user_id);

-- ---- push_subscriptions (src/push.ts) -------------------------------------
-- Web Push (VAPID) endpoints + native (APNs/FCM) device tokens per user.
create table if not exists push_subscriptions (
  endpoint   text primary key,
  user_id    text not null,
  p256dh     text,
  auth       text,
  kind       text not null default 'web',
  created_at text not null
);
create index if not exists push_subs_user_idx on push_subscriptions (user_id);

-- ---- push_tokens (src/push.ts) --------------------------------------------
-- Native APNs device tokens, one row per device (token unique). Kept separate
-- from push_subscriptions so the APNs fan-out has a clean dedicated store.
-- Mirrors the SQLite CREATE TABLE in src/push.ts.
create table if not exists push_tokens (
  token      text primary key,
  user_id    text not null,
  platform   text not null default 'ios',
  created_at text not null
);
create index if not exists push_tokens_user_idx on push_tokens (user_id);

-- ---- referrals (src/referrals.ts) -----------------------------------------
-- Invite attribution: who brought whom. One row per invited user (first inviter
-- wins — invited_user_id is UNIQUE). Mirrors the SQLite CREATE TABLE in
-- src/referrals.ts. Separate table from trips; no trips-schema coupling.
create table if not exists referrals (
  id              text primary key,
  inviter_user_id text not null,
  invited_user_id text not null unique,
  created_at      text not null,
  source          text
);
create index if not exists referrals_inviter_idx on referrals (inviter_user_id);

-- ---- settle-outside claims (src/settleOutside.ts) ---------------------------
-- "I paid you in cash" handshakes: a debtor's PENDING claim that only the
-- creditor's confirm turns into a ledger effect (a cash tab entry / a
-- kind='transfer' expense). Pending claims never affect any balance.
create table if not exists outside_claims (
  id               text primary key,
  context          text not null,            -- 'tab' | 'trip'
  trip_id          text,                     -- trip claims only
  from_member_id   text,                     -- trip claims only
  to_member_id     text,                     -- trip claims only
  debtor_user_id   text not null,
  creditor_user_id text not null,
  amount_cents     bigint not null,
  method           text not null,            -- cash | venmo | zelle | other
  note             text,
  status           text not null,            -- pending|confirmed|declined|cancelled|expired
  created_at       text not null,
  expires_at       text not null,
  resolved_at      text
);
create index if not exists outside_claims_trip_idx on outside_claims (trip_id, status);
create index if not exists outside_claims_users_idx on outside_claims (debtor_user_id, creditor_user_id, status);

-- ---- due dates + auto-nudge cadence (src/autonudge.ts) ----------------------
-- The creditor's set-and-forget "mochi collects for me" settings. A config's
-- deterministic id (tab:<creditor>:<debtor> / trip:<tripId>:<creditor>) is the
-- uniqueness constraint; auto_nudge_sends carries per-(config, debtor) at-most-
-- once send state claimed via a CAS update (never nudge twice for one slot).
create table if not exists auto_nudge_configs (
  id               text primary key,
  scope            text not null,            -- 'tab' | 'trip'
  trip_id          text,                     -- trip scope only
  creditor_user_id text not null,
  debtor_user_id   text,                     -- tab scope only
  cadence          text not null,            -- off | gentle | standard | spicy
  due_at           text,                     -- tab "square up by" (trips use trips.due_at)
  created_at       text not null,
  updated_at       text not null
);
create index if not exists auto_nudge_configs_creditor_idx on auto_nudge_configs (creditor_user_id);
create index if not exists auto_nudge_configs_trip_idx on auto_nudge_configs (trip_id);

create table if not exists auto_nudge_sends (
  id             text primary key,           -- <configId>|<debtorUserId>
  config_id      text not null,
  debtor_user_id text not null,
  last_sent_at   text,
  send_count     integer not null default 0
);
create index if not exists auto_nudge_sends_config_idx on auto_nudge_sends (config_id);

-- ---- additive column patches ----------------------------------------------
-- `create table if not exists` above will NOT add columns to a table that
-- already exists, so these idempotent ALTERs bring an older Supabase project up
-- to date. They mirror the SQLite ALTER-TABLE migrations in src/*.ts. Safe to
-- re-run (ADD COLUMN IF NOT EXISTS is a no-op when the column is present).
alter table users         add column if not exists emoji    text;
alter table users         add column if not exists color    text;
alter table trip_members  add column if not exists emoji    text;
alter table trip_members  add column if not exists color    text;
alter table trip_messages add column if not exists reactions text;
alter table recurring     add column if not exists paused   integer not null default 0;
-- settle-outside transfer records (src/trips.ts): NULL = ordinary expense.
alter table expenses      add column if not exists kind     text;
-- due dates (src/trips.ts): group "settle by" + per-expense "pay back by".
alter table trips         add column if not exists due_at   text;
alter table expenses      add column if not exists due_at   text;

-- ---- grants ---------------------------------------------------------------
-- The server talks to Postgres as `service_role` (which also bypasses RLS).
-- Supabase's default privileges usually grant new tables automatically, but a
-- table created in a later migration can miss that — PostgREST then refuses to
-- expose it ("Could not find the table in the schema cache"). Granting
-- explicitly to service_role is idempotent and guarantees the API can reach
-- every table. `notify` forces PostgREST to reload its schema cache now.
grant all on all tables in schema public to service_role;
notify pgrst, 'reload schema';

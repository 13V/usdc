/**
 * api.ts — thin typed client over the Divvy REST API (the same server the web
 * app uses). Bearer token for identity; X-Trip-Token for trip capability.
 */
import { API_BASE_URL } from "./config";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface ApiOpts {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
  tripToken?: string | null;
}

export async function api<T = any>(path: string, opts: ApiOpts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  if (opts.tripToken) headers["x-trip-token"] = opts.tripToken;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && data.error) || res.statusText || "Request failed";
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

// ---- Shared shapes (mirror the server's serialized responses) -------------

export interface User {
  id: string;
  handle: string | null;
  displayName: string | null;
  wallets: string[];
  primaryWallet: string | null;
}

export interface Friend {
  id: string;
  handle: string | null;
  displayName: string | null;
  primaryWallet: string | null;
}

export interface TripMember {
  id: string;
  name: string;
  wallet: string | null;
  userId?: string | null;
  claimed?: boolean;
}

export interface TripExpense {
  id: string;
  title: string;
  amountCents: number;
  amountFmt: string;
  paidBy: string;
  paidByName?: string;
  participants: string[];
  participantNames?: string[];
  fxNote?: string | null;
  createdAt: string;
}

export interface Balance {
  memberId: string;
  name: string;
  cents: number;
  fmt: string;
  direction: "owed" | "owes" | "settled";
}

export interface SettleTransfer {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amountCents: number;
  amountFmt: string;
  url: string | null;
  reference: string | null;
  needsWallet: boolean;
  paid: boolean;
}

export interface Trip {
  id: string;
  name: string;
  shareToken: string;
  shareUrlPath: string;
  cluster: string;
  createdAt: string;
  ownerUserId?: string | null;
  members: TripMember[];
  expenses: TripExpense[];
  totalCents: number;
  totalFmt: string;
  balances: Balance[];
  settle: { transfers: SettleTransfer[]; allPaid: boolean; createdAt: string } | null;
}

export interface TripSummary {
  id: string;
  name: string;
  createdAt: string;
  memberCount: number;
  expenseCount: number;
  totalCents: number;
  totalFmt: string;
  settledUp: boolean;
}

export interface ChatMessage {
  id: string;
  userId: string | null;
  author: string;
  text: string | null;
  image: string | null;
  createdAt: string;
}

/**
 * dashboard.ts — Cross-trip balances dashboard.
 *
 * The signed-in user's hub: their NET balance across ALL trips they own or have
 * claimed a member slot in. READ-ONLY — this never writes; it only computes from
 * the existing trip ledgers.
 *
 * GUARDRAIL: money is ALWAYS integer cents. + = you're owed, - = you owe.
 *
 * Mount (integrator):
 *   import { dashboardRouter } from "./dashboard";
 *   app.use(dashboardRouter);
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "./auth";
import { listTripsForUser, TripMember } from "./trips";
import { computeBalances, minimalSettlement, Balance } from "./ledger";
import { fmt } from "./split";

export const dashboardRouter = Router();

interface TripEntry {
  tripId: string;
  tripName: string;
  netCents: number;
  fmt: string;
  direction: "owed" | "owes" | "settled";
  shareUrlPath: string;
}

interface Counterparty {
  name: string;
  cents: number;
  fmt: string;
  direction: "owed" | "owes";
  wallet: string | null;
}

/** Accumulator for a counterparty aggregated across trips. */
interface CounterpartyAcc {
  cents: number;
  name: string;
  wallet: string | null;
  /** True once we've seen a claimed (userId-keyed) member, whose name wins. */
  claimed: boolean;
}

dashboardRouter.get(
  "/api/me/balances",
  requireAuth,
  (req: Request, res: Response): void => {
    const userId = req.userId as string;
    const trips = listTripsForUser(userId);

    const tripEntries: TripEntry[] = [];
    let owedCents = 0;
    let owesCents = 0;

    // Aggregate signed amounts by counterparty key. Positive = they owe you
    // (you're owed); negative = you owe them.
    const counterparties = new Map<string, CounterpartyAcc>();

    for (const trip of trips) {
      const memberIds = trip.members.map((m) => m.id);
      const balances: Balance[] = computeBalances(
        memberIds,
        trip.expenses.map((e) => ({
          amountCents: e.amountCents,
          paidBy: e.paidBy,
          participants: e.participants,
        }))
      );

      // The caller's claimed slot in this trip (if any).
      const me: TripMember | undefined = trip.members.find(
        (m) => m.userId === userId
      );

      let yourNetCents = 0;
      if (me) {
        const myBalance = balances.find((b) => b.memberId === me.id);
        yourNetCents = myBalance ? myBalance.cents : 0;
      }

      if (yourNetCents > 0) owedCents += yourNetCents;
      else if (yourNetCents < 0) owesCents += Math.abs(yourNetCents);

      tripEntries.push({
        tripId: trip.id,
        tripName: trip.name,
        netCents: yourNetCents,
        fmt: fmt(Math.abs(yourNetCents)),
        direction:
          yourNetCents > 0 ? "owed" : yourNetCents < 0 ? "owes" : "settled",
        shareUrlPath: `/t/${trip.shareToken}`,
      });

      // ---- Counterparties (best-effort) ----
      // Only meaningful if the caller has a claimed slot in this trip.
      if (!me) continue;

      const transfers = minimalSettlement(balances);
      const memberById = new Map<string, TripMember>(
        trip.members.map((m) => [m.id, m])
      );

      for (const t of transfers) {
        let otherId: string | null = null;
        let signForMe = 0; // + = you're owed by other; - = you owe other.
        if (t.from === me.id) {
          // You pay `to` => you owe them.
          otherId = t.to;
          signForMe = -t.amountCents;
        } else if (t.to === me.id) {
          // `from` pays you => they owe you.
          otherId = t.from;
          signForMe = t.amountCents;
        } else {
          continue; // transfer doesn't involve you
        }

        const other = memberById.get(otherId);
        if (!other) continue;

        // Aggregate by the other member's userId if claimed, else by name+tripId
        // (so an unclaimed "Sam" in trip A doesn't merge with "Sam" in trip B).
        const key = other.userId
          ? `uid:${other.userId}`
          : `local:${other.name}@${trip.id}`;

        const existing = counterparties.get(key);
        const isClaimed = !!other.userId;
        if (existing) {
          existing.cents += signForMe;
          // Prefer a claimed member's name/wallet if we now have one.
          if (isClaimed && !existing.claimed) {
            existing.name = other.name;
            existing.claimed = true;
          }
          if (!existing.wallet && other.wallet) {
            existing.wallet = other.wallet;
          }
        } else {
          counterparties.set(key, {
            cents: signForMe,
            name: other.name,
            wallet: other.wallet ?? null,
            claimed: isClaimed,
          });
        }
      }
    }

    const netCents = owedCents - owesCents;

    const counterpartyList: Counterparty[] = [];
    for (const acc of counterparties.values()) {
      if (acc.cents === 0) continue; // net-settled with this person
      counterpartyList.push({
        name: acc.name,
        cents: acc.cents,
        fmt: fmt(Math.abs(acc.cents)),
        direction: acc.cents > 0 ? "owed" : "owes",
        wallet: acc.wallet,
      });
    }
    // Largest absolute exposure first.
    counterpartyList.sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));

    res.json({
      totals: {
        owedCents,
        owesCents,
        netCents,
        owedFmt: fmt(owedCents),
        owesFmt: fmt(owesCents),
        netFmt: fmt(netCents),
      },
      trips: tripEntries,
      counterparties: counterpartyList,
    });
  }
);

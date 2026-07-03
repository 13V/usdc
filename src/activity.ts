/**
 * activity.ts — Activity feed: a reverse-chronological timeline of what happened
 * across the signed-in user's trips.
 *
 * READ-ONLY. This module derives events entirely from existing data
 * (trips, expenses, settlements). It creates no tables and writes nothing.
 *
 * Mount (integrator):
 *   import { activityRouter } from "./activity";
 *   app.use(activityRouter);
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "./auth";
import {
  listTripsForUser,
  getSettlement,
  Trip,
  TripMember,
  TripExpense,
} from "./trips";
import { fmt } from "./split";

// ---- Event shape -----------------------------------------------------------

type ActivityType = "trip_created" | "expense" | "settlement" | "paid";

interface ActivityEvent {
  type: ActivityType;
  /** Display name of who did it, when known (e.g. the group's creator). */
  actor?: string;
  tripId: string;
  tripName: string;
  text: string;
  amountFmt?: string;
  at: string;
  // Present on settle/paid events when known (lets the client link to a receipt).
  signature?: string;
  reference?: string;
}

const MAX_EVENTS = 100;

/** Resolve a member display name from a memberId (paidBy). Falls back gracefully. */
function memberName(members: TripMember[], memberId: string): string | undefined {
  const m = members.find((mm) => mm.id === memberId);
  return m ? m.name : undefined;
}

/** Build the events for a single trip, skipping anything malformed. */
async function eventsForTrip(trip: Trip): Promise<ActivityEvent[]> {
  const out: ActivityEvent[] = [];
  if (!trip || !trip.id) return out;

  const tripId = trip.id;
  const tripName = trip.name || "Untitled trip";
  const members = Array.isArray(trip.members) ? trip.members : [];

  // trip created — name the owner's member slot so the feed can say who.
  if (trip.createdAt) {
    const owner = trip.ownerUserId
      ? members.find((m) => m && m.userId === trip.ownerUserId)
      : undefined;
    out.push({
      type: "trip_created",
      tripId,
      tripName,
      actor: owner?.name,
      text: `Trip "${tripName}" created`,
      at: trip.createdAt,
    });
  }

  // expenses
  const expenses: TripExpense[] = Array.isArray(trip.expenses) ? trip.expenses : [];
  for (const e of expenses) {
    if (!e || !e.createdAt) continue;
    const paidByName = memberName(members, e.paidBy) || "Someone";
    const title = e.title || "an expense";
    let text = `${paidByName} added "${title}"`;
    // If the expense carries FX info, note the original currency where available.
    if (e.fx && typeof e.fx === "object") {
      const cur = (e.fx as any).currency || (e.fx as any).code;
      if (cur) text += ` (${String(cur)})`;
    }
    let amountFmt: string | undefined;
    if (Number.isFinite(e.amountCents)) {
      try {
        amountFmt = fmt(e.amountCents);
      } catch {
        amountFmt = undefined;
      }
    }
    out.push({ type: "expense", tripId, tripName, text, amountFmt, at: e.createdAt });
  }

  // settlement (persisted)
  let settlement;
  try {
    settlement = await getSettlement(tripId);
  } catch {
    settlement = undefined;
  }
  if (settlement && settlement.createdAt) {
    out.push({
      type: "settlement",
      tripId,
      tripName,
      text: `Settle-up created`,
      at: settlement.createdAt,
    });

    // Paid transfers: emit a "paid" event for each settled transfer when we can
    // describe it. These share the settlement timestamp (no per-transfer time).
    const transfers = Array.isArray(settlement.transfers) ? settlement.transfers : [];
    for (const t of transfers) {
      if (!t || !t.paid) continue;
      const fromName = memberName(members, (t as any).from) || (t as any).from || "Someone";
      const toName = memberName(members, (t as any).to) || (t as any).to || "someone";
      let amountFmt: string | undefined;
      if (Number.isFinite((t as any).amountCents)) {
        try {
          amountFmt = fmt((t as any).amountCents);
        } catch {
          amountFmt = undefined;
        }
      }
      const reference = (t as any).reference || undefined;
      const signature = (t as any).signature || undefined;
      out.push({
        type: "paid",
        tripId,
        tripName,
        text: `${fromName} paid ${toName}`,
        amountFmt,
        at: settlement.createdAt,
        ...(signature ? { signature } : {}),
        ...(reference ? { reference } : {}),
      });
    }
  }

  // Member claimed/added: members carry no timestamp in the schema, so we SKIP
  // them rather than fabricate an `at`.

  return out;
}

// ---- Router ----------------------------------------------------------------

export const activityRouter = Router();

activityRouter.get(
  "/api/activity",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId as string;

    let trips: Trip[];
    try {
      trips = await listTripsForUser(userId);
    } catch {
      res.json([]);
      return;
    }

    const events: ActivityEvent[] = [];
    for (const trip of trips) {
      try {
        events.push(...(await eventsForTrip(trip)));
      } catch {
        // Be robust: one bad trip shouldn't sink the whole feed.
        continue;
      }
    }

    // Reverse-chronological by ISO timestamp (string compare is correct for
    // same-format ISO-8601), capped.
    events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const capped = events.slice(0, MAX_EVENTS);

    res.json(capped);
  }
);

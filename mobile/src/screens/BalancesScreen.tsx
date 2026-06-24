/**
 * BalancesScreen.tsx — the BALANCES tab. Rolls up the signed-in user's net
 * position across every trip: who they owe, who owes them, and the net. Tapping
 * a per-group row opens that trip; pull-to-refresh reloads.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useAuth } from "../auth";
import { useNav } from "../nav";
import { api } from "../api";
import { Button, Card, Title, Muted } from "../ui";
import { COLORS } from "../config";

interface BalanceTotals {
  owedCents: number;
  owesCents: number;
  netCents: number;
  owedFmt: string;
  owesFmt: string;
  netFmt: string;
}

interface BalanceTrip {
  tripId: string;
  tripName: string;
  netCents: number;
  fmt: string;
  direction: "owed" | "owes" | "settled";
  shareUrlPath: string;
}

interface BalanceCounterparty {
  name: string;
  cents: number;
  fmt: string;
  direction: "owed" | "owes";
}

interface MeBalances {
  totals: BalanceTotals;
  trips: BalanceTrip[];
  counterparties: BalanceCounterparty[];
}

/** Text color for a directional amount: green when you're owed, red when you owe. */
function directionColor(direction: "owed" | "owes" | "settled"): string {
  if (direction === "owed") return COLORS.green;
  if (direction === "owes") return COLORS.danger;
  return COLORS.muted;
}

function directionLabel(direction: "owed" | "owes" | "settled"): string {
  if (direction === "owed") return "you're owed";
  if (direction === "owes") return "you owe";
  return "settled up";
}

export function BalancesScreen() {
  const { token, signOut } = useAuth();
  const { push } = useNav();

  const [data, setData] = useState<MeBalances | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<MeBalances>("/api/me/balances", { token });
      setData(res);
    } catch {
      // Leave the existing data in place on error; refresh can retry.
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await api<MeBalances>("/api/me/balances", { token });
        if (active) setData(res);
      } catch {
        /* ignore — empty/loaded state still renders */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={COLORS.green} size="large" />
      </View>
    );
  }

  const totals = data?.totals;
  const counterparties = data?.counterparties ?? [];
  const trips = data?.trips ?? [];

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.green}
            colors={[COLORS.green]}
          />
        }
      >
        <Text style={styles.header}>Balances</Text>

        <Card style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Muted>You're owed</Muted>
            <Text style={[styles.summaryAmount, { color: COLORS.green }]}>
              {totals?.owedFmt ?? "—"}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Muted>You owe</Muted>
            <Text style={[styles.summaryAmount, { color: COLORS.danger }]}>
              {totals?.owesFmt ?? "—"}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.netLabel}>Net</Text>
            <Text
              style={[
                styles.netAmount,
                {
                  color:
                    (totals?.netCents ?? 0) >= 0 ? COLORS.green : COLORS.danger,
                },
              ]}
            >
              {totals?.netFmt ?? "—"}
            </Text>
          </View>
        </Card>

        <Text style={styles.section}>People</Text>
        {counterparties.length === 0 ? (
          <Card>
            <Muted>No balances with anyone yet.</Muted>
          </Card>
        ) : (
          <Card>
            {counterparties.map((cp, i) => (
              <View
                key={`${cp.name}-${i}`}
                style={[styles.personRow, i > 0 && styles.rowSep]}
              >
                <Text style={styles.personName}>{cp.name}</Text>
                <Text
                  style={[styles.personAmount, { color: directionColor(cp.direction) }]}
                >
                  {directionLabel(cp.direction)} {cp.fmt}
                </Text>
              </View>
            ))}
          </Card>
        )}

        <Text style={styles.section}>By group</Text>
        {trips.length === 0 ? (
          <Card>
            <Muted>No group balances yet.</Muted>
          </Card>
        ) : (
          trips.map((trip) => (
            <Pressable
              key={trip.tripId}
              onPress={() => push({ name: "group", tripId: trip.tripId })}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <Card>
                <View style={styles.rowBetween}>
                  <Title>{trip.tripName}</Title>
                  <Text
                    style={[styles.tripAmount, { color: directionColor(trip.direction) }]}
                  >
                    {trip.fmt}
                  </Text>
                </View>
                <Muted>{directionLabel(trip.direction)}</Muted>
              </Card>
            </Pressable>
          ))
        )}

        <Button title="Sign out" variant="danger" onPress={signOut} style={styles.signOut} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 40 },
  header: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 8,
  },
  summaryCard: { marginBottom: 8 },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  summaryAmount: { fontSize: 18, fontWeight: "700" },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 10,
  },
  netLabel: { color: COLORS.text, fontSize: 16, fontWeight: "800" },
  netAmount: { fontSize: 24, fontWeight: "800" },
  section: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: "800",
    marginTop: 16,
    marginBottom: 4,
  },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  rowSep: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  personName: { color: COLORS.text, fontSize: 16, fontWeight: "600", flexShrink: 1 },
  personAmount: { fontSize: 15, fontWeight: "700", marginLeft: 12 },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tripAmount: { fontSize: 16, fontWeight: "800", marginLeft: 12 },
  signOut: { marginTop: 24 },
});

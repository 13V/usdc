/**
 * GroupDetailScreen.tsx — a single group: balances, expenses, add-expense, and
 * settle-up. Reads the full trip on mount and after every write. Opens the chat
 * screen for receipts + messages.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Alert,
} from "react-native";
import { useAuth } from "../auth";
import { useNav } from "../nav";
import { api, Trip } from "../api";
import { Button, Field, Card, Title, Muted, Badge } from "../ui";
import { COLORS } from "../config";

export function GroupDetailScreen({ tripId }: { tripId: string }) {
  const { user, token } = useAuth();
  const { push, pop } = useNav();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Add-expense form
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Settle
  const [settling, setSettling] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<Trip>(`/api/trips/${tripId}`, { token });
      setTrip(data);
      setLoadError(null);
      // Default "paid by" to the member who is the signed-in user, else first.
      setPaidBy((prev) => {
        if (prev && data.members.some((m) => m.id === prev)) return prev;
        const mine = data.members.find((m) => m.userId && m.userId === user?.id);
        return mine?.id ?? data.members[0]?.id ?? null;
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load group.");
    }
  }, [tripId, token, user?.id]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const data = await api<Trip>(`/api/trips/${tripId}`, { token });
        if (!active) return;
        setTrip(data);
        const mine = data.members.find((m) => m.userId && m.userId === user?.id);
        setPaidBy(mine?.id ?? data.members[0]?.id ?? null);
      } catch (e) {
        if (active) setLoadError(e instanceof Error ? e.message : "Could not load group.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tripId, token, user?.id]);

  const onAddExpense = useCallback(async () => {
    if (!trip || saving) return;
    const t = title.trim();
    const amt = amount.trim();
    if (!t) {
      setAddError("Enter a title.");
      return;
    }
    if (!amt || isNaN(Number(amt)) || Number(amt) <= 0) {
      setAddError("Enter a valid amount.");
      return;
    }
    if (!paidBy) {
      setAddError("Pick who paid.");
      return;
    }
    setSaving(true);
    setAddError(null);
    try {
      const updated = await api<Trip>(`/api/trips/${trip.id}/expenses`, {
        method: "POST",
        token,
        tripToken: trip.shareToken,
        body: {
          title: t,
          total: amt,
          paidBy,
          participants: trip.members.map((m) => m.id),
        },
      });
      setTrip(updated);
      setTitle("");
      setAmount("");
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Could not add expense.");
    } finally {
      setSaving(false);
    }
  }, [trip, saving, title, amount, paidBy, token]);

  const onSettle = useCallback(async () => {
    if (!trip || settling) return;
    setSettling(true);
    setSettleError(null);
    try {
      const updated = await api<Trip>(`/api/trips/${trip.id}/settle`, {
        method: "POST",
        token,
        tripToken: trip.shareToken,
      });
      setTrip(updated);
    } catch (e) {
      setSettleError(e instanceof Error ? e.message : "Could not compute settlement.");
    } finally {
      setSettling(false);
    }
  }, [trip, settling, token]);

  const onVerify = useCallback(async () => {
    if (!trip || verifying) return;
    setVerifying(true);
    setSettleError(null);
    try {
      const updated = await api<Trip>(`/api/trips/${trip.id}/settle/verify`, {
        method: "POST",
        token,
        tripToken: trip.shareToken,
      });
      setTrip(updated);
    } catch (e) {
      setSettleError(e instanceof Error ? e.message : "Could not check settlement.");
    } finally {
      setVerifying(false);
    }
  }, [trip, verifying, token]);

  const onOpenWallet = useCallback((url: string) => {
    Alert.alert("Payments are final — no refunds", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Open in wallet",
        onPress: () => {
          Linking.openURL(url).catch(() => {
            /* no handler for the URL — nothing more we can do */
          });
        },
      },
    ]);
  }, []);

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={COLORS.green} size="large" />
      </View>
    );
  }

  if (!trip) {
    return (
      <View style={styles.screen}>
        <View style={styles.topBar}>
          <Pressable onPress={pop} hitSlop={8}>
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
        </View>
        <View style={[styles.center, { flex: 1, padding: 16 }]}>
          <Text style={styles.error}>{loadError || "Group not found."}</Text>
          <Button title="Retry" variant="secondary" onPress={load} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable onPress={pop} hitSlop={8} style={styles.backWrap}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          {trip.name}
        </Text>
        <View style={styles.chatBtn}>
          <Button
            title="Chat 💬"
            variant="secondary"
            onPress={() => push({ name: "chat", tripId: trip.id, shareToken: trip.shareToken })}
          />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Balances */}
        <Card>
          <Title>Balances</Title>
          <Muted>Total {trip.totalFmt}</Muted>
          <View style={{ height: 8 }} />
          {trip.balances.length === 0 ? (
            <Muted>No balances yet.</Muted>
          ) : (
            trip.balances.map((b) => (
              <View key={b.memberId} style={styles.row}>
                <Text style={styles.rowName}>{b.name}</Text>
                <Text
                  style={[
                    styles.rowValue,
                    b.direction === "owed"
                      ? { color: COLORS.green }
                      : b.direction === "owes"
                      ? { color: COLORS.danger }
                      : { color: COLORS.muted },
                  ]}
                >
                  {b.direction === "owed"
                    ? `is owed ${b.fmt}`
                    : b.direction === "owes"
                    ? `owes ${b.fmt}`
                    : "settled"}
                </Text>
              </View>
            ))
          )}
        </Card>

        {/* Expenses */}
        <Card>
          <Title>Expenses</Title>
          <View style={{ height: 4 }} />
          {trip.expenses.length === 0 ? (
            <Muted>No expenses yet.</Muted>
          ) : (
            trip.expenses.map((e) => (
              <View key={e.id} style={styles.expense}>
                <Text style={styles.expenseLine}>
                  {(e.paidByName || "Someone") + " · " + e.title + " — " + e.amountFmt}
                </Text>
                {e.participantNames && e.participantNames.length > 0 ? (
                  <Muted>{e.participantNames.join(", ")}</Muted>
                ) : null}
                {e.fxNote ? <Muted>{e.fxNote}</Muted> : null}
              </View>
            ))
          )}
        </Card>

        {/* Add expense */}
        <Card>
          <Title>Add expense</Title>
          <Field placeholder="Title" value={title} onChangeText={setTitle} autoCapitalize="sentences" />
          <Field
            placeholder="Amount (e.g. 24.50)"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
          <Muted>Paid by</Muted>
          <View style={styles.chips}>
            {trip.members.map((m) => {
              const active = m.id === paidBy;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => setPaidBy(m.id)}
                  style={({ pressed }) => [
                    styles.chip,
                    active && styles.chipActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{m.name}</Text>
                </Pressable>
              );
            })}
          </View>
          {addError ? <Text style={styles.error}>{addError}</Text> : null}
          <Button title="Add expense" onPress={onAddExpense} loading={saving} />
        </Card>

        {/* Settle up */}
        <Card>
          <View style={styles.rowBetween}>
            <Title>Settle up</Title>
            {trip.settle?.allPaid ? <Badge on>✓ Settled</Badge> : null}
          </View>
          {settleError ? <Text style={styles.error}>{settleError}</Text> : null}
          {trip.settle && trip.settle.transfers.length > 0 ? (
            <View>
              {trip.settle.transfers.map((tr, i) => (
                <View key={i} style={styles.transfer}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.transferLine}>
                      {tr.fromName + " → " + tr.toName + " " + tr.amountFmt}
                    </Text>
                    <Badge on={tr.paid}>{tr.paid ? "paid" : "unpaid"}</Badge>
                  </View>
                  {tr.url ? (
                    <Pressable onPress={() => onOpenWallet(tr.url as string)} hitSlop={6}>
                      <Text style={styles.link}>Open in wallet</Text>
                    </Pressable>
                  ) : tr.needsWallet ? (
                    <Muted>Recipient has no wallet on file.</Muted>
                  ) : null}
                </View>
              ))}
              <Button
                title="Check settlement"
                variant="secondary"
                onPress={onVerify}
                loading={verifying}
              />
            </View>
          ) : (
            <Button title="Settle up" onPress={onSettle} loading={settling} />
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 48 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 56,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  backWrap: { paddingRight: 8 },
  back: { color: COLORS.green, fontSize: 16, fontWeight: "700" },
  topTitle: {
    flex: 1,
    color: COLORS.text,
    fontSize: 18,
    fontWeight: "800",
    marginHorizontal: 8,
  },
  chatBtn: { minWidth: 100 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 5,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowName: { color: COLORS.text, fontSize: 15, fontWeight: "600", flexShrink: 1 },
  rowValue: { fontSize: 15, fontWeight: "700", marginLeft: 8 },
  expense: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  expenseLine: { color: COLORS.text, fontSize: 15, fontWeight: "600", marginBottom: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", marginVertical: 6 },
  chip: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
    marginBottom: 8,
  },
  chipActive: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  chipText: { color: COLORS.text, fontWeight: "600", fontSize: 14 },
  chipTextActive: { color: COLORS.ink },
  transfer: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  transferLine: { color: COLORS.text, fontSize: 15, fontWeight: "600", flexShrink: 1, marginRight: 8 },
  link: { color: COLORS.green, fontWeight: "700", fontSize: 14, marginTop: 6 },
  error: { color: COLORS.danger, fontSize: 14, marginVertical: 6 },
});

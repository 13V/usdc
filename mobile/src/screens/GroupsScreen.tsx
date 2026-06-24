/**
 * GroupsScreen.tsx — the GROUPS tab. Lists the signed-in user's trips and lets
 * them spin up a new one. Pull-to-refresh reloads; tapping a group opens it.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useAuth } from "../auth";
import { useNav } from "../nav";
import { api, TripSummary, Trip } from "../api";
import { Button, Field, Card, Title, Muted, Badge } from "../ui";
import { COLORS } from "../config";

export function GroupsScreen() {
  const { user, token } = useAuth();
  const { push } = useNav();

  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [name, setName] = useState("");
  const [extraMembers, setExtraMembers] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<TripSummary[]>("/api/trips?mine=1", { token });
      setTrips(data);
    } catch (e) {
      // Leave the existing list in place on error; refresh can retry.
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const data = await api<TripSummary[]>("/api/trips?mine=1", { token });
        if (active) setTrips(data);
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

  const onCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const members = [
        {
          name: user?.displayName || user?.handle || "You",
          wallet: user?.primaryWallet || undefined,
          userId: user?.id,
        },
        ...extraMembers
          .split(",")
          .map((m) => m.trim())
          .filter((m) => m.length > 0)
          .map((m) => ({ name: m })),
      ];
      const trip = await api<Trip>("/api/trips", {
        method: "POST",
        token,
        body: { name: trimmed, members },
      });
      setName("");
      setExtraMembers("");
      push({ name: "group", tripId: trip.id });
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create group.");
    } finally {
      setCreating(false);
    }
  }, [name, extraMembers, creating, user, token, push]);

  const renderItem = useCallback(
    ({ item }: { item: TripSummary }) => (
      <Pressable
        onPress={() => push({ name: "group", tripId: item.id })}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        <Card>
          <View style={styles.rowBetween}>
            <Title>{item.name}</Title>
            {item.settledUp ? <Badge on>Settled</Badge> : null}
          </View>
          <Muted>
            {item.memberCount} people · {item.totalFmt}
          </Muted>
        </Card>
      </Pressable>
    ),
    [push]
  );

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={COLORS.green} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={trips}
        keyExtractor={(t) => t.id}
        renderItem={renderItem}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.green}
            colors={[COLORS.green]}
          />
        }
        ListHeaderComponent={<Text style={styles.header}>Groups</Text>}
        ListEmptyComponent={
          <Card>
            <Muted>No groups yet — create one below.</Muted>
          </Card>
        }
        ListFooterComponent={
          <Card style={styles.newCard}>
            <Title>＋ New group</Title>
            <Field
              placeholder="Group name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
            <Field
              placeholder="Extra members (comma-separated)"
              value={extraMembers}
              onChangeText={setExtraMembers}
              autoCapitalize="words"
            />
            {createError ? <Text style={styles.error}>{createError}</Text> : null}
            <Button title="Create group" onPress={onCreate} loading={creating} />
          </Card>
        }
      />
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
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  newCard: { marginTop: 16 },
  error: { color: COLORS.danger, fontSize: 14, marginVertical: 6 },
});

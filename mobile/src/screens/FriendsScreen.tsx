/**
 * FriendsScreen.tsx — the FRIENDS tab.
 *
 * Add friends by @handle or wallet, remove them, and spin up a new group trip
 * with yourself + any selected friends as members.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useAuth } from "../auth";
import { useNav } from "../nav";
import { api, ApiError, Friend, Trip } from "../api";
import { Button, Field, Card, Title, Muted } from "../ui";
import { COLORS } from "../config";

type InputKind = "handle" | "wallet";

function shortWallet(w: string): string {
  if (w.length <= 12) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

function friendLabel(f: Friend): string {
  if (f.displayName) return f.displayName;
  if (f.handle) return `@${f.handle}`;
  if (f.primaryWallet) return shortWallet(f.primaryWallet);
  return "friend";
}

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

export function FriendsScreen() {
  const { user, token } = useAuth();
  const { push } = useNav();

  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);

  // Add-friend form
  const [kind, setKind] = useState<InputKind>("handle");
  const [addValue, setAddValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addNotice, setAddNotice] = useState<string | null>(null);

  // Per-friend removal in-flight
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Start-a-group form
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ friends: Friend[] }>("/api/friends", { token });
      setFriends(data.friends);
    } catch (e) {
      setAddError(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const onAdd = useCallback(async () => {
    const raw = addValue.trim();
    setAddError(null);
    setAddNotice(null);
    if (!raw) return;
    setAdding(true);
    try {
      const body =
        kind === "handle"
          ? { handle: raw.replace(/^@/, "") }
          : { wallet: raw };
      const { friend } = await api<{ friend: Friend }>("/api/friends", {
        method: "POST",
        body,
        token,
      });
      setFriends((prev) =>
        prev.some((f) => f.id === friend.id) ? prev : [...prev, friend]
      );
      setAddValue("");
      setAddNotice(`Added ${friendLabel(friend)}`);
    } catch (e) {
      // A 404 means "not a Divvy user yet" — surface the server's message.
      setAddError(errMessage(e));
    } finally {
      setAdding(false);
    }
  }, [addValue, kind, token]);

  const onRemove = useCallback(
    async (friend: Friend) => {
      setRemovingId(friend.id);
      try {
        await api<{ ok: true }>(`/api/friends/${friend.id}`, {
          method: "DELETE",
          token,
        });
        setFriends((prev) => prev.filter((f) => f.id !== friend.id));
        setSelected((prev) => {
          const next = { ...prev };
          delete next[friend.id];
          return next;
        });
      } catch (e) {
        setAddError(errMessage(e));
      } finally {
        setRemovingId(null);
      }
    },
    [token]
  );

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const onCreateGroup = useCallback(async () => {
    const name = groupName.trim();
    setGroupError(null);
    if (!name) {
      setGroupError("Give your group a name");
      return;
    }
    const chosen = friends.filter((f) => selected[f.id]);
    setCreating(true);
    try {
      const members = [
        {
          name: user?.displayName || user?.handle || "You",
          wallet: user?.primaryWallet || undefined,
          userId: user?.id,
        },
        ...chosen.map((f) => ({
          name: f.displayName || f.handle || "friend",
          wallet: f.primaryWallet || undefined,
          userId: f.id,
        })),
      ];
      const trip = await api<Trip>("/api/trips", {
        method: "POST",
        body: { name, members },
        token,
      });
      setGroupName("");
      setSelected({});
      push({ name: "group", tripId: trip.id });
    } catch (e) {
      setGroupError(errMessage(e));
    } finally {
      setCreating(false);
    }
  }, [groupName, friends, selected, user, token, push]);

  const renderHeader = () => (
    <View>
      <Title>Friends</Title>

      {/* ADD FRIEND */}
      <Card>
        <Muted>Add a friend</Muted>
        <View style={styles.toggleRow}>
          <Pressable
            onPress={() => setKind("handle")}
            style={[styles.chip, kind === "handle" && styles.chipOn]}
          >
            <Text style={[styles.chipText, kind === "handle" && styles.chipTextOn]}>
              @handle
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setKind("wallet")}
            style={[styles.chip, kind === "wallet" && styles.chipOn]}
          >
            <Text style={[styles.chipText, kind === "wallet" && styles.chipTextOn]}>
              wallet
            </Text>
          </Pressable>
        </View>
        <Field
          value={addValue}
          onChangeText={(t) => {
            setAddValue(t);
            setAddError(null);
            setAddNotice(null);
          }}
          placeholder={kind === "handle" ? "@handle" : "wallet address"}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={onAdd}
          returnKeyType="done"
        />
        <Button title="Add" onPress={onAdd} loading={adding} />
        {addError ? <Text style={styles.error}>{addError}</Text> : null}
        {addNotice ? <Text style={styles.notice}>{addNotice}</Text> : null}
      </Card>

      <Muted>Your friends</Muted>
    </View>
  );

  const renderFooter = () => (
    <Card>
      <Muted>Start a group</Muted>
      <Field
        value={groupName}
        onChangeText={(t) => {
          setGroupName(t);
          setGroupError(null);
        }}
        placeholder="Group name"
        autoCapitalize="words"
      />
      {friends.length === 0 ? (
        <Muted>Add friends above to include them in a group.</Muted>
      ) : (
        <View style={styles.selectWrap}>
          {friends.map((f) => {
            const on = !!selected[f.id];
            return (
              <Pressable
                key={f.id}
                onPress={() => toggleSelected(f.id)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                  {friendLabel(f)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <Text style={styles.includeNote}>You are included automatically.</Text>
      <Button title="Create group" onPress={onCreateGroup} loading={creating} />
      {groupError ? <Text style={styles.error}>{groupError}</Text> : null}
    </Card>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.green} size="large" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={friends}
      keyExtractor={(f) => f.id}
      ListHeaderComponent={renderHeader}
      ListFooterComponent={renderFooter}
      ListEmptyComponent={<Muted>No friends yet.</Muted>}
      renderItem={({ item }) => (
        <Card style={styles.friendRow}>
          <View style={styles.friendInfo}>
            <Text style={styles.friendName}>{friendLabel(item)}</Text>
            {item.handle && item.displayName ? (
              <Muted>@{item.handle}</Muted>
            ) : item.primaryWallet ? (
              <Muted>{shortWallet(item.primaryWallet)}</Muted>
            ) : null}
          </View>
          <Button
            title="Remove"
            variant="danger"
            onPress={() => onRemove(item)}
            loading={removingId === item.id}
            style={styles.removeBtn}
          />
        </Card>
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 48 },
  center: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleRow: { flexDirection: "row", gap: 8, marginVertical: 8 },
  selectWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 6 },
  chip: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: "transparent",
  },
  chipOn: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  chipText: { color: COLORS.text, fontWeight: "700", fontSize: 14 },
  chipTextOn: { color: COLORS.ink },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  friendInfo: { flex: 1, paddingRight: 12 },
  friendName: { color: COLORS.text, fontSize: 16, fontWeight: "700" },
  removeBtn: { marginVertical: 0, paddingVertical: 8, paddingHorizontal: 12 },
  error: { color: COLORS.danger, fontSize: 14, marginTop: 6 },
  notice: { color: COLORS.green, fontSize: 14, marginTop: 6 },
  includeNote: { color: COLORS.muted, fontSize: 13, marginTop: 4, marginBottom: 2 },
});

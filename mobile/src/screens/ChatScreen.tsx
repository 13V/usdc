/**
 * ChatScreen.tsx — group chat + receipts. Merges chat messages and expenses
 * into one ascending timeline, polls for new messages every 4s, and lets you
 * post text or a receipt photo.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TextInput,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "../auth";
import { useNav } from "../nav";
import { api, ApiError, Trip, TripExpense, ChatMessage } from "../api";
import { Button, Muted } from "../ui";
import { COLORS } from "../config";

// Unified timeline item: either a chat message or an expense entry.
type TimelineItem =
  | { kind: "message"; id: string; createdAt: string; msg: ChatMessage }
  | { kind: "expense"; id: string; createdAt: string; exp: TripExpense };

function buildTimeline(messages: ChatMessage[], expenses: TripExpense[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...messages.map((m): TimelineItem => ({ kind: "message", id: `m_${m.id}`, createdAt: m.createdAt, msg: m })),
    ...expenses.map((e): TimelineItem => ({ kind: "expense", id: `e_${e.id}`, createdAt: e.createdAt, exp: e })),
  ];
  items.sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return ta - tb;
  });
  return items;
}

export function ChatScreen({ tripId, shareToken }: { tripId: string; shareToken: string }) {
  const { user, token } = useAuth();
  const { pop } = useNav();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [expenses, setExpenses] = useState<TripExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const listRef = useRef<FlatList<TimelineItem>>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const lastSeenISO = useRef<string | null>(null);

  const ingest = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const fresh = incoming.filter((m) => !seenIds.current.has(m.id));
      if (fresh.length === 0) return prev;
      for (const m of fresh) {
        seenIds.current.add(m.id);
        if (!lastSeenISO.current || m.createdAt > lastSeenISO.current) {
          lastSeenISO.current = m.createdAt;
        }
      }
      return [...prev, ...fresh];
    });
  }, []);

  // Initial load: trip (for expenses) + messages.
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [trip, msgs] = await Promise.all([
          api<Trip>(`/api/trips/${tripId}`, { token, tripToken: shareToken }),
          api<{ messages: ChatMessage[] }>(`/api/trips/${tripId}/messages`, {
            token,
            tripToken: shareToken,
          }),
        ]);
        if (!active) return;
        setExpenses(trip.expenses);
        for (const m of msgs.messages) {
          seenIds.current.add(m.id);
          if (!lastSeenISO.current || m.createdAt > lastSeenISO.current) {
            lastSeenISO.current = m.createdAt;
          }
        }
        setMessages(msgs.messages);
        setLoadError(null);
      } catch (e) {
        if (!active) return;
        if (e instanceof ApiError && e.status === 403) {
          setLoadError("No access to this chat.");
        } else {
          setLoadError(e instanceof Error ? e.message : "Could not load chat.");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tripId, token, shareToken]);

  // Poll for new messages every 4s while mounted.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const after = lastSeenISO.current;
        const qs = after ? `?after=${encodeURIComponent(after)}` : "";
        const res = await api<{ messages: ChatMessage[] }>(`/api/trips/${tripId}/messages${qs}`, {
          token,
          tripToken: shareToken,
        });
        ingest(res.messages);
      } catch {
        /* transient — next tick retries */
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [tripId, token, shareToken, ingest]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const onPickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true,
        quality: 0.5,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      if (!asset.base64) {
        setSendError("Could not read that image.");
        return;
      }
      const mime = asset.mimeType || "image/jpeg";
      setPendingImage(`data:${mime};base64,${asset.base64}`);
      setSendError(null);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Could not pick an image.");
    }
  }, []);

  const onSend = useCallback(async () => {
    if (sending) return;
    const body: { text?: string; image?: string } = {};
    const t = text.trim();
    if (t) body.text = t;
    if (pendingImage) body.image = pendingImage;
    if (!body.text && !body.image) return;
    setSending(true);
    setSendError(null);
    try {
      const msg = await api<ChatMessage>(`/api/trips/${tripId}/messages`, {
        method: "POST",
        token,
        tripToken: shareToken,
        body,
      });
      ingest([msg]);
      setText("");
      setPendingImage(null);
      scrollToEnd();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setSendError("No access to this chat.");
      } else {
        setSendError(e instanceof Error ? e.message : "Could not send.");
      }
    } finally {
      setSending(false);
    }
  }, [sending, text, pendingImage, tripId, token, shareToken, ingest, scrollToEnd]);

  const timeline = buildTimeline(messages, expenses);

  const renderItem = useCallback(
    ({ item }: { item: TimelineItem }) => {
      if (item.kind === "expense") {
        const e = item.exp;
        return (
          <View style={styles.expenseCard}>
            <Text style={styles.expenseText}>
              {"🧾 " + (e.paidByName || "Someone") + " added " + e.title + " — " + e.amountFmt}
            </Text>
          </View>
        );
      }
      const m = item.msg;
      const mine = !!user?.id && m.userId === user.id;
      return (
        <View style={[styles.bubbleRow, mine ? styles.rowRight : styles.rowLeft]}>
          <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
            {!mine ? <Text style={styles.author}>{m.author}</Text> : null}
            {m.image ? (
              <Image source={{ uri: m.image }} style={styles.image} resizeMode="cover" />
            ) : null}
            {m.text ? (
              <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{m.text}</Text>
            ) : null}
          </View>
        </View>
      );
    },
    [user?.id]
  );

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.topBar}>
        <Pressable onPress={pop} hitSlop={8} style={styles.backWrap}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.topTitle}>Group chat</Text>
      </View>

      {loading ? (
        <View style={[styles.center, { flex: 1 }]}>
          <ActivityIndicator color={COLORS.green} size="large" />
        </View>
      ) : loadError ? (
        <View style={[styles.center, { flex: 1, padding: 16 }]}>
          <Text style={styles.error}>{loadError}</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={timeline}
          keyExtractor={(it) => it.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onContentSizeChange={scrollToEnd}
          ListEmptyComponent={
            <View style={styles.center}>
              <Muted>No messages yet — say hi or drop a receipt.</Muted>
            </View>
          }
        />
      )}

      {/* Composer */}
      <View style={styles.composerWrap}>
        {pendingImage ? (
          <View style={styles.pendingRow}>
            <Image source={{ uri: pendingImage }} style={styles.pendingThumb} resizeMode="cover" />
            <Pressable onPress={() => setPendingImage(null)} hitSlop={8}>
              <Text style={styles.removeAttach}>Remove ✕</Text>
            </Pressable>
          </View>
        ) : null}
        {sendError ? <Text style={styles.error}>{sendError}</Text> : null}
        <View style={styles.composer}>
          <Pressable onPress={onPickImage} hitSlop={8} style={styles.camBtn}>
            <Text style={styles.cam}>📷</Text>
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder="Message"
            placeholderTextColor={COLORS.muted}
            value={text}
            onChangeText={setText}
            multiline
          />
          <View style={styles.sendBtn}>
            <Button title="Send" onPress={onSend} loading={sending} />
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  center: { alignItems: "center", justifyContent: "center" },
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
  topTitle: { color: COLORS.text, fontSize: 18, fontWeight: "800", marginLeft: 8 },
  list: { padding: 12, paddingBottom: 16, flexGrow: 1 },
  bubbleRow: { marginVertical: 4, flexDirection: "row" },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "80%",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  bubbleMine: { backgroundColor: COLORS.green },
  bubbleOther: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  author: { color: COLORS.muted, fontSize: 12, fontWeight: "700", marginBottom: 3 },
  bubbleText: { color: COLORS.text, fontSize: 15 },
  bubbleTextMine: { color: COLORS.ink, fontWeight: "600" },
  image: { width: 220, height: 220, borderRadius: 10, marginBottom: 4 },
  expenseCard: {
    alignSelf: "center",
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginVertical: 6,
    maxWidth: "90%",
  },
  expenseText: { color: COLORS.text, fontSize: 14, fontWeight: "600", textAlign: "center" },
  composerWrap: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 24,
  },
  pendingRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  pendingThumb: { width: 56, height: 56, borderRadius: 8, marginRight: 10 },
  removeAttach: { color: COLORS.danger, fontWeight: "700", fontSize: 14 },
  composer: { flexDirection: "row", alignItems: "flex-end" },
  camBtn: { paddingHorizontal: 6, paddingBottom: 18 },
  cam: { fontSize: 22 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.text,
    fontSize: 15,
    marginHorizontal: 6,
  },
  sendBtn: { minWidth: 84 },
  error: { color: COLORS.danger, fontSize: 14, marginVertical: 4, textAlign: "center" },
});

import React from "react";
import { StatusBar } from "expo-status-bar";
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./src/auth";
import { NavProvider, useNav, isTab, TabName } from "./src/nav";
import { COLORS } from "./src/config";
import { SignInScreen } from "./src/screens/SignInScreen";
import { GroupsScreen } from "./src/screens/GroupsScreen";
import { FriendsScreen } from "./src/screens/FriendsScreen";
import { BalancesScreen } from "./src/screens/BalancesScreen";
import { GroupDetailScreen } from "./src/screens/GroupDetailScreen";
import { ChatScreen } from "./src/screens/ChatScreen";

const TABS: { key: TabName; label: string }[] = [
  { key: "groups", label: "Groups" },
  { key: "friends", label: "Friends" },
  { key: "balances", label: "Balances" },
];

function Shell() {
  const nav = useNav();
  const r = nav.current;

  let screen: React.ReactNode = null;
  if (r.name === "groups") screen = <GroupsScreen />;
  else if (r.name === "friends") screen = <FriendsScreen />;
  else if (r.name === "balances") screen = <BalancesScreen />;
  else if (r.name === "group") screen = <GroupDetailScreen tripId={r.tripId} />;
  else if (r.name === "chat") screen = <ChatScreen tripId={r.tripId} shareToken={r.shareToken} />;

  return (
    <View style={styles.fill}>
      <View style={styles.fill}>{screen}</View>
      {isTab(r) && (
        <View style={styles.tabbar}>
          {TABS.map((t) => {
            const active = r.name === t.key;
            return (
              <Pressable key={t.key} style={styles.tab} onPress={() => nav.switchTab(t.key)}>
                <Text style={[styles.tabText, active && { color: COLORS.green }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function Gate() {
  const { ready, user } = useAuth();
  if (!ready) {
    return (
      <View style={[styles.fill, styles.center]}>
        <ActivityIndicator color={COLORS.green} size="large" />
      </View>
    );
  }
  if (!user) return <SignInScreen />;
  return (
    <NavProvider>
      <Shell />
    </NavProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.fill} edges={["top", "bottom"]}>
        <StatusBar style="light" />
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: COLORS.bg },
  center: { alignItems: "center", justifyContent: "center" },
  tabbar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabText: { color: COLORS.muted, fontWeight: "700", fontSize: 14 },
});

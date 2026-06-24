import React, { useState } from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { useAuth } from "../auth";
import { Button, Field, Card, Title, Muted } from "../ui";
import { COLORS } from "../config";
import { Text } from "react-native";

export function SignInScreen() {
  const { createWallet, importExisting } = useAuth();
  const [busy, setBusy] = useState<"create" | "import" | null>(null);
  const [secret, setSecret] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(kind: "create" | "import") {
    setErr(null);
    setBusy(kind);
    try {
      if (kind === "create") await createWallet();
      else await importExisting(secret);
    } catch (e: any) {
      setErr(e?.message || "Something went wrong. Check your server URL and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.logo}>Divvy</Text>
      <Muted>Split the bill, settle in USDC on Solana.</Muted>

      <Card style={{ marginTop: 24 }}>
        <Title>Get started</Title>
        <Muted>Create a Solana wallet right on your phone — no extension, no seed phrase to copy. It's stored in your device's secure keychain.</Muted>
        <Button
          title="Create a wallet"
          onPress={() => run("create")}
          loading={busy === "create"}
          disabled={busy != null}
          style={{ marginTop: 12 }}
        />
        <Button
          title={showImport ? "Hide import" : "I already have a wallet"}
          variant="secondary"
          onPress={() => setShowImport((v) => !v)}
          disabled={busy != null}
        />
        {showImport && (
          <View style={{ marginTop: 8 }}>
            <Muted>Paste your wallet's secret key (base58). Stored only in your device keychain.</Muted>
            <Field
              placeholder="base58 secret key"
              value={secret}
              onChangeText={setSecret}
              autoCapitalize="none"
              secureTextEntry
            />
            <Button
              title="Import & sign in"
              onPress={() => run("import")}
              loading={busy === "import"}
              disabled={busy != null || !secret.trim()}
            />
          </View>
        )}
        {err && <Text style={styles.err}>{err}</Text>}
      </Card>

      <Muted>
        Devnet-first. The wallet key lives in your device's secure storage — a starter self-custody model; a production build would add backup/recovery.
      </Muted>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, paddingTop: 40, flexGrow: 1, backgroundColor: COLORS.bg },
  logo: { color: COLORS.green, fontSize: 34, fontWeight: "900" },
  err: { color: COLORS.danger, marginTop: 10 },
});

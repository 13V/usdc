/**
 * ui.tsx — small shared component kit (dark theme matching the web app).
 */
import React from "react";
import {
  Text,
  View,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  TextInputProps,
  ViewStyle,
} from "react-native";
import { COLORS } from "./config";

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const bg =
    variant === "primary" ? COLORS.green : variant === "danger" ? "transparent" : "transparent";
  const fg = variant === "primary" ? COLORS.ink : variant === "danger" ? COLORS.danger : COLORS.text;
  const border = variant === "primary" ? COLORS.green : COLORS.border;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.btnText, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={COLORS.muted}
      {...props}
      style={[styles.field, props.style]}
    />
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Badge({ children, on }: { children: React.ReactNode; on?: boolean }) {
  return (
    <View style={[styles.badge, on && { backgroundColor: COLORS.green }]}>
      <Text style={[styles.badgeText, on && { color: COLORS.ink }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    marginVertical: 6,
  },
  btnText: { fontWeight: "700", fontSize: 16 },
  field: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: COLORS.text,
    fontSize: 16,
    marginVertical: 6,
  },
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginVertical: 8,
  },
  title: { color: COLORS.text, fontSize: 20, fontWeight: "800", marginBottom: 4 },
  muted: { color: COLORS.muted, fontSize: 13 },
  badge: {
    backgroundColor: COLORS.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  badgeText: { color: COLORS.text, fontSize: 12, fontWeight: "700" },
});

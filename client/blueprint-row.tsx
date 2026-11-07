import { useMemo } from "react";
import { Text, View } from "react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { BlueprintRow, Phase } from "../shared/status";

const LABELS: Record<Phase, string> = {
  checking: "Checking",
  working: "Back to the agent",
  reviewing: "In review",
  ready: "Ready",
  attention: "Needs you",
};

/** Mob's status card in a worker's timeline: phase, summary, checks, review. */
export function BlueprintRowCard({ item, theme }: PluginTimelineItemProps<BlueprintRow>) {
  const row = item.data;
  const styles = useMemo(() => {
    const tone =
      row.phase === "ready"
        ? theme.colors.statusSuccess
        : row.phase === "attention"
          ? theme.colors.statusDanger
          : row.phase === "working"
            ? theme.colors.statusWarning
            : theme.colors.foregroundMuted;
    return {
      card: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        borderRadius: 8,
        padding: 12,
        gap: 6,
      },
      head: { flexDirection: "row" as const, gap: 8, alignItems: "center" as const },
      phase: { color: tone, fontWeight: "600" as const },
      text: { color: theme.colors.foreground },
      muted: { color: theme.colors.foregroundMuted },
    };
  }, [row.phase, theme]);

  return (
    <View style={styles.card} accessibilityLabel={`Mob: ${LABELS[row.phase]}. ${row.summary}`}>
      <View style={styles.head}>
        <Text style={styles.muted}>Mob</Text>
        <Text style={styles.phase}>{LABELS[row.phase]}</Text>
      </View>
      <Text style={styles.text}>{row.summary}</Text>
      {row.checks.length > 0 ? (
        <Text style={styles.muted}>
          {row.checks.map((check) => `${check.ok ? "✓" : "✗"} ${check.name}`).join("   ")}
          {row.checkFailures > 0 ? `   (retry ${row.checkFailures} of ${row.checkRetries})` : ""}
        </Text>
      ) : null}
      {row.review ? (
        <Text style={styles.muted}>
          Review round {row.review.round}: {row.review.verdict}
        </Text>
      ) : null}
    </View>
  );
}

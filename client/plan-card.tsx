import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { approvePlanRpc, rejectPlanRpc, type PlanRow, type PlanStatus, type TaskState } from "../shared/plan";

const STATUS: Record<PlanStatus, string> = {
  pending: "Waiting for you",
  rejected: "Declined",
  starting: "Starting",
  running: "Running",
  done: "Finished",
  expired: "Replaced by a newer plan",
};

const STATE: Record<TaskState, string> = {
  waiting: "Not started",
  starting: "Starting",
  working: "Agent working",
  checking: "Checks",
  reviewing: "Review",
  ready: "Ready",
  attention: "Needs you",
  failed: "Failed to start",
};

/** The plan a manager proposed: its tasks, and one approval for all of them. */
export function PlanCard({ item, theme }: PluginTimelineItemProps<PlanRow>) {
  const plan = item.data;
  const approve = useRpc(approvePlanRpc);
  const reject = useRpc(rejectPlanRpc);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = useCallback(
    async (which: "approve" | "reject") => {
      setBusy(which);
      setError(null);
      try {
        const result = await (which === "approve" ? approve : reject)({ planId: plan.planId });
        if (!result.ok) setError(result.error);
      } catch (cause) {
        setError((cause as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [approve, reject, plan.planId],
  );

  const styles = useMemo(() => {
    const tone = (state: TaskState) =>
      state === "ready"
        ? theme.colors.statusSuccess
        : state === "attention" || state === "failed"
          ? theme.colors.statusDanger
          : state === "waiting"
            ? theme.colors.foregroundMuted
            : theme.colors.statusWarning;
    return {
      tone,
      card: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        borderRadius: 8,
        padding: 12,
        gap: 10,
      },
      head: { gap: 2 },
      label: { color: theme.colors.foregroundMuted, fontSize: 12 },
      title: { color: theme.colors.foreground, fontWeight: "600" as const, fontSize: 15 },
      row: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        gap: 12,
        paddingVertical: 6,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      },
      rowMain: { flex: 1, gap: 2 },
      text: { color: theme.colors.foreground },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      actions: { flexDirection: "row" as const, gap: 8 },
      primary: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 6,
        backgroundColor: theme.colors.accent,
      },
      primaryText: { color: theme.colors.accentForeground, fontWeight: "600" as const },
      secondary: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      error: { color: theme.colors.statusDanger },
    };
  }, [theme]);

  const pending = plan.status === "pending";
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.label}>
          Mob plan · {plan.tasks.length} {plan.tasks.length === 1 ? "task" : "tasks"} · {STATUS[plan.status]}
        </Text>
        <Text style={styles.title}>{plan.title}</Text>
      </View>
      <View>
        {plan.tasks.map((task, index) => (
          <View key={`${index}-${task.title}`} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.text}>{task.title}</Text>
              <Text style={styles.muted}>
                {task.provider} · {task.blueprint}
                {task.branch ? ` · ${task.branch}` : ""}
              </Text>
              {task.error ? <Text style={styles.error}>{task.error}</Text> : null}
            </View>
            <Text style={{ color: styles.tone(task.state) }}>{STATE[task.state]}</Text>
          </View>
        ))}
      </View>
      {pending ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Approve the plan and start ${plan.tasks.length} tasks`}
            disabled={busy !== null}
            style={styles.primary}
            onPress={() => void decide("approve")}
          >
            <Text style={styles.primaryText}>{busy === "approve" ? "Starting…" : "Approve and start"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Decline the plan"
            disabled={busy !== null}
            style={styles.secondary}
            onPress={() => void decide("reject")}
          >
            <Text style={styles.text}>{busy === "reject" ? "Declining…" : "Decline"}</Text>
          </Pressable>
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

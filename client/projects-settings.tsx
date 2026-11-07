import { useCallback, useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useSettings, type PluginSurfaceProps, type SettingsState } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection } from "@getpaseo/plugin/client/ui";
import { mobSettings, parseSettingsDraft } from "../shared/settings";

type Ready = Extract<SettingsState<typeof mobSettings.schema>, { status: "ready" }>;

const EXAMPLE = {
  projects: [
    {
      path: "/absolute/path/to/repository",
      blueprint: "standard",
      checks: [{ name: "tests", command: "bun test" }],
      checkRetries: 2,
      reviewRounds: 1,
      reviewer: { provider: "claude/claude-sonnet-5" },
      allow: ["git status", "git diff*", "bun test*"],
      deny: ["git push*", "rm -rf*"],
      providerOptions: { codex: { sandbox_mode: "workspace-write" } },
      plans: true,
      taskProvider: null,
      baseRef: null,
    },
  ],
};

function Editor({ settings, theme }: { settings: Ready; theme: PluginSurfaceProps["theme"] }) {
  const [draft, setDraft] = useState(() => ({
    text: JSON.stringify(settings.values.projects.length ? settings.values : EXAMPLE, null, 2),
    revision: settings.revision,
  }));
  const [error, setError] = useState<string | null>(null);
  const styles = useMemo(
    () => ({
      input: {
        minHeight: 320,
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface0,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 6,
        padding: 10,
        fontFamily: "monospace",
        fontSize: 13,
        textAlignVertical: "top" as const,
      },
      text: { color: theme.colors.foregroundMuted },
      error: { color: theme.colors.statusDanger },
    }),
    [theme],
  );
  const save = useCallback(async () => {
    const parsed = parseSettingsDraft(draft.text);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    setError(null);
    // A successful save changes the revision, which remounts this editor with the saved values.
    await settings.save(parsed.values as Ready["values"], draft.revision);
  }, [draft, settings]);

  return (
    <SettingsSection title="Projects">
      <Text style={styles.text}>
        One entry per repository. Checks run in the agent's checkout after each finished turn;
        allow and deny answer shell permissions for you; plans lets agents propose parallel
        tasks for you to approve. Only you can change these: agents
        cannot edit them from a repository.
      </Text>
      <View>
        <TextInput
          accessibilityLabel="Mob project settings as JSON"
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          editable={!settings.saving}
          style={styles.input}
          defaultValue={draft.text}
          onChangeText={(text) => setDraft((current) => ({ ...current, text }))}
        />
      </View>
      {error || settings.saveError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error ?? settings.saveError}
        </Text>
      ) : null}
      <SettingsCard>
        <SettingsAction
          label="Save project settings"
          actionLabel={settings.saving ? "Saving…" : "Save"}
          disabled={settings.saving}
          onPress={save}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

export function ProjectsSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(mobSettings);
  const style = useMemo(() => ({ color: theme.colors.foreground }), [theme]);
  if (settings.status === "loading") return <Text style={style}>Loading settings…</Text>;
  if (settings.status !== "ready")
    return (
      <SettingsSection title="Projects">
        <Text style={style}>{settings.error}</Text>
        <SettingsAction label="Try again" actionLabel="Reload" onPress={settings.reload} />
        {settings.status === "invalid" ? (
          <SettingsAction label="Restore defaults" actionLabel="Reset" onPress={settings.reset} />
        ) : null}
      </SettingsSection>
    );
  return <Editor key={settings.revision} settings={settings} theme={theme} />;
}

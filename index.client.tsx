import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BLUEPRINT_ROW_KIND, BLUEPRINT_ROW_VERSION, BlueprintRowSchema } from "./shared/status";
import { BlueprintRowCard } from "./client/blueprint-row";
import { ProjectsSettings } from "./client/projects-settings";

export default function contribute(client: PluginClientContext) {
  const removeRenderer = client.addTimelineRenderer({
    kind: BLUEPRINT_ROW_KIND,
    version: BLUEPRINT_ROW_VERSION,
    schema: BlueprintRowSchema,
    Component: BlueprintRowCard,
  });
  const removeSettings = client.addSettingsScreen({
    id: "projects",
    title: "Projects",
    icon: "FolderGit2",
    Component: ProjectsSettings,
  });
  return () => {
    removeRenderer();
    removeSettings();
  };
}

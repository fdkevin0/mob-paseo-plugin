import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BLUEPRINT_ROW_KIND, BLUEPRINT_ROW_VERSION, BlueprintRowSchema } from "./shared/status";
import { BlueprintRowCard } from "./client/blueprint-row";
import { ProjectsSettings } from "./client/projects-settings";
import { PlanCard } from "./client/plan-card";
import { PLAN_ROW_KIND, PLAN_ROW_VERSION, PlanRowSchema } from "./shared/plan";

export default function contribute(client: PluginClientContext) {
  const removeRenderer = client.addTimelineRenderer({
    kind: BLUEPRINT_ROW_KIND,
    version: BLUEPRINT_ROW_VERSION,
    schema: BlueprintRowSchema,
    Component: BlueprintRowCard,
  });
  const removePlan = client.addTimelineRenderer({
    kind: PLAN_ROW_KIND,
    version: PLAN_ROW_VERSION,
    schema: PlanRowSchema,
    Component: PlanCard,
  });
  const removeSettings = client.addSettingsScreen({
    id: "projects",
    title: "Projects",
    icon: "FolderGit2",
    Component: ProjectsSettings,
  });
  return () => {
    removeRenderer();
    removePlan();
    removeSettings();
  };
}

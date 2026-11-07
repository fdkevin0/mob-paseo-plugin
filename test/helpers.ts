import { ProjectSchema, type MobProject } from "../shared/settings";

export function project(overrides: Partial<Record<keyof MobProject, unknown>> = {}): MobProject {
  return ProjectSchema.parse({ path: "/repo", ...overrides });
}

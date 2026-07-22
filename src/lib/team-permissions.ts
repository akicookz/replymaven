export type TeamRole = "owner" | "admin" | "member";

interface ProjectAccessSummary {
  role: "admin" | "member";
  accessAllProjects: boolean;
  projectIds: string[];
  projectCount: number;
}

export function canCreateProjects(role: TeamRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function formatProjectAccessLabel(
  access: ProjectAccessSummary,
): string {
  if (access.role === "admin" || access.accessAllProjects) {
    return "All projects";
  }

  const count = access.projectCount ?? access.projectIds.length;
  if (count === 0) return "No projects";
  return count === 1 ? "1 project" : `${count} projects`;
}

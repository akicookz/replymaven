export interface ProjectAccessSelection {
  accessAllProjects: boolean;
  projectIds: string[];
}

export function getSelectedProjectIds(
  access: ProjectAccessSelection,
  allProjectIds: string[],
): string[] {
  return access.accessAllProjects ? allProjectIds : access.projectIds;
}

export function createProjectAccess(
  allProjectIds: string[],
  selectedProjectIds: string[],
): ProjectAccessSelection {
  const selected = new Set(selectedProjectIds);
  const hasAllProjects =
    allProjectIds.length > 0 &&
    allProjectIds.every((projectId) => selected.has(projectId));

  return {
    accessAllProjects: hasAllProjects,
    projectIds: hasAllProjects
      ? []
      : allProjectIds.filter((projectId) => selected.has(projectId)),
  };
}

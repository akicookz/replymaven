interface ProjectDeletionService {
  getProjectById(
    projectId: string,
  ): Promise<{ id: string; userId: string } | null>;
  deleteProject(projectId: string, ownerId: string): Promise<boolean>;
}

interface DeleteProjectWithNativeCleanupOptions {
  projectId: string;
  ownerId: string;
  projectService: ProjectDeletionService;
  destroyParent(): Promise<void>;
}

export async function deleteProjectWithNativeCleanup(
  options: DeleteProjectWithNativeCleanupOptions,
): Promise<boolean> {
  const project = await options.projectService.getProjectById(
    options.projectId,
  );
  if (!project || project.userId !== options.ownerId) return false;

  await options.destroyParent();
  return options.projectService.deleteProject(options.projectId, options.ownerId);
}

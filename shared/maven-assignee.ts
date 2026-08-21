export const MAVEN_ASSIGNEE_ID = "maven";

export function isMavenAssignee(
  assigneeId: string | null | undefined,
): boolean {
  return assigneeId === MAVEN_ASSIGNEE_ID;
}

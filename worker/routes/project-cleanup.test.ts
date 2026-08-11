import { describe, expect, mock, test } from "bun:test";
import { deleteProjectWithNativeCleanup } from "./project-cleanup";

describe("project deletion with native Sidechat cleanup", () => {
  test("destroys the project Agent before deleting the D1 project", async () => {
    const events: string[] = [];
    const projectService = {
      getProjectById: mock(async () => ({ id: "project-1", userId: "owner-1" })),
      deleteProject: mock(async () => {
        events.push("database");
        return true;
      }),
    };

    const deleted = await deleteProjectWithNativeCleanup({
      projectId: "project-1",
      ownerId: "owner-1",
      projectService,
      async destroyParent() {
        events.push("native");
      },
    });

    expect(deleted).toBe(true);
    expect(events).toEqual(["native", "database"]);
  });

  test("does not wake or delete anything for a project owned by someone else", async () => {
    const destroyParent = mock(async () => undefined);
    const deleteProject = mock(async () => true);

    const deleted = await deleteProjectWithNativeCleanup({
      projectId: "project-1",
      ownerId: "owner-2",
      projectService: {
        getProjectById: async () => ({ id: "project-1", userId: "owner-1" }),
        deleteProject,
      },
      destroyParent,
    });

    expect(deleted).toBe(false);
    expect(destroyParent).not.toHaveBeenCalled();
    expect(deleteProject).not.toHaveBeenCalled();
  });

  test("blocks D1 deletion when native cleanup fails", async () => {
    const deleteProject = mock(async () => true);

    await expect(deleteProjectWithNativeCleanup({
      projectId: "project-1",
      ownerId: "owner-1",
      projectService: {
        getProjectById: async () => ({ id: "project-1", userId: "owner-1" }),
        deleteProject,
      },
      async destroyParent() {
        throw new Error("native cleanup unavailable");
      },
    })).rejects.toThrow("native cleanup unavailable");
    expect(deleteProject).not.toHaveBeenCalled();
  });
});

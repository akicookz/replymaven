import { describe, expect, test } from "bun:test";
import { createProjectAccess, getSelectedProjectIds } from "./project-access";

describe("project access selection", () => {
  test("expands all-project access to the current project ids", () => {
    expect(
      getSelectedProjectIds(
        { accessAllProjects: true, projectIds: [] },
        ["one", "two"],
      ),
    ).toEqual(["one", "two"]);
  });

  test("converts a complete selection to all-project access", () => {
    expect(createProjectAccess(["one", "two"], ["two", "one"])).toEqual({
      accessAllProjects: true,
      projectIds: [],
    });
  });

  test("keeps a partial selection scoped", () => {
    expect(createProjectAccess(["one", "two"], ["two"])).toEqual({
      accessAllProjects: false,
      projectIds: ["two"],
    });
  });
});

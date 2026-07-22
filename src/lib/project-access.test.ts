import { describe, expect, test } from "bun:test";
import {
  createProjectAccess,
  getSelectedProjectIds,
} from "./project-access";

describe("project access selection", () => {
  test("selects every project for all-project access", () => {
    expect(
      getSelectedProjectIds(
        { accessAllProjects: true, projectIds: [] },
        ["one", "two"],
      ),
    ).toEqual(["one", "two"]);
  });

  test("preserves a scoped project selection", () => {
    expect(
      getSelectedProjectIds(
        { accessAllProjects: false, projectIds: ["two"] },
        ["one", "two"],
      ),
    ).toEqual(["two"]);
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

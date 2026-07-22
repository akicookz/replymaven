import { describe, expect, test } from "bun:test";
import {
  canCreateProjects,
  formatProjectAccessLabel,
} from "./team-permissions";

describe("team permissions", () => {
  test("only owners and admins can create projects", () => {
    expect(canCreateProjects("owner")).toBe(true);
    expect(canCreateProjects("admin")).toBe(true);
    expect(canCreateProjects("member")).toBe(false);
    expect(canCreateProjects(undefined)).toBe(false);
  });

  test("uses the server-provided count when project ids are hidden", () => {
    expect(
      formatProjectAccessLabel({
        role: "member",
        accessAllProjects: false,
        projectIds: [],
        projectCount: 1,
      }),
    ).toBe("1 project");
  });
});

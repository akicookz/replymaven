import { describe, expect, test } from "bun:test";
import { addProjectAccessToMembers } from "./team-service";

const members = [
  { id: "member-1", email: "member@example.com" },
  { id: "member-2", email: "other@example.com" },
];
const projectMap = {
  "member-1": ["project-1"],
};

describe("addProjectAccessToMembers", () => {
  test("returns accurate counts while hiding ids from regular members", () => {
    expect(addProjectAccessToMembers(members, projectMap, false)).toEqual([
      {
        id: "member-1",
        email: "member@example.com",
        projectIds: [],
        projectCount: 1,
      },
      {
        id: "member-2",
        email: "other@example.com",
        projectIds: [],
        projectCount: 0,
      },
    ]);
  });

  test("includes ids for owners and admins who manage project access", () => {
    expect(addProjectAccessToMembers(members, projectMap, true)[0]).toMatchObject({
      projectIds: ["project-1"],
      projectCount: 1,
    });
  });
});

import { describe, expect, test } from "bun:test";
import { MAVEN_ASSIGNEE_ID } from "../../shared/maven-assignee";
import {
  isAllowedAssignee,
  mavenAssignableUser,
  type AssignableUser,
} from "./assignable-users";

const roxanne: AssignableUser = {
  id: "user-1",
  name: "Roxanne",
  email: "roxanne@example.com",
  image: null,
  role: "owner",
};

describe("conversation assignees", () => {
  test("Maven is always allowed", () => {
    expect(isAllowedAssignee(MAVEN_ASSIGNEE_ID, [roxanne])).toBe(true);
    expect(isAllowedAssignee(null, [roxanne])).toBe(true);
    expect(isAllowedAssignee("user-1", [roxanne])).toBe(true);
    expect(isAllowedAssignee("stranger", [roxanne])).toBe(false);
  });

  test("uses the configured bot name", () => {
    expect(mavenAssignableUser("Luna")).toEqual({
      id: MAVEN_ASSIGNEE_ID,
      name: "Luna",
      email: "",
      image: null,
      role: "bot",
    });
    expect(mavenAssignableUser(null).name).toBe("Maven");
  });
});

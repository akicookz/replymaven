import { describe, expect, test } from "bun:test";
import {
  isReplyMavenHostname,
  normalizeDnsHostname,
  normalizeUrlHost,
} from "./help-host";

describe("help host", () => {
  test("strips trailing DNS dots", () => {
    expect(normalizeDnsHostname("ReplyMaven.com.")).toBe("replymaven.com");
    expect(normalizeDnsHostname("help.replymaven.com.")).toBe(
      "help.replymaven.com",
    );
    expect(normalizeUrlHost("docs.acme.com.")).toBe("docs.acme.com");
    expect(normalizeUrlHost("docs.acme.com.:8443")).toBe("docs.acme.com:8443");
  });

  test("treats trailing-dot ReplyMaven hosts as ReplyMaven", () => {
    expect(isReplyMavenHostname("replymaven.com.")).toBe(true);
    expect(isReplyMavenHostname("help.replymaven.com.")).toBe(true);
    expect(isReplyMavenHostname("docs.acme.com.")).toBe(false);
  });
});

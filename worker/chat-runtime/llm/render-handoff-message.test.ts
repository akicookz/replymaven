import { expect, test } from "bun:test";
import { type HandoffRenderDirective } from "../types";
import { isRenderedHandoffMessageValid } from "./render-handoff-message";

test("contact collection requires requested fields, an opt-out, and no premature handoff claim", () => {
  const directive: HandoffRenderDirective = {
    kind: "collect_contact",
    missingFields: ["name", "email"],
    agentLabel: "the team",
  };
  const valid = {
    asksForName: true,
    asksForEmail: true,
    offersToStayInChat: true,
    claimsAlreadyForwarded: false,
  };

  expect(isRenderedHandoffMessageValid(valid, directive)).toBe(true);
  expect(isRenderedHandoffMessageValid({ ...valid, asksForEmail: false }, directive)).toBe(false);
  expect(isRenderedHandoffMessageValid({ ...valid, claimsAlreadyForwarded: true }, directive)).toBe(false);
});

test("handoff directives do not collect contact early or repeat collection after forwarding", () => {
  const assessment = {
    asksForName: false,
    asksForEmail: false,
    offersToStayInChat: false,
    claimsAlreadyForwarded: false,
  };
  const offer: HandoffRenderDirective = { kind: "offer_handoff", hasIssueContext: true, agentLabel: "the team" };
  const escalated: HandoffRenderDirective = { kind: "escalated", variant: "created", agentLabel: "the team" };

  expect(isRenderedHandoffMessageValid(assessment, offer)).toBe(true);
  expect(isRenderedHandoffMessageValid({ ...assessment, asksForEmail: true }, offer)).toBe(false);
  expect(isRenderedHandoffMessageValid({ ...assessment, asksForName: true, claimsAlreadyForwarded: true }, escalated)).toBe(false);
});

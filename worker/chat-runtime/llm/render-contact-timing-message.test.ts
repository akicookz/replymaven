import { describe, expect, test } from "bun:test";
import { type LanguageModel } from "ai";
import {
  buildRenderContactTimingPrompt,
  fallbackRenderContactTimingMessage,
  isRenderedContactTimingMessageValid,
  renderContactTimingMessage,
} from "./render-contact-timing-message";

function asTimingAssessment(
  assessment: Record<string, unknown>,
): Parameters<typeof isRenderedContactTimingMessageValid>[0] {
  return assessment as Parameters<
    typeof isRenderedContactTimingMessageValid
  >[0];
}

const validationContext = {
  workingHours: "Monday through Friday, 8am-8pm CET",
  avgResponseTime:
    "2-4 hours on business days, 8-12 hours on weekends and holidays",
};

function validateTimingAssessment(
  assessment: Record<string, unknown>,
): boolean {
  const validate = isRenderedContactTimingMessageValid as unknown as (
    candidate: Parameters<typeof isRenderedContactTimingMessageValid>[0],
    context: typeof validationContext,
  ) => boolean;
  return validate(asTimingAssessment(assessment), validationContext);
}

describe("contact timing message guardrails", () => {
  test("accepts a normal-day expectation without unnecessary availability commentary", () => {
    expect(
      validateTimingAssessment({
        message: "You can expect a reply within 2-4 hours.",
        applicableDayType: "business_day",
        teamAvailability: "normal",
        responseWindowCount: 1,
        includesAvailabilityContext: false,
        communicatesReplyExpectation: true,
        mentionsWorkingHours: false,
        usesUnsupportedPrecision: false,
        expectationSource: "2-4 hours on business days",
      }),
    ).toBe(true);
  });

  test("requires context when the team is slower than usual", () => {
    expect(
      validateTimingAssessment({
        message:
          "Today is Saturday, so the team may be a little slower than usual. You can expect a reply within 8-12 hours.",
        applicableDayType: "weekend",
        teamAvailability: "slower",
        responseWindowCount: 1,
        includesAvailabilityContext: true,
        communicatesReplyExpectation: true,
        mentionsWorkingHours: false,
        usesUnsupportedPrecision: false,
        expectationSource: "8-12 hours on weekends and holidays",
      }),
    ).toBe(true);

    expect(
      validateTimingAssessment({
        message: "You can expect a reply within 8-12 hours.",
        applicableDayType: "weekend",
        teamAvailability: "slower",
        responseWindowCount: 1,
        includesAvailabilityContext: false,
        communicatesReplyExpectation: true,
        mentionsWorkingHours: false,
        usesUnsupportedPrecision: false,
        expectationSource: "8-12 hours on weekends and holidays",
      }),
    ).toBe(false);
  });

  test("allows an off-day expectation without inventing a response window", () => {
    expect(
      validateTimingAssessment({
        message:
          "The team is off today. They should get back to you when they are back.",
        applicableDayType: "weekend",
        teamAvailability: "off",
        responseWindowCount: 0,
        includesAvailabilityContext: true,
        communicatesReplyExpectation: true,
        mentionsWorkingHours: false,
        usesUnsupportedPrecision: false,
        expectationSource: "Monday through Friday",
      }),
    ).toBe(true);

    expect(
      validateTimingAssessment({
        message:
          "The team is off today and will be back tomorrow at 9am. You can expect a reply after they return.",
        applicableDayType: "weekend",
        teamAvailability: "off",
        responseWindowCount: 0,
        includesAvailabilityContext: true,
        communicatesReplyExpectation: true,
        mentionsWorkingHours: false,
        usesUnsupportedPrecision: false,
        expectationSource: "Monday through Friday",
      }),
    ).toBe(false);

    for (const returnTime of [
      "noon",
      "midnight",
      "9 o'clock",
      "nine o'clock",
      "9",
      "nine",
    ]) {
      expect(
        validateTimingAssessment({
          message: `The team is off today and will be back Monday at ${returnTime}. You can expect a reply after they return.`,
          applicableDayType: "weekend",
          teamAvailability: "off",
          responseWindowCount: 0,
          includesAvailabilityContext: true,
          communicatesReplyExpectation: true,
          mentionsWorkingHours: false,
          usesUnsupportedPrecision: false,
          expectationSource: "Monday through Friday",
        }),
      ).toBe(false);
    }
  });

  test("rejects availability commentary on a normal working day", () => {
    expect(
      validateTimingAssessment({
        message:
          "The team is available today. You can expect a reply within 2-4 hours.",
        applicableDayType: "business_day",
        teamAvailability: "normal",
        responseWindowCount: 1,
        includesAvailabilityContext: true,
        communicatesReplyExpectation: true,
        mentionsWorkingHours: false,
        usesUnsupportedPrecision: false,
        expectationSource: "2-4 hours on business days",
      }),
    ).toBe(false);
  });

  test("rejects a reply that repeats multiple windows or working hours", () => {
    expect(
      validateTimingAssessment({
        message:
          "Today is Saturday, so the team may be slower. You can expect a reply within 2-4 hours on business days or 8-12 hours on weekends.",
        applicableDayType: "weekend",
        teamAvailability: "slower",
        responseWindowCount: 2,
        includesAvailabilityContext: true,
        communicatesReplyExpectation: true,
        mentionsWorkingHours: false,
        usesUnsupportedPrecision: false,
        expectationSource: "8-12 hours on weekends and holidays",
      }),
    ).toBe(false);

    expect(
      validateTimingAssessment({
        message:
          "You can expect a reply within 2-4 hours. The team works Monday through Friday, 8am-8pm CET.",
        applicableDayType: "business_day",
        teamAvailability: "normal",
        responseWindowCount: 1,
        includesAvailabilityContext: false,
        communicatesReplyExpectation: true,
        mentionsWorkingHours: true,
        usesUnsupportedPrecision: false,
        expectationSource: "2-4 hours on business days",
      }),
    ).toBe(false);
  });

  test("allows an honest unknown expectation and rejects unsupported precision", () => {
    expect(
      validateTimingAssessment({
        message: "The team should get back to you as soon as possible.",
        applicableDayType: "unavailable",
        teamAvailability: "unknown",
        responseWindowCount: 0,
        includesAvailabilityContext: false,
        communicatesReplyExpectation: true,
        mentionsWorkingHours: false,
        usesUnsupportedPrecision: false,
        expectationSource: null,
      }),
    ).toBe(true);

    expect(
      validateTimingAssessment({
        message: "The team is off today and will be back Monday at 9am.",
        applicableDayType: "weekend",
        teamAvailability: "off",
        responseWindowCount: 1,
        includesAvailabilityContext: true,
        communicatesReplyExpectation: true,
        mentionsWorkingHours: false,
        usesUnsupportedPrecision: true,
        expectationSource: "Monday through Friday",
      }),
    ).toBe(false);

    expect(fallbackRenderContactTimingMessage()).toBe(
      "The team should get back to you as soon as possible.",
    );
  });

  test("rejects alternate unknown wording, em dashes, and hidden multiple windows", () => {
    expect(
      validateTimingAssessment({
        message: "They will reply whenever someone is available.",
        applicableDayType: "unavailable",
        teamAvailability: "unknown",
        responseWindowCount: 0,
        includesAvailabilityContext: false,
        communicatesReplyExpectation: true,
        mentionsWorkingHours: false,
        usesUnsupportedPrecision: false,
        expectationSource: null,
      }),
    ).toBe(false);

    expect(
      validateTimingAssessment({
        message:
          "Today is Saturday — the team may be slower. You can expect a reply within 8-12 hours.",
        applicableDayType: "weekend",
        teamAvailability: "slower",
        responseWindowCount: 1,
        includesAvailabilityContext: true,
        communicatesReplyExpectation: true,
        mentionsWorkingHours: false,
        usesUnsupportedPrecision: false,
        expectationSource: "8-12 hours on weekends and holidays",
      }),
    ).toBe(false);

    expect(
      validateTimingAssessment({
        message:
          "Today is Saturday, so replies take 8-12 hours, while business days take 2-4 hours.",
        applicableDayType: "weekend",
        teamAvailability: "slower",
        responseWindowCount: 1,
        includesAvailabilityContext: true,
        communicatesReplyExpectation: true,
        mentionsWorkingHours: false,
        usesUnsupportedPrecision: false,
        expectationSource: "8-12 hours on weekends and holidays",
      }),
    ).toBe(false);
  });

  test("rejects an expectation source that is absent from the configuration", () => {
    expect(
      validateTimingAssessment({
        message: "The team is off today and will be back Tuesday.",
        applicableDayType: "weekend",
        teamAvailability: "off",
        responseWindowCount: 1,
        includesAvailabilityContext: true,
        communicatesReplyExpectation: true,
        mentionsWorkingHours: false,
        usesUnsupportedPrecision: false,
        expectationSource: "Tuesday",
      }),
    ).toBe(false);
  });

  test("rejects a response window that does not apply to the selected day", () => {
    expect(
      validateTimingAssessment({
        message:
          "Today is Saturday, so the team may be a little slower than usual. You can expect a reply within 2-4 hours.",
        applicableDayType: "weekend",
        teamAvailability: "slower",
        responseWindowCount: 1,
        includesAvailabilityContext: true,
        communicatesReplyExpectation: true,
        mentionsWorkingHours: false,
        usesUnsupportedPrecision: false,
        expectationSource: "2-4 hours on business days",
      }),
    ).toBe(false);

    expect(
      validateTimingAssessment({
        message:
          "Today is Saturday, so the team may be a little slower than usual. You can expect a reply within 2-4 hours.",
        applicableDayType: "weekend",
        teamAvailability: "slower",
        responseWindowCount: 1,
        includesAvailabilityContext: true,
        communicatesReplyExpectation: true,
        mentionsWorkingHours: false,
        usesUnsupportedPrecision: false,
        expectationSource: "8-12 hours on weekends and holidays",
      }),
    ).toBe(false);
  });
});

test("working hours alone are enough to evaluate whether the team is off", async () => {
  const unusableModel = {} as unknown as LanguageModel;
  let threw = false;

  try {
    await renderContactTimingMessage(
      unusableModel,
      {
        nowMs: Date.UTC(2026, 7, 1, 3, 30),
        currentMessage: "I need help",
        workingHours: "Monday through Friday, 8am-8pm CET",
        avgResponseTime: null,
        companyContext: "The support team is based in Berlin, Germany.",
        visitorLocation: {
          timezone: "Asia/Seoul",
          city: "Seoul",
          region: null,
          country: "KR",
        },
      },
      { throwOnModelError: true },
    );
  } catch {
    threw = true;
  }

  expect(threw).toBe(true);
});

test("timing prompt gives the model the date, timezone context, and one-window rule", () => {
  const prompt = buildRenderContactTimingPrompt({
    nowMs: Date.UTC(2026, 7, 1, 3, 30),
    currentMessage: "My soft 404 still returns 200. Why?",
    workingHours: "Monday through Friday, 8am-8pm CET",
    avgResponseTime:
      "2-4 hours on business days, 8-12 hours on weekends and holidays",
    companyContext: "The support team is based in Berlin, Germany.",
    visitorLocation: {
      timezone: "Asia/Seoul",
      city: "Seoul",
      region: null,
      country: "KR",
    },
  });

  expect(prompt).toContain("2026-08-01T03:30:00.000Z");
  expect(prompt).toContain("Asia/Seoul");
  expect(prompt).toContain("based in Berlin, Germany");
  expect(prompt).toContain("select exactly one applicable response window");
  expect(prompt).toContain("Do not repeat the working-hours schedule");
  expect(prompt).toContain("may be a little slower than usual");
  expect(prompt).toContain("The team is off today");
  expect(prompt).toContain(
    "The team should get back to you as soon as possible.",
  );
  expect(prompt).not.toContain("Since today is Saturday");
  expect(prompt).not.toContain("—");
});

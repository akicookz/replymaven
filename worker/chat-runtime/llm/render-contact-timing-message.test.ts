import { expect, test } from "bun:test";
import { isRenderedContactTimingMessageValid } from "./render-contact-timing-message";

const context = {
  workingHours: "Monday through Friday",
  avgResponseTime: "2-4 hours on business days, 8-12 hours on weekends",
};

function assess(overrides: Partial<Parameters<typeof isRenderedContactTimingMessageValid>[0]>) {
  return {
    message: "Replies are expected within 2-4 hours.",
    applicableDayType: "business_day" as const,
    teamAvailability: "normal" as const,
    responseWindowCount: 1,
    includesAvailabilityContext: false,
    communicatesReplyExpectation: true,
    mentionsWorkingHours: false,
    usesUnsupportedPrecision: false,
    expectationSource: "2-4 hours on business days",
    ...overrides,
  };
}

test("requires the selected response window to be supported by its source and day", () => {
  expect(isRenderedContactTimingMessageValid(assess({}), context)).toBe(true);
  expect(
    isRenderedContactTimingMessageValid(
      assess({ applicableDayType: "weekend", teamAvailability: "slower", includesAvailabilityContext: true }),
      context,
    ),
  ).toBe(false);
});

test("rejects unsupported precision and multiple response windows", () => {
  expect(
    isRenderedContactTimingMessageValid(
      assess({ usesUnsupportedPrecision: true }),
      context,
    ),
  ).toBe(false);
  expect(
    isRenderedContactTimingMessageValid(
      assess({ responseWindowCount: 2 }),
      context,
    ),
  ).toBe(false);
});

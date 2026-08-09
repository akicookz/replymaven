import { expect, test } from "bun:test";
import { type LanguageModel } from "ai";
import {
  isRenderedContactTimingMessageValid,
  renderContactTimingMessage,
} from "./render-contact-timing-message";

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

test("forwards caller cancellation to the contact timing model", async () => {
  let providerSignal: AbortSignal | undefined;
  let rejectProvider: ((reason: unknown) => void) | undefined;
  let resolveStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const model = {
    specificationVersion: "v3" as const,
    provider: "test",
    modelId: "contact-timing-test",
    supportedUrls: {},
    async doGenerate(options: { abortSignal?: AbortSignal }) {
      providerSignal = options.abortSignal;
      resolveStarted?.();
      return new Promise<never>((_resolve, reject) => {
        rejectProvider = reject;
        options.abortSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("cancelled", "AbortError")),
          { once: true },
        );
      });
    },
    async doStream() {
      throw new Error("Unexpected streaming generation");
    },
  } as LanguageModel;
  const abortController = new AbortController();
  const pending = renderContactTimingMessage(
    model,
    {
      nowMs: 0,
      currentMessage: "I need a person",
      workingHours: "Monday through Friday",
      avgResponseTime: "2-4 hours",
      companyContext: "Acme support",
      visitorLocation: {
        timezone: "UTC",
        city: null,
        region: null,
        country: null,
      },
    },
    {
      throwOnModelError: true,
      abortSignal: abortController.signal,
    },
  );

  await started;
  abortController.abort(new DOMException("visitor left", "AbortError"));
  const providerWasAborted = providerSignal?.aborted === true;
  if (!providerWasAborted) {
    rejectProvider?.(new Error("test cleanup"));
  }
  await pending.catch(() => undefined);

  expect(providerSignal).toBe(abortController.signal);
  expect(providerWasAborted).toBe(true);
});

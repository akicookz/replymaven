import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";

const renderContactTimingSchema = z.object({
  message: z
    .string()
    .min(1)
    .max(260)
    .describe(
      "One or two short visitor-facing sentences about when the team will reply.",
    ),
  applicableDayType: z
    .enum(["business_day", "weekend", "public_holiday", "unavailable"])
    .describe("The schedule category used for the sentence."),
  teamAvailability: z
    .enum(["normal", "slower", "off", "unknown"])
    .describe(
      "Whether the team is operating normally, replying more slowly, off today, or cannot be determined from the configuration.",
    ),
  responseWindowCount: z
    .number()
    .int()
    .min(0)
    .max(4)
    .describe("How many distinct response-time windows appear in the message."),
  includesAvailabilityContext: z
    .boolean()
    .describe(
      "True when the message explains why replies are slower or why the team is off.",
    ),
  communicatesReplyExpectation: z
    .boolean()
    .describe(
      "True when the message gives the clearest supported expectation for when the team should reply, even if no precise time is available.",
    ),
  mentionsWorkingHours: z
    .boolean()
    .describe("True when the sentence repeats the team's working-hours schedule."),
  usesUnsupportedPrecision: z
    .boolean()
    .describe(
      "True when the message states a day, time, or response window that cannot be derived from the provided configuration and time context.",
    ),
  expectationSource: z
    .string()
    .min(1)
    .max(200)
    .nullable()
    .describe(
      "The shortest verbatim excerpt from the configured working hours or response time that supports the expectation, or null only when availability is unknown.",
    ),
});

export interface ContactTimingLocation {
  timezone: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

export interface RenderContactTimingParams {
  nowMs: number;
  currentMessage: string;
  workingHours: string | null | undefined;
  avgResponseTime: string | null | undefined;
  companyContext: string | null | undefined;
  visitorLocation: ContactTimingLocation;
}

export type RenderedContactTimingAssessment = z.infer<
  typeof renderContactTimingSchema
>;

export function fallbackRenderContactTimingMessage(): string {
  return "The team should get back to you as soon as possible.";
}

export function isRenderedContactTimingMessageValid(
  assessment: RenderedContactTimingAssessment,
  context: Pick<
    RenderContactTimingParams,
    "workingHours" | "avgResponseTime"
  >,
): boolean {
  const message = assessment.message.trim();
  const normalizedMessage = normalizeForComparison(message);
  const normalizedWorkingHours = normalizeForComparison(
    context.workingHours ?? "",
  );
  const actualResponseWindowCount = countResponseWindows(message);

  if (
    !message ||
    message.includes("—") ||
    /\bsince today is\b/i.test(message) ||
    assessment.mentionsWorkingHours ||
    assessment.responseWindowCount > 1 ||
    actualResponseWindowCount > 1 ||
    assessment.usesUnsupportedPrecision ||
    !assessment.communicatesReplyExpectation ||
    (normalizedWorkingHours &&
      normalizedMessage.includes(normalizedWorkingHours))
  ) {
    return false;
  }

  if (assessment.teamAvailability === "unknown") {
    return (
      message === fallbackRenderContactTimingMessage() &&
      assessment.responseWindowCount === 0 &&
      !assessment.includesAvailabilityContext &&
      assessment.expectationSource === null
    );
  }

  if (!isExpectationSourceSupported(assessment, context)) {
    return false;
  }

  if (assessment.teamAvailability === "normal") {
    return (
      assessment.responseWindowCount === 1 &&
      !assessment.includesAvailabilityContext
    );
  }

  if (assessment.teamAvailability === "slower") {
    return (
      assessment.responseWindowCount === 1 &&
      assessment.includesAvailabilityContext
    );
  }

  return assessment.includesAvailabilityContext;
}

function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function countResponseWindows(message: string): number {
  return extractResponseWindowSignatures(message).length;
}

function isExpectationSourceSupported(
  assessment: RenderedContactTimingAssessment,
  context: Pick<
    RenderContactTimingParams,
    "workingHours" | "avgResponseTime"
  >,
): boolean {
  const source = assessment.expectationSource;
  if (!source?.trim()) return false;
  const normalizedSource = normalizeForComparison(source);
  if (!normalizedSource) return false;

  const configuredAvailability = normalizeForComparison(
    `${context.workingHours ?? ""} ${context.avgResponseTime ?? ""}`,
  );
  if (!configuredAvailability.includes(normalizedSource)) return false;

  if (
    assessment.teamAvailability === "off" &&
    hasUnsupportedOffDayPrecision(assessment.message, source)
  ) {
    return false;
  }

  const messageWindows = extractResponseWindowSignatures(assessment.message);
  const sourceWindows = new Set(extractResponseWindowSignatures(source));
  if (messageWindows.some((window) => !sourceWindows.has(window))) {
    return false;
  }

  if (messageWindows.length === 0) return true;
  return isSourceApplicableToDay(source, assessment.applicableDayType);
}

function hasUnsupportedOffDayPrecision(
  message: string,
  source: string,
): boolean {
  const precisionPatterns = [
    /\b(?:tomorrow|tonight|later\s+today|this\s+(?:afternoon|evening)|next\s+(?:week|business\s+day|working\s+day|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gi,
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi,
    /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g,
    /\b(?:noon|midnight)\b/gi,
    /\b(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+o(?:['’])?clock\b/gi,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/gi,
  ];
  const normalizedSource = normalizeForComparison(source);
  const precisionClaims = precisionPatterns.flatMap((pattern) =>
    Array.from(message.matchAll(pattern), (match) =>
      normalizeForComparison(match[0]),
    ),
  );
  const bareClockClaims = Array.from(
    message.matchAll(
      /\b(?:at|by|around)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?!\s*(?::\d{2}|a\.?m\.?|p\.?m\.?|o(?:['’])?clock))/gi,
    ),
    (match) => normalizeForComparison(match[1]),
  );

  return [...precisionClaims, ...bareClockClaims].some(
    (claim) => claim && !normalizedSource.includes(claim),
  );
}

function extractResponseWindowSignatures(value: string): string[] {
  const matches = value.matchAll(
    /\b(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:business\s+)?(hours?|hrs?|days?)\b/gi,
  );
  return Array.from(matches, (match) => {
    const unit = match[3].toLowerCase().startsWith("d") ? "day" : "hour";
    return `${match[1]}-${match[2]}-${unit}`;
  });
}

function isSourceApplicableToDay(
  source: string,
  applicableDayType: RenderedContactTimingAssessment["applicableDayType"],
): boolean {
  const mentionsWeekend = /\bweekends?\b/i.test(source);
  const mentionsHoliday = /\b(?:public\s+)?holidays?\b/i.test(source);
  const mentionsBusinessDay =
    /\b(?:business|working)\s+days?\b|\bweekdays?\b|\bmon(?:day)?\s*(?:-|–|to|through)\s*fri(?:day)?\b/i.test(
      source,
    );

  if (!mentionsWeekend && !mentionsHoliday && !mentionsBusinessDay) {
    return true;
  }

  if (applicableDayType === "weekend") return mentionsWeekend;
  if (applicableDayType === "public_holiday") return mentionsHoliday;
  if (applicableDayType === "business_day") return mentionsBusinessDay;
  return false;
}

function formatLocation(location: ContactTimingLocation): string {
  const parts = [location.city, location.region, location.country].filter(
    (part): part is string => Boolean(part?.trim()),
  );
  return parts.length > 0 ? parts.join(", ") : "Not available";
}

function buildRenderContactTimingPrompt(
  params: RenderContactTimingParams,
): string {
  const workingHours = params.workingHours?.trim() || "Not configured";
  const avgResponseTime =
    params.avgResponseTime?.trim() || "Not configured";
  const companyContext = params.companyContext?.trim() || "Not available";
  const visitorTimezone = params.visitorLocation.timezone?.trim() || "Not available";

  return `Write one or two short, natural sentences telling a support visitor what to expect from the human team.

Current UTC date and time: ${new Date(params.nowMs).toISOString()}
Visitor timezone: ${visitorTimezone}
Visitor location: ${formatLocation(params.visitorLocation)}
Company context: ${companyContext}
Configured working hours: ${workingHours}
Configured typical response time: ${avgResponseTime}
Visitor's current message: ${params.currentMessage}

Rules:
- Determine today's local date and weekday using the timezone stated in the team's configured working hours. If none is stated, use the visitor timezone. Use UTC only when neither is available.
- Use the configured working hours and typical response time as authoritative.
- First decide whether the team is operating normally today, may be slower than usual, is off today, or cannot be determined from the configuration.
- If the response-time setting contains business-day and weekend or holiday windows, select exactly one applicable response window for today. A configured weekend or holiday response window means replies are expected, even when regular working hours exclude that day, so describe the team as slower rather than off unless the configuration explicitly says no replies are handled.
- When the team is operating normally, give only the useful expectation, for example: "You can expect a reply within 2-4 hours." Do not announce that the team is available today.
- When replies are expected but slower, explain that naturally and then give the applicable expectation, for example: "Today is Saturday, so the team may be a little slower than usual. You can expect a reply within 8-12 hours."
- When the team is off, say so and communicate the clearest supported expectation. Calculate the next working day or time only when it follows reliably from the configured schedule, for example: "The team is off today and will be back Monday. You can expect a reply after they return." If the return time cannot be calculated, say they should get back to the visitor when they are back.
- Only claim a public holiday when the company location is explicit and you can determine the holiday reliably. Otherwise classify today using the weekday and configured schedule.
- If availability or timing cannot be determined reliably, write exactly: "The team should get back to you as soon as possible."
- Treat the examples as guidance, not fixed templates. Use natural wording that fits the actual situation and avoids unnecessary explanation.
- Do not repeat the working-hours schedule, do not list multiple response windows, do not greet the visitor, and do not mention that the inquiry was flagged.
- Do not use an em dash.
- For expectationSource, copy the shortest verbatim excerpt from the configured working hours or typical response time that supports the expectation you wrote. Use null only for the exact unknown fallback.

After writing the sentence, set every self-report field honestly.`;
}

export async function renderContactTimingMessage(
  model: LanguageModel,
  params: RenderContactTimingParams,
  options?: { throwOnModelError?: boolean; abortSignal?: AbortSignal },
): Promise<string> {
  if (!params.avgResponseTime?.trim() && !params.workingHours?.trim()) {
    return fallbackRenderContactTimingMessage();
  }

  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: renderContactTimingSchema }),
      prompt: buildRenderContactTimingPrompt(params),
      temperature: 0.1,
      maxOutputTokens: 512,
      abortSignal: options?.abortSignal,
    });

    if (!output) {
      const error = new Error("model did not produce a valid structured output");
      error.name = "AI_NoObjectGeneratedError";
      throw error;
    }

    const message = output.message.trim();
    if (
      message &&
      isRenderedContactTimingMessageValid(output, {
        workingHours: params.workingHours,
        avgResponseTime: params.avgResponseTime,
      })
    ) {
      return message;
    }
    return fallbackRenderContactTimingMessage();
  } catch (error) {
    if (options?.throwOnModelError === true) throw error;
    return fallbackRenderContactTimingMessage();
  }
}

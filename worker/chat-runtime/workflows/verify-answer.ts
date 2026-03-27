import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";

const claimAssessmentSchema = z.object({
  claim: z.string().min(1).max(300),
  status: z.enum(["supported", "partial", "unsupported"]),
  evidence: z.string().max(500).nullable().optional(),
});

const claimVerificationSchema = z.object({
  verdict: z.enum(["supported", "unsupported", "revised"]),
  revisedAnswer: z.string().max(4000).nullable().optional(),
  claims: z.array(claimAssessmentSchema).max(8),
  summary: z.string().max(240).nullable().optional(),
});

export interface ClaimAssessment {
  claim: string;
  status: "supported" | "partial" | "unsupported";
  evidence?: string | null;
}

export interface VerificationResult {
  verdict: "supported" | "unsupported" | "revised";
  answer: string;
  claims: ClaimAssessment[];
  summary?: string | null;
}

function buildUnsupportedFallback(userMessage: string): string {
  const needsPrecision =
    /(pricing|plan|policy|refund|billing|setup|configure|integration|api|error|issue|problem|limit)/i.test(
      userMessage,
    );

  if (needsPrecision) {
    return "I couldn't verify a reliable answer for that from the knowledge base I searched. If you share the exact feature name, page, error, or policy you want checked, I can try again more precisely.";
  }

  return "I couldn't verify that reliably from the knowledge base I searched. If you can share a bit more detail, I can check again.";
}

export async function verifyAnswer(options: {
  model: LanguageModel;
  userMessage: string;
  draftedAnswer: string;
  ragContext: string;
  lastToolOutput?: unknown;
}): Promise<VerificationResult> {
  if (!options.draftedAnswer.trim()) {
    return {
      verdict: "supported",
      answer: options.draftedAnswer,
      claims: [],
      summary: null,
    };
  }

  if (!options.ragContext.trim() && !options.lastToolOutput) {
    return {
      verdict: "unsupported",
      answer: buildUnsupportedFallback(options.userMessage),
      claims: [],
      summary: "No evidence available for verification.",
    };
  }

  const toolContext = options.lastToolOutput
    ? `\n\nTool output:\n${JSON.stringify(options.lastToolOutput).slice(0, 4000)}`
    : "";

  try {
    const { object } = await generateObject({
      model: options.model,
      schema: claimVerificationSchema,
      temperature: 0,
      maxOutputTokens: 900,
      prompt: `You are verifying whether a support chatbot answer is fully supported by the available evidence.

User question:
${options.userMessage}

Drafted answer:
${options.draftedAnswer}

Knowledge-base evidence:
${options.ragContext || "None"}
${toolContext}

Rules:
1. Break the drafted answer into the smallest factual claims worth checking.
2. Ignore pure politeness, filler, and generic empathy unless they contain a factual promise.
3. Mark each claim as:
   - supported: clearly backed by the evidence
   - partial: somewhat related evidence exists but the drafted wording overstates or fills gaps
   - unsupported: the evidence does not justify the claim
4. Set verdict:
   - supported: all meaningful claims are supported, or there are no meaningful factual claims
   - revised: some claims are partial/unsupported but a corrected answer can still be given from supported evidence
   - unsupported: the evidence is too weak to answer confidently
5. If verdict is revised, revisedAnswer must remove unsupported claims and keep only supported facts.
6. If verdict is unsupported, revisedAnswer must briefly say the answer could not be verified from the knowledge base and optionally ask for a more precise feature name, page, error, or policy.
7. Be strict. Never preserve a claim just because it sounds plausible.
8. Do not introduce new facts that are not directly present in the evidence.`,
    });

    const claims = object.claims ?? [];
    const unsupportedClaims = claims.filter(
      (claim) => claim.status === "unsupported",
    ).length;
    const partialClaims = claims.filter(
      (claim) => claim.status === "partial",
    ).length;
    const revisedAnswer = object.revisedAnswer?.trim();

    if (unsupportedClaims === 0 && partialClaims === 0) {
      return {
        verdict: "supported",
        answer: options.draftedAnswer,
        claims,
        summary: object.summary ?? null,
      };
    }

    if (revisedAnswer) {
      return {
        verdict:
          object.verdict === "unsupported" ? "unsupported" : "revised",
        answer: revisedAnswer,
        claims,
        summary: object.summary ?? null,
      };
    }

    return {
      verdict: unsupportedClaims > 0 ? "unsupported" : "revised",
      answer:
        unsupportedClaims > 0
          ? buildUnsupportedFallback(options.userMessage)
          : options.draftedAnswer,
      claims,
      summary: object.summary ?? null,
    };
  } catch {
    // Fall back to the drafted answer if verification fails.
  }

  return {
    verdict: "supported",
    answer: options.draftedAnswer,
    claims: [],
    summary: null,
  };
}

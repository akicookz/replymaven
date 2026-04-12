export type InquiryRefinementSignal =
  | "email"
  | "phone"
  | "name"
  | "freeform"
  | "none";

export interface InquiryFieldSpec {
  label: string;
  type: string;
  required: boolean;
}

export interface InquiryRefinementDecision {
  isRefinement: boolean;
  signals: InquiryRefinementSignal[];
  extracted: Record<string, string>;
  reason: string;
}

export interface ClassifyInquiryRefinementInput {
  message: string;
  inquiryFields: InquiryFieldSpec[];
  existingData: Record<string, string>;
  hasExistingInquiry: boolean;
}

const EMAIL_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

const PHONE_PATTERN =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/;

const NAME_INTRO_REGEX =
  /\b(?:my\s+name\s+is|i\s*am|i'm|this\s+is|call\s+me)\s+([A-Za-z][a-z]+(?:\s+[A-Z][a-z]+)?)/i;
const NAME_STANDALONE_REGEX = /^\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+))\s*$/;

function extractEmail(message: string): string | null {
  const match = message.match(EMAIL_PATTERN);
  return match ? match[0] : null;
}

function extractPhone(message: string): string | null {
  const match = message.match(PHONE_PATTERN);
  if (!match) return null;
  const digitCount = match[0].replace(/\D/g, "").length;
  if (digitCount < 7 || digitCount > 15) return null;
  return match[0].trim();
}

function extractName(message: string): string | null {
  const introMatch = message.match(NAME_INTRO_REGEX);
  if (introMatch?.[1]) {
    const raw = introMatch[1].trim();
    const words = raw.split(/\s+/);
    const kept: string[] = [];
    for (const word of words) {
      const first = word.charAt(0);
      if (kept.length === 0) {
        kept.push(first.toUpperCase() + word.slice(1));
      } else if (first >= "A" && first <= "Z") {
        kept.push(word);
      } else {
        break;
      }
    }
    return kept.join(" ");
  }
  const standaloneMatch = message.match(NAME_STANDALONE_REGEX);
  if (standaloneMatch?.[1]) return standaloneMatch[1].trim();
  return null;
}

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findFieldKey(
  fields: InquiryFieldSpec[],
  candidates: string[],
): string | null {
  for (const field of fields) {
    const normalized = normalizeLabel(field.label);
    if (candidates.some((candidate) => normalized.includes(candidate))) {
      return field.label;
    }
  }
  return null;
}

export function classifyInquiryRefinement(
  input: ClassifyInquiryRefinementInput,
): InquiryRefinementDecision {
  if (!input.hasExistingInquiry) {
    return {
      isRefinement: false,
      signals: [],
      extracted: {},
      reason: "no_existing_inquiry",
    };
  }

  const trimmed = input.message.trim();
  if (!trimmed) {
    return {
      isRefinement: false,
      signals: [],
      extracted: {},
      reason: "empty_message",
    };
  }

  const signals: InquiryRefinementSignal[] = [];
  const extracted: Record<string, string> = {};
  let structuredSignalSeen = false;

  const email = extractEmail(trimmed);
  if (email) {
    structuredSignalSeen = true;
    const fieldKey =
      findFieldKey(input.inquiryFields, ["email", "mail"]) ?? "email";
    if (input.existingData[fieldKey] !== email) {
      extracted[fieldKey] = email;
      signals.push("email");
    }
  }

  const phone = extractPhone(trimmed);
  if (phone) {
    const fieldKey = findFieldKey(input.inquiryFields, [
      "phone",
      "mobile",
      "tel",
      "cell",
      "whatsapp",
    ]);
    if (fieldKey) {
      structuredSignalSeen = true;
      if (input.existingData[fieldKey] !== phone) {
        extracted[fieldKey] = phone;
        signals.push("phone");
      }
    }
  }

  const name = extractName(trimmed);
  if (name) {
    const fieldKey =
      findFieldKey(input.inquiryFields, ["name", "fullname", "firstname"]) ??
      null;
    if (fieldKey) {
      structuredSignalSeen = true;
      if (input.existingData[fieldKey] !== name) {
        extracted[fieldKey] = name;
        signals.push("name");
      }
    }
  }

  if (signals.length === 0 && !structuredSignalSeen) {
    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount >= 3) {
      const topicField = findFieldKey(input.inquiryFields, [
        "topic",
        "subject",
        "question",
        "issue",
        "message",
        "details",
        "describe",
        "notes",
      ]);
      if (topicField && input.existingData[topicField] !== trimmed) {
        extracted[topicField] = trimmed;
        signals.push("freeform");
      }
    }
  }

  if (signals.length === 0) {
    return {
      isRefinement: false,
      signals: [],
      extracted: {},
      reason: "no_refinement_signal_detected",
    };
  }

  return {
    isRefinement: true,
    signals,
    extracted,
    reason: `refinement_detected:${signals.join(",")}`,
  };
}

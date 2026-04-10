import { type ConversationChatState } from "../types";

export type FastPathKind =
  | "escalation"
  | "loop_breaker"
  | "greeting"
  | "resolved"
  | "none";

export interface FastPathResult {
  kind: FastPathKind;
  reason: string;
  response?: string;
  escalate?: boolean;
  escalationReason?: string;
  stripClarificationState?: boolean;
}

const ESCALATION_PATTERNS: RegExp[] = [
  /\bescalat(e|ing|ion)\b/i,
  /\bplease\s+(escalate|forward|raise|send|pass)\b/i,
  /\b(can\s+i|let\s+me)\s+(speak|talk|chat)\s+(to|with)\s+(a\s+)?(human|person|agent|engineer|someone)\b/i,
  /\b(speak|talk|chat)\s+(to|with)\s+(a\s+)?(human|person|agent|engineer|someone|support\s+team|team\s+member|representative)\b/i,
  /\b(get|connect|put)\s+me\s+(to|with)\s+(a\s+)?(human|person|agent|engineer|someone|support\s+team|team\s+member|representative)\b/i,
  /\bi\s+(need|want)\s+(a\s+|to\s+(speak|talk)\s+to\s+(a\s+)?)(human|person|agent|engineer|someone|support\s+team|representative|real\s+person)\b/i,
  /\breal\s+(human|person|agent)\b/i,
  /\b(transfer|hand\s*off|handoff|pass)\s+me\b/i,
  /\bhuman\s+(support|agent|help)\b/i,
  /\blive\s+(agent|chat|support|person)\b/i,
  /\bcontact\s+(support|the\s+team|sales)\b/i,
  /\bfile\s+(a\s+)?(ticket|complaint|bug|issue)\b/i,
  /\bthis\s+(is\s+)?(urgent|emergency|critical)\b/i,
  /\bi\s+(need|want)\s+(this|it)\s+fixed\b/i,
  /\bcan\s+i\s+(please\s+)?get\s+this\s+(fixed|resolved|looked\s+at)\b/i,
];

const FRUSTRATION_PATTERNS: RegExp[] = [
  /\bthis\s+is\s+(ridiculous|absurd|unacceptable|pathetic|a\s+joke)\b/i,
  /\b(useless|worthless)\b/i,
  /\bwaste\s+of\s+(my\s+)?time\b/i,
  /\b(stop|quit)\s+(repeating|asking)\b/i,
  /\bi\s+already\s+(told|said|explained)\b/i,
  /\byou(\s*'re|\s+are)?\s+not\s+(helping|listening|understanding)\b/i,
  /\bnot\s+(helpful|working|answering)\b/i,
  /\b(wtf|wth|damn|dammit|bs|bullshit)\b/i,
  /\bfuck(ing)?\b/i,
];

const GREETING_PATTERNS: RegExp[] = [
  /^(hi|hello|hey|yo|sup|howdy|good\s+(morning|afternoon|evening)|greetings)[!.\s]*$/i,
  /^(hi|hello|hey)\s+there[!.\s]*$/i,
];

const RESOLVED_PATTERNS: RegExp[] = [
  /^(thanks|thank\s+you|thx|ty)[!.\s]*$/i,
  /^(thanks|thank\s+you|thx|ty)[,.!\s]+(that\s+(worked|helped|did\s+it|fixed\s+it|solved\s+it)|bye|cheers)[!.\s]*$/i,
  /^(got\s+it|perfect|great|awesome|nice|brilliant)[,.!\s]*(thanks|thank\s+you|thx|ty)?[!.\s]*$/i,
  /^(that(\s+is|\s*'s|\s+was)?\s+(all|it)\s+(i\s+needed|for\s+now))[!.\s]*$/i,
  /^(bye|goodbye|see\s+ya|cya|later)[!.\s]*$/i,
  /^(ok|okay)\s+thanks?[!.\s]*$/i,
];

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function matchAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function detectExplicitEscalation(message: string): {
  matched: boolean;
  reason: string;
} {
  const normalized = normalize(message);
  if (matchAny(normalized, ESCALATION_PATTERNS)) {
    return { matched: true, reason: "explicit_escalation_keyword" };
  }
  return { matched: false, reason: "" };
}

export function detectFrustration(message: string): boolean {
  return matchAny(normalize(message), FRUSTRATION_PATTERNS);
}

export function detectGreeting(message: string): boolean {
  const normalized = normalize(message);
  if (normalized.length > 40) return false;
  return matchAny(normalized, GREETING_PATTERNS);
}

export function detectResolved(message: string): boolean {
  const normalized = normalize(message);
  if (normalized.length > 80) return false;
  return matchAny(normalized, RESOLVED_PATTERNS);
}

export interface LoopDetectionInput {
  chatState: ConversationChatState;
  currentMessage: string;
  frustrated: boolean;
}

export function detectClarificationLoop(input: LoopDetectionInput): {
  isLooping: boolean;
  shouldEscalate: boolean;
  reason: string;
} {
  const { chatState, frustrated } = input;

  const attempts = chatState.clarificationAttempts;

  if (attempts >= 3) {
    return {
      isLooping: true,
      shouldEscalate: true,
      reason: "clarification_attempts_exhausted",
    };
  }

  if (attempts >= 2 && frustrated) {
    return {
      isLooping: true,
      shouldEscalate: true,
      reason: "clarification_with_frustration",
    };
  }

  if (frustrated) {
    return {
      isLooping: false,
      shouldEscalate: true,
      reason: "visitor_frustrated",
    };
  }

  return { isLooping: false, shouldEscalate: false, reason: "" };
}

export interface FastPathInput {
  message: string;
  chatState: ConversationChatState;
  botName: string | null;
  agentName: string | null;
  projectName: string;
  isFirstVisitorMessage: boolean;
}

function buildGreetingResponse(
  botName: string | null,
  projectName: string,
): string {
  const name = botName ?? "your support assistant";
  return `Hi! I'm ${name}, here to help with questions about ${projectName}. What can I help you with today?`;
}

function buildHandoffResponse(agentName: string | null): string {
  const label = agentName ?? "a team member";
  return `Got it — let me connect you with ${label}. I'll forward this conversation now. [HANDOFF_REQUESTED]`;
}

export function runFastPaths(input: FastPathInput): FastPathResult {
  const { message, chatState, isFirstVisitorMessage } = input;

  const frustrated = detectFrustration(message);
  const explicitEscalation = detectExplicitEscalation(message);

  if (explicitEscalation.matched) {
    return {
      kind: "escalation",
      reason: explicitEscalation.reason,
      response: buildHandoffResponse(input.agentName),
      escalate: true,
      escalationReason: explicitEscalation.reason,
      stripClarificationState: true,
    };
  }

  const loopDetection = detectClarificationLoop({
    chatState,
    currentMessage: message,
    frustrated,
  });

  if (loopDetection.shouldEscalate) {
    return {
      kind: "loop_breaker",
      reason: loopDetection.reason,
      response: buildHandoffResponse(input.agentName),
      escalate: true,
      escalationReason: loopDetection.reason,
      stripClarificationState: true,
    };
  }

  if (isFirstVisitorMessage && detectGreeting(message)) {
    return {
      kind: "greeting",
      reason: "first_message_greeting",
      response: buildGreetingResponse(input.botName, input.projectName),
    };
  }

  if (detectResolved(message)) {
    return {
      kind: "resolved",
      reason: "visitor_signaled_resolution",
      response: "[RESOLVED]",
    };
  }

  return { kind: "none", reason: "" };
}

export function normalizeClarificationQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function clarificationWasAskedBefore(
  chatState: ConversationChatState,
  proposedQuestion: string,
): boolean {
  const normalized = normalizeClarificationQuestion(proposedQuestion);
  if (!normalized) return false;
  return chatState.askedClarifications.some((prior) => {
    const priorNormalized = normalizeClarificationQuestion(prior);
    if (priorNormalized === normalized) return true;
    if (
      priorNormalized.length > 10 &&
      normalized.length > 10 &&
      (priorNormalized.includes(normalized) ||
        normalized.includes(priorNormalized))
    ) {
      return true;
    }
    return false;
  });
}

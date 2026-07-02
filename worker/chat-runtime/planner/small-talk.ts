// Deterministic detector for messages that never need evidence or an LLM
// planner step. Deliberately strict: only fires when the ENTIRE message is a
// greeting or a resolution signal — "hi, my widget is broken" must not match.
export type SmallTalkKind = "greeting" | "resolution";

const GREETING_RE =
  /^(hi|hii+|hello|hey|hey there|hi there|hello there|howdy|yo|good (morning|afternoon|evening))[!.,\s]*$/i;

const RESOLUTION_RE =
  /^(thanks( a lot| so much)?|thank you( so much| very much)?|thx|ty|got it([!.,\s]+thanks)?|that worked|perfect([!.,\s]+thanks)?|great([!.,\s]+thanks)?|awesome([!.,\s]+thanks)?|all good|ok(ay)? (thanks|got it)|no worries|never ?mind|(good)?bye|see you|that('s| is) all( i needed)?)[!.,\s]*$/i;

export function detectSmallTalk(message: string): SmallTalkKind | null {
  const normalized = message.trim();
  if (!normalized || normalized.length > 60) return null;
  if (GREETING_RE.test(normalized)) return "greeting";
  if (RESOLUTION_RE.test(normalized)) return "resolution";
  return null;
}

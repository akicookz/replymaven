const TRAILING_SOLICITATION_PATTERNS = [
  /\bwould you like (?:me|to)\b/i,
  /\bdo you want (?:me|to)\b/i,
  /\bwant me to\b/i,
  /\bif you'd like,?\s+i can\b/i,
  /\bif you want,?\s+i can\b/i,
  /\blet me know if you'd like\b/i,
  /\bi can also\b[\s\S]{0,120}\bif you'd like\b/i,
];

export function stripTrailingSolicitedFollowUp(response: string): string {
  const trimmed = response.trim();
  if (!trimmed) {
    return trimmed;
  }

  const searchStart = Math.max(0, trimmed.length - 280);
  const tail = trimmed.slice(searchStart);

  let earliestMatchIndex = -1;
  for (const pattern of TRAILING_SOLICITATION_PATTERNS) {
    const match = pattern.exec(tail);
    if (!match || match.index === undefined) {
      continue;
    }

    if (earliestMatchIndex === -1 || match.index < earliestMatchIndex) {
      earliestMatchIndex = match.index;
    }
  }

  if (earliestMatchIndex === -1) {
    return trimmed;
  }

  const absoluteIndex = searchStart + earliestMatchIndex;
  const stripped = trimmed.slice(0, absoluteIndex).trimEnd();

  return stripped || trimmed;
}

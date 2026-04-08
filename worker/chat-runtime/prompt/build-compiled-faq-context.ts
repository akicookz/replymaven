interface FaqLikeResource {
  title: string;
  content: string | null;
}

interface FaqPair {
  question?: string;
  answer?: string;
}

const MAX_COMPILED_FAQ_CHARS = 12_000;

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function parseFaqPairs(content: string | null): Array<{ question: string; answer: string }> {
  if (!content) {
    return [];
  }

  try {
    const parsed = JSON.parse(content) as FaqPair[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((pair) => {
      const question =
        typeof pair.question === "string" ? normalizeWhitespace(pair.question) : "";
      const answer =
        typeof pair.answer === "string" ? normalizeWhitespace(pair.answer) : "";

      if (!question || !answer) {
        return [];
      }

      return [{ question, answer }];
    });
  } catch {
    return [];
  }
}

function formatFaqSection(
  resource: FaqLikeResource,
  seenEntries: Set<string>,
): string | null {
  const pairs = parseFaqPairs(resource.content);
  if (pairs.length > 0) {
    const lines = pairs.flatMap((pair) => {
      const dedupeKey = `${pair.question}::${pair.answer}`;
      if (seenEntries.has(dedupeKey)) {
        return [];
      }

      seenEntries.add(dedupeKey);
      return [`- Q: ${pair.question}\n  A: ${pair.answer}`];
    });

    if (lines.length === 0) {
      return null;
    }

    return `FAQ: ${resource.title}\n${lines.join("\n")}`;
  }

  const rawContent = normalizeWhitespace(resource.content ?? "");
  if (!rawContent) {
    return null;
  }

  const dedupeKey = `${resource.title}::${rawContent}`;
  if (seenEntries.has(dedupeKey)) {
    return null;
  }

  seenEntries.add(dedupeKey);
  return `FAQ: ${resource.title}\n${rawContent}`;
}

export function buildCompiledFaqContext(
  faqResources: FaqLikeResource[],
): string {
  const sections: string[] = [];
  const seenEntries = new Set<string>();
  let totalChars = 0;

  for (const resource of faqResources) {
    const section = formatFaqSection(resource, seenEntries);
    if (!section) {
      continue;
    }

    const nextLength = totalChars === 0 ? section.length : totalChars + 2 + section.length;
    if (nextLength > MAX_COMPILED_FAQ_CHARS) {
      break;
    }

    sections.push(section);
    totalChars = nextLength;
  }

  return sections.join("\n\n");
}

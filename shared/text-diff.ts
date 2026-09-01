import { diffLines, diffWords } from "diff";

export type DiffSpanKind = "equal" | "add" | "remove";

export interface DiffSpan {
  kind: DiffSpanKind;
  text: string;
}

export type DiffLineKind = "equal" | "add" | "remove" | "change";

export interface DiffLine {
  kind: DiffLineKind;
  spans: DiffSpan[];
}

function splitLines(value: string): string[] {
  if (value.length === 0) return [];
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function wordSpans(before: string, after: string): DiffSpan[] {
  return (diffWords(before, after) ?? []).map((part) => {
    if (part.added) return { kind: "add", text: part.value };
    if (part.removed) return { kind: "remove", text: part.value };
    return { kind: "equal", text: part.value };
  });
}

function lineKind(spans: DiffSpan[]): DiffLineKind {
  const hasAdd = spans.some((span) => span.kind === "add");
  const hasRemove = spans.some((span) => span.kind === "remove");
  if (hasAdd && hasRemove) return "change";
  if (hasAdd) return "add";
  if (hasRemove) return "remove";
  return "equal";
}

export function diffKnowledgeText(before: string, after: string): DiffLine[] {
  const changes = diffLines(before, after) ?? [];
  const lines: DiffLine[] = [];

  for (let index = 0; index < changes.length; index += 1) {
    const current = changes[index];
    const next = changes[index + 1];
    if (!current) continue;

    if (current.removed && next?.added) {
      const removedLines = splitLines(current.value);
      const addedLines = splitLines(next.value);
      const paired = Math.min(removedLines.length, addedLines.length);
      for (let pairIndex = 0; pairIndex < paired; pairIndex += 1) {
        const spans = wordSpans(
          removedLines[pairIndex] ?? "",
          addedLines[pairIndex] ?? "",
        );
        lines.push({ kind: lineKind(spans), spans });
      }
      for (let extra = paired; extra < removedLines.length; extra += 1) {
        lines.push({
          kind: "remove",
          spans: [{ kind: "remove", text: removedLines[extra] ?? "" }],
        });
      }
      for (let extra = paired; extra < addedLines.length; extra += 1) {
        lines.push({
          kind: "add",
          spans: [{ kind: "add", text: addedLines[extra] ?? "" }],
        });
      }
      index += 1;
      continue;
    }

    if (current.added) {
      for (const text of splitLines(current.value)) {
        lines.push({ kind: "add", spans: [{ kind: "add", text }] });
      }
      continue;
    }

    if (current.removed) {
      for (const text of splitLines(current.value)) {
        lines.push({ kind: "remove", spans: [{ kind: "remove", text }] });
      }
      continue;
    }

    for (const text of splitLines(current.value)) {
      lines.push({ kind: "equal", spans: [{ kind: "equal", text }] });
    }
  }

  return lines;
}

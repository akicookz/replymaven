import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

  html = html.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "<em>$1</em>");
  html = html.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<em>$1</em>");

  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 hover:opacity-70">$1</a>',
  );

  const linkPlaceholders: string[] = [];
  html = html.replace(/<a\s[^>]*>.*?<\/a>/g, (match) => {
    linkPlaceholders.push(match);
    return `%%LINK${linkPlaceholders.length - 1}%%`;
  });
  html = html.replace(
    /(https?:\/\/[^\s<)]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 hover:opacity-70">$1</a>',
  );
  html = html.replace(
    /%%LINK(\d+)%%/g,
    (_, i) => linkPlaceholders[Number(i)],
  );

  const lines = html.split("\n");
  const output: string[] = [];
  let inUl = false;
  let inOl = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    const ulMatch = line.match(/^[\s]*[-*]\s+(.*)/);
    const olMatch = line.match(/^[\s]*\d+[.)]\s+(.*)/);

    if (headingMatch) {
      if (inUl) { output.push("</ul>"); inUl = false; }
      if (inOl) { output.push("</ol>"); inOl = false; }
      const level = headingMatch[1].length;
      output.push(`<h${level}>${headingMatch[2]}</h${level}>`);
    } else if (ulMatch) {
      if (inOl) { output.push("</ol>"); inOl = false; }
      if (!inUl) { output.push("<ul>"); inUl = true; }
      output.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (inUl) { output.push("</ul>"); inUl = false; }
      if (!inOl) { output.push("<ol>"); inOl = true; }
      output.push(`<li>${olMatch[1]}</li>`);
    } else {
      if (inUl) { output.push("</ul>"); inUl = false; }
      if (inOl) { output.push("</ol>"); inOl = false; }
      const trimmed = line.trim();
      if (trimmed === "") continue;
      output.push(trimmed);
    }
  }
  if (inUl) output.push("</ul>");
  if (inOl) output.push("</ol>");

  const result: string[] = [];
  let paragraphLines: string[] = [];

  function flushParagraph() {
    if (paragraphLines.length > 0) {
      result.push(`<p>${paragraphLines.join("<br>")}</p>`);
      paragraphLines = [];
    }
  }

  for (const item of output) {
    if (
      item.startsWith("<h") ||
      item.startsWith("<ul>") ||
      item.startsWith("</ul>") ||
      item.startsWith("<ol>") ||
      item.startsWith("</ol>") ||
      item.startsWith("<li>")
    ) {
      flushParagraph();
      result.push(item);
    } else {
      paragraphLines.push(item);
    }
  }
  flushParagraph();

  return result.join("");
}

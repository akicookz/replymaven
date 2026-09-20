// Gmail wraps the attribution line, so "wrote:" can land several lines below
// the "On <date>, <name> <address>" it belongs to. Rejoining the next few lines
// before matching is what makes quote stripping fire at all.
const ATTRIBUTION_LOOKAHEAD = 3;
const ATTRIBUTION = /^On\b.+\bwrote:$/i;
const ORIGINAL_MESSAGE = /^-{2,}\s*Original Message/i;
const UNDERSCORE_RULE = /^_{2,}$/;
const SIGNATURE_DELIMITER = /^-- $/;

// Disclaimers run for several lines, so a match anchors the cut and everything
// below it goes. Only the tail is searched: "this email" appears in ordinary
// prose too, and cutting a real answer in half is worse than keeping a footer.
const LEGAL_BOILERPLATE =
  /^(this (e-?mail|message)|confidentiality notice|the information in this|please consider the environment|disclaimer:)/i;
const LEGAL_BOILERPLATE_TAIL_LINES = 15;

function startsAttribution(lines: string[], index: number): boolean {
  for (let span = 1; span <= ATTRIBUTION_LOOKAHEAD; span++) {
    const joined = lines
      .slice(index, index + span)
      .map((line) => line.trim())
      .join(" ")
      .trim();
    if (ATTRIBUTION.test(joined)) return true;
  }
  return false;
}

function stripQuotedReply(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (ORIGINAL_MESSAGE.test(trimmed)) break;
    if (UNDERSCORE_RULE.test(trimmed)) break;
    if (startsAttribution(lines, index)) break;
    if (trimmed.startsWith(">")) continue;
    kept.push(lines[index]);
  }
  return kept.join("\n").trim();
}

function stripSignature(text: string): string {
  const lines = text.split("\n");
  const delimiter = lines.findIndex((line) => SIGNATURE_DELIMITER.test(line));
  const body = delimiter >= 0 ? lines.slice(0, delimiter) : lines;

  const tailStart = Math.max(0, body.length - LEGAL_BOILERPLATE_TAIL_LINES);
  let cut = body.length;
  for (let index = body.length - 1; index >= tailStart; index--) {
    if (LEGAL_BOILERPLATE.test(body[index].trim())) cut = index;
  }
  return body.slice(0, cut).join("\n").trim();
}

export function cleanInboundEmailText(text: string): string {
  return stripSignature(stripQuotedReply(text));
}

// Inbound HTML comes from arbitrary senders, so entity handling has to cover
// numeric escapes as well as the named ones our own templates emit.
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
};

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(
      /&([a-z]+);/gi,
      (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match,
    )
    .trim();
}

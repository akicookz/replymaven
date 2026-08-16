import { describe, expect, test } from "bun:test";
import { HELP_ICON_NAMES, HELP_ICON_SVGS } from "./help-icons";

// Lucide export names whose source file is not the kebab-cased name.
const FILE_OVERRIDES: Record<string, string> = {
  BarChart: "chart-no-axes-column-increasing",
  CircleHelp: "circle-question-mark",
  Fingerprint: "fingerprint-pattern",
};

function iconFile(name: string): string {
  return (
    FILE_OVERRIDES[name] ??
      name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()
  );
}

function serialize(
  iconNode: Array<[string, Record<string, unknown>]>,
): string {
  const inner = iconNode
    .map(([tag, attrs]) => {
      const attrStr = Object.entries(attrs)
        .filter(([key]) => key !== "key")
        .map(([key, value]) => `${key}="${value}"`)
        .join(" ");
      return `<${tag} ${attrStr}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

describe("help icon map", () => {
  test("every entry matches the installed lucide markup", async () => {
    for (const name of HELP_ICON_NAMES) {
      const mod = (await import(
        `lucide-react/dist/esm/icons/${iconFile(name)}.js`
      )) as { __iconNode: Array<[string, Record<string, unknown>]> };
      expect(HELP_ICON_SVGS[name]).toBe(serialize(mod.__iconNode));
    }
  });
});

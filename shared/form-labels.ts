// Widget calls and server submission validation must derive the same identifiers.
export function formLabelSlug(label: string): string {
  return label.normalize("NFKC").trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function contactFormLabels(
  actions: ReadonlyArray<{ type: string; label: string }>,
): string[] {
  const labels = actions.filter((action) => action.type === "inquiry")
    .map((action) => action.label);
  return labels.length > 0 ? [...new Set(labels)] : ["Contact form"];
}

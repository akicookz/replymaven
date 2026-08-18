export function findCustomCssViolation(css: string): string | null {
  if (/<\/style/i.test(css)) return "CSS cannot close a style tag";
  if (/<script/i.test(css)) return "CSS cannot contain script tags";
  if (/javascript\s*:/i.test(css)) return "CSS cannot use javascript: URLs";
  if (/expression\s*\(/i.test(css)) return "CSS cannot use expression()";
  if (/behavior\s*:/i.test(css)) return "CSS cannot use behavior";
  if (/-moz-binding/i.test(css)) return "CSS cannot use -moz-binding";
  if (/@import/i.test(css)) return "CSS cannot use @import";
  if (/url\s*\(/i.test(css)) return "CSS cannot use url()";
  return null;
}

export function sanitizeCustomCss(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (findCustomCssViolation(trimmed)) return null;
  return trimmed.replace(/</g, "");
}

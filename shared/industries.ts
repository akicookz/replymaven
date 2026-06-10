// Single source of truth for industry options. Used by the onboarding UI
// and by the worker's AI company-profile extraction.

export const INDUSTRIES = [
  "SaaS",
  "E-commerce",
  "Healthcare",
  "Education",
  "Real Estate",
  "Finance & Banking",
  "Agency & Consulting",
  "Restaurant & Food",
  "Travel & Hospitality",
  "Fitness & Wellness",
  "Legal",
  "Non-profit",
  "Media & Entertainment",
  "Retail",
  "Technology",
  "Other",
] as const;

export type Industry = (typeof INDUSTRIES)[number];

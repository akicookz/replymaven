import { describe, expect, test } from "bun:test";
import {
  EXTRA_SEAT_PRICE_USD,
  FEATURE_LABELS,
  MESSAGE_PACKS,
  PLANS,
  hasFeature,
  isPlanId,
  knowledgePagesForChars,
  parseLimitOverrides,
  planLimit,
  planLimits,
  pricingFeatures,
} from "./plans";

describe("plan catalog", () => {
  test("self-serve prices and limits match the PRD", () => {
    expect(PLANS.business.monthlyPriceUsd).toBe(49);
    expect(PLANS.business.limits).toEqual({
      aiMessagesPerMonth: 500,
      seats: 3,
      projects: 5,
      knowledgePages: 1_000,
    });
    expect(PLANS.enterprise.selfServe).toBe(false);
    expect(EXTRA_SEAT_PRICE_USD).toEqual({ monthly: 19, annual: 190 });
  });

  test("every plan includes custom CSS and the self-serve features", () => {
    for (const plan of ["business", "enterprise"] as const) {
      expect(hasFeature(plan, "custom_css")).toBe(true);
      expect(hasFeature(plan, "sidechat")).toBe(true);
    }
  });

  test("tiered features stay on their tiers", () => {
    expect(hasFeature("business", "priority_support")).toBe(false);
    expect(hasFeature("enterprise", "priority_support")).toBe(true);
    expect(hasFeature("business", "sso")).toBe(false);
    expect(hasFeature("enterprise", "sso")).toBe(true);
  });

  test("every feature has a label", () => {
    for (const plan of Object.values(PLANS)) {
      for (const key of plan.features) expect(FEATURE_LABELS[key]).toBeDefined();
    }
  });

  test("packs match the PRD", () => {
    expect(MESSAGE_PACKS.map((p) => [p.messages, p.priceUsd])).toEqual([
      [500, 50],
      [1_100, 100],
      [5_500, 500],
    ]);
  });
});

describe("planLimit", () => {
  test("overrides apply to Enterprise only", () => {
    expect(planLimit("enterprise", "seats", { seats: 25 })).toBe(25);
    expect(planLimit("business", "seats", { seats: 25 })).toBe(3);
  });

  test("missing Enterprise override falls back to the catalog", () => {
    expect(planLimit("enterprise", "projects", { seats: 25 })).toBeNull();
  });

  test("planLimits combines every key", () => {
    expect(planLimits("enterprise", { aiMessagesPerMonth: 20_000 })).toEqual({
      aiMessagesPerMonth: 20_000,
      seats: null,
      projects: null,
      knowledgePages: null,
    });
  });
});

describe("helpers", () => {
  test("pricingFeatures lists what a tier adds", () => {
    expect(pricingFeatures("business")).toContain("widget");
    expect(pricingFeatures("enterprise")).toContain("sso");
    expect(pricingFeatures("enterprise")).toContain("priority_support");
  });

  test("knowledge pages round up per item", () => {
    expect(knowledgePagesForChars(0)).toBe(0);
    expect(knowledgePagesForChars(1)).toBe(1);
    expect(knowledgePagesForChars(2_500)).toBe(1);
    expect(knowledgePagesForChars(2_501)).toBe(2);
  });

  test("parseLimitOverrides drops bad input", () => {
    expect(parseLimitOverrides(null)).toEqual({});
    expect(parseLimitOverrides("not json")).toEqual({});
    expect(parseLimitOverrides("[1,2]")).toEqual({});
    expect(parseLimitOverrides('{"seats": 12.7, "projects": -1, "nope": 3}')).toEqual({ seats: 12 });
  });

  test("isPlanId rejects old ids", () => {
    expect(isPlanId("business")).toBe(true);
    expect(isPlanId("startup")).toBe(false);
    expect(isPlanId("starter")).toBe(false);
    expect(isPlanId("standard")).toBe(false);
  });
});

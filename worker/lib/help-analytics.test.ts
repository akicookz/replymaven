import { describe, expect, test } from "bun:test";
import {
  buildHelpAnalyticsScripts,
  helpAnalyticsCustomHost,
  parseHelpAnalytics,
  sanitizeCustomScriptSrc,
  sanitizeHelpAnalytics,
} from "./help-analytics";

const posthog = {
  provider: "posthog" as const,
  apiKey: "phc_abcdefghij1234567890",
  host: "us" as const,
};

describe("parseHelpAnalytics", () => {
  test("returns an empty list for missing or invalid JSON", () => {
    expect(parseHelpAnalytics(null)).toEqual([]);
    expect(parseHelpAnalytics("")).toEqual([]);
    expect(parseHelpAnalytics("{")).toEqual([]);
    expect(parseHelpAnalytics("{}")).toEqual([]);
  });

  test("keeps one valid embed per provider", () => {
    expect(
      parseHelpAnalytics(
        JSON.stringify([
          posthog,
          { provider: "gtag", measurementId: "G-ABC123" },
          { provider: "meta", pixelId: "1234567890" },
          { provider: "custom", src: "https://cdn.segment.com/analytics.js" },
          { provider: "posthog", apiKey: "phc_duplicatekey12", host: "eu" },
        ]),
      ),
    ).toEqual([
      posthog,
      { provider: "gtag", measurementId: "G-ABC123" },
      { provider: "meta", pixelId: "1234567890" },
      { provider: "custom", src: "https://cdn.segment.com/analytics.js" },
    ]);
  });

  test("drops XSS and incomplete rows", () => {
    expect(
      sanitizeHelpAnalytics([
        { provider: "posthog", apiKey: "phc_abc</script>", host: "us" },
        { provider: "gtag", measurementId: "GTM-HACK" },
        { provider: "meta", pixelId: "not-a-pixel" },
        { provider: "custom", src: "javascript:alert(1)" },
        { provider: "custom", src: "https://evil.example/x.js\"></script>" },
        { provider: "unknown", apiKey: "x" },
        posthog,
      ]),
    ).toEqual([posthog]);
  });
});

describe("sanitizeCustomScriptSrc", () => {
  test("accepts a clean https script URL", () => {
    expect(sanitizeCustomScriptSrc("https://plausible.io/js/script.js")).toBe(
      "https://plausible.io/js/script.js",
    );
  });

  test("rejects replymaven, credentials, IPs, and non-https", () => {
    expect(
      sanitizeCustomScriptSrc("https://replymaven.com/widget-embed.js"),
    ).toBeNull();
    expect(
      sanitizeCustomScriptSrc("https://replymaven.com./widget-embed.js"),
    ).toBeNull();
    expect(
      sanitizeCustomScriptSrc("https://user:pass@cdn.example.com/a.js"),
    ).toBeNull();
    expect(sanitizeCustomScriptSrc("http://cdn.example.com/a.js")).toBeNull();
    expect(sanitizeCustomScriptSrc("https://127.0.0.1/a.js")).toBeNull();
    expect(sanitizeCustomScriptSrc("https://localhost/a.js")).toBeNull();
  });
});

describe("helpAnalyticsCustomHost", () => {
  test("returns the saved custom host and rejects ReplyMaven hosts", () => {
    expect(helpAnalyticsCustomHost("https://docs.acme.com/docs")).toBe(
      "docs.acme.com",
    );
    expect(helpAnalyticsCustomHost("https://replymaven.com/docs")).toBeNull();
    expect(helpAnalyticsCustomHost("https://help.replymaven.com")).toBeNull();
    expect(helpAnalyticsCustomHost("https://replymaven.com.")).toBeNull();
    expect(helpAnalyticsCustomHost("https://help.replymaven.com.")).toBeNull();
    expect(helpAnalyticsCustomHost("https://docs.acme.com.")).toBe(
      "docs.acme.com",
    );
    expect(helpAnalyticsCustomHost(null)).toBeNull();
  });
});

describe("buildHelpAnalyticsScripts", () => {
  const custom = {
    provider: "custom" as const,
    src: "https://cdn.segment.com/a.js",
  };

  test("interpolates ids through JSON.stringify", () => {
    const scripts = buildHelpAnalyticsScripts(
      [
        posthog,
        { provider: "gtag", measurementId: "G-ABC123" },
        { provider: "meta", pixelId: "1234567890" },
        custom,
      ],
      { customHost: "docs.acme.com" },
    );
    const inline = scripts.map((script) => script.js).filter(Boolean).join("\n");
    expect(inline).toContain(JSON.stringify(posthog.apiKey));
    expect(inline).toContain(JSON.stringify("https://us.i.posthog.com"));
    expect(inline).toContain("disable_session_recording:true");
    expect(inline).toContain(JSON.stringify("G-ABC123"));
    expect(inline).toContain(JSON.stringify("1234567890"));
    expect(inline).not.toContain("</script>");
    expect(scripts.some((script) => script.src?.includes("G-ABC123"))).toBe(
      true,
    );
    expect(
      scripts.some((script) =>
        script.noscriptImgSrc?.includes("id=1234567890"),
      ),
    ).toBe(true);
  });

  test("loads a custom script only after location.host matches", () => {
    const scripts = buildHelpAnalyticsScripts([custom], {
      customHost: "docs.acme.com",
    });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toBeUndefined();
    expect(scripts[0]?.js).toContain("location.host!==");
    expect(scripts[0]?.js).toContain(JSON.stringify("docs.acme.com"));
    expect(scripts[0]?.js).toContain(JSON.stringify(custom.src));
    expect(scripts[0]?.js).not.toContain("</script>");
  });

  test("omits the custom loader without a non-ReplyMaven custom host", () => {
    expect(
      buildHelpAnalyticsScripts([custom], { customHost: null }),
    ).toEqual([]);
    expect(
      buildHelpAnalyticsScripts([custom], {
        customHost: helpAnalyticsCustomHost("https://replymaven.com/docs"),
      }),
    ).toEqual([]);
  });
});

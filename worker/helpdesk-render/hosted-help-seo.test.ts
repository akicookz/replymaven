import { describe, expect, test } from "bun:test";
import {
  HELP_PROXY_HEADER,
  OWN_DOCS_DISPATCH_HEADER,
  hostedHelpRedirectUrl,
  hostedHelpShouldNoindex,
  isHelpProxyPass,
  isOwnDocsDispatch,
  stripOwnDocsDispatchHeader,
} from "./hosted-help-seo";

describe("hosted help SEO", () => {
  test("strips a spoofed own-docs header on the public request", () => {
    const request = stripOwnDocsDispatchHeader(
      new Request("https://replymaven.com/help/lovablehtml", {
        headers: { [OWN_DOCS_DISPATCH_HEADER]: "1" },
      }),
    );
    expect(request.headers.get(OWN_DOCS_DISPATCH_HEADER)).toBeNull();
  });

  test("only treats replymaven + dispatch header as own docs", () => {
    const dispatched = new Request("https://replymaven.com/help/replymaven", {
      headers: { [OWN_DOCS_DISPATCH_HEADER]: "1" },
    });
    expect(isOwnDocsDispatch(dispatched, "replymaven")).toBe(true);
    expect(isOwnDocsDispatch(dispatched, "lovablehtml")).toBe(false);
    expect(
      isOwnDocsDispatch(
        new Request("https://replymaven.com/help/replymaven"),
        "replymaven",
      ),
    ).toBe(false);
  });

  test("noindexes hosted /help unless /docs dispatch or a live proxy pass", () => {
    expect(
      hostedHelpShouldNoindex({
        ownDocsDispatch: false,
        proxyPass: false,
        helpCustomUrl: null,
      }),
    ).toBe(true);
    expect(
      hostedHelpShouldNoindex({
        ownDocsDispatch: true,
        proxyPass: false,
        helpCustomUrl: "https://replymaven.com/docs",
      }),
    ).toBe(false);
    expect(
      hostedHelpShouldNoindex({
        ownDocsDispatch: false,
        proxyPass: true,
        helpCustomUrl: "https://docs.acme.com",
      }),
    ).toBe(false);
    expect(
      hostedHelpShouldNoindex({
        ownDocsDispatch: false,
        proxyPass: true,
        helpCustomUrl: null,
      }),
    ).toBe(true);
  });

  test("maps the hosted suffix onto the custom URL", () => {
    expect(
      hostedHelpRedirectUrl({
        requestUrl: "https://replymaven.com/help/lovablehtml",
        projectSlug: "lovablehtml",
        customUrl: "https://docs.acme.com",
      }),
    ).toBe("https://docs.acme.com");
    expect(
      hostedHelpRedirectUrl({
        requestUrl:
          "https://replymaven.com/help/lovablehtml/pre-rendering/setup?q=1",
        projectSlug: "lovablehtml",
        customUrl: "https://docs.acme.com/",
      }),
    ).toBe("https://docs.acme.com/pre-rendering/setup?q=1");
    expect(
      hostedHelpRedirectUrl({
        requestUrl:
          "https://replymaven.com/help/replymaven/getting-started/install-the-chat-widget",
        projectSlug: "replymaven",
        customUrl: "https://replymaven.com/docs",
      }),
    ).toBe(
      "https://replymaven.com/docs/getting-started/install-the-chat-widget",
    );
  });

  test("reads the proxy header or a matching forwarded host", () => {
    expect(
      isHelpProxyPass(new Request("https://replymaven.com/help/acme"), null),
    ).toBe(false);
    expect(
      isHelpProxyPass(
        new Request("https://replymaven.com/help/acme", {
          headers: { [HELP_PROXY_HEADER]: "1" },
        }),
        "https://docs.acme.com",
      ),
    ).toBe(true);
    expect(
      isHelpProxyPass(
        new Request("https://replymaven.com/help/acme", {
          headers: { "x-forwarded-host": "docs.acme.com" },
        }),
        "https://docs.acme.com",
      ),
    ).toBe(true);
    expect(
      isHelpProxyPass(
        new Request("https://replymaven.com/help/replymaven", {
          headers: { "x-forwarded-host": "replymaven.com" },
        }),
        "https://replymaven.com/docs",
      ),
    ).toBe(false);
  });
});

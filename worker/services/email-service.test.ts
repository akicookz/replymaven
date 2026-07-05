import { describe, expect, test } from "bun:test";
import {
  buildEmailMessageId,
  buildOtpEmailHtml,
  htmlToText,
  parseEmailMessageId,
} from "./email-service";

describe("htmlToText", () => {
  test("strips head, styles, tags, and conditional comments from a full template", () => {
    const text = htmlToText(buildOtpEmailHtml("123456"));
    expect(text).toContain("Your verification code");
    expect(text).toContain("123456");
    expect(text).toContain("— ReplyMaven Team");
    expect(text).not.toContain("<");
    expect(text).not.toContain("prefers-color-scheme");
    expect(text).not.toContain("mso");
  });

  test("converts links to 'label (url)'", () => {
    expect(
      htmlToText(
        '<p>Go to <a href="https://x.com/a" class="b">Dashboard</a> now</p>',
      ),
    ).toBe("Go to Dashboard (https://x.com/a) now");
  });

  test("keeps a bare URL when the label matches the href", () => {
    expect(htmlToText('<a href="https://x.com">https://x.com</a>')).toBe(
      "https://x.com",
    );
  });

  test("converts breaks and block ends to newlines and collapses blanks", () => {
    expect(htmlToText("<p>one</p><br/><br/><br/><p>two</p>")).toBe(
      "one\n\ntwo",
    );
  });

  test("decodes entities without double-decoding", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &amp;lt;3</p>")).toBe(
      "Tom & Jerry &lt;3",
    );
  });
});

describe("email Message-ID helpers", () => {
  const id = "01234567-89ab-cdef-0123-456789abcdef";

  test("round-trips through In-Reply-To", () => {
    expect(parseEmailMessageId(buildEmailMessageId(id))).toBe(id);
  });

  test("picks the most recent ancestor from References", () => {
    const other = "fedcba98-7654-3210-fedc-ba9876543210";
    const header = `${buildEmailMessageId(other)} ${buildEmailMessageId(id)}`;
    expect(parseEmailMessageId(header, { source: "references" })).toBe(id);
  });
});

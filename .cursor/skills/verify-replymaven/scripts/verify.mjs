#!/usr/bin/env bun
/**
 * Drive ReplyMaven's local Vite+Worker stack for verification.
 * Never starts or kills `bun run dev`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE = join(ROOT, "evidence");
const BASE = (process.env.VERIFY_BASE ?? "http://127.0.0.1:5173").replace(
  /\/$/,
  "",
);
const PLAYWRIGHT_ENTRY = join(
  process.env.HOME ?? "",
  ".preview-tools/node_modules/playwright/index.mjs",
);

const command = process.argv[2] ?? "doctor";
const target = process.argv[3];

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function fetchText(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
  return { status: res.status, body: await res.text() };
}

async function importPlaywright() {
  try {
    return await import(pathToFileURL(PLAYWRIGHT_ENTRY).href);
  } catch (error) {
    fail(
      `Playwright not found at ${PLAYWRIGHT_ENTRY}. Install with: cd ~/.preview-tools && bun install\n${error}`,
    );
  }
}

function writeEvidence(feature, name, contents) {
  const dir = join(EVIDENCE, feature);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

async function doctor() {
  const checks = [];

  const landing = await fetchText("/");
  if (landing.status !== 200) {
    fail(
      `GET ${BASE}/ -> ${landing.status}. Start the app with bun run dev (human), then retry.`,
    );
  }
  if (!landing.body.includes("Frontline support for founding teams")) {
    fail(`GET ${BASE}/ 200 but landing heading missing.`);
  }
  checks.push("GET / 200 landing");

  const docs = await fetchText("/docs");
  if (docs.status !== 200) {
    fail(
      `GET ${BASE}/docs -> ${docs.status}. Need local project slug replymaven.`,
    );
  }
  if (
    !docs.body.includes("How can we help?") &&
    !docs.body.includes("Help Center")
  ) {
    fail(`GET ${BASE}/docs 200 but help index markers missing.`);
  }
  checks.push("GET /docs 200 help");

  const testPage = await fetchText("/test-widget.html");
  if (testPage.status !== 200 || !testPage.body.includes("Widget Test Page")) {
    fail(`GET ${BASE}/test-widget.html failed (${testPage.status}).`);
  }
  checks.push("GET /test-widget.html 200");

  const configRes = await fetch(`${BASE}/api/widget/lovablehtml/config`);
  if (configRes.status !== 200) {
    fail(
      `GET ${BASE}/api/widget/lovablehtml/config -> ${configRes.status}. Need slug lovablehtml in local D1.`,
    );
  }
  const config = await configRes.json();
  if (!config.widget) {
    fail("widget config JSON missing widget object.");
  }
  checks.push(
    `GET /api/widget/lovablehtml/config 200 fontFamily=${config.widget.fontFamily ?? "unset"}`,
  );

  await importPlaywright();
  checks.push("playwright import ok");

  console.log(`doctor ok base=${BASE}`);
  for (const line of checks) console.log(`  ${line}`);
}

async function withBrowser(run) {
  const { chromium } = await importPlaywright();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  try {
    return await run(page);
  } finally {
    await browser.close();
  }
}

async function driveLanding() {
  await withBrowser(async (page) => {
    await page.goto(`${BASE}/`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page
      .getByRole("heading", { name: "Frontline support for founding teams" })
      .waitFor({ timeout: 15000 });
    mkdirSync(join(EVIDENCE, "landing"), { recursive: true });
    await page.screenshot({
      path: join(EVIDENCE, "landing", "before.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "Log in" }).click();
    await page
      .getByRole("dialog", { name: "Welcome to ReplyMaven" })
      .waitFor({ timeout: 10000 });
    const google = await page
      .getByRole("button", { name: "Continue with Google" })
      .count();
    const github = await page
      .getByRole("button", { name: "Continue with GitHub" })
      .count();
    const docsHref = await page
      .getByRole("link", { name: "Docs" })
      .getAttribute("href");
    await page.screenshot({
      path: join(EVIDENCE, "landing", "after.png"),
    });
    if (google < 1 || github < 1) {
      fail("Auth dialog missing Google or GitHub button.");
    }
    if (!docsHref || !docsHref.endsWith("/docs")) {
      fail(`Docs href was ${docsHref}`);
    }
    const notes = [
      "feature: landing-auth",
      `url: ${page.url()}`,
      "action: click Log in",
      "result: dialog Welcome to ReplyMaven",
      "buttons: Continue with Google, Continue with GitHub",
      `docs href: ${docsHref}`,
    ].join("\n");
    writeEvidence("landing", "notes.txt", notes);
    console.log(notes);
  });
}

async function driveHelp() {
  await withBrowser(async (page) => {
    await page.goto(`${BASE}/docs`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page
      .getByRole("heading", { name: "How can we help?" })
      .waitFor({ timeout: 15000 });
    mkdirSync(join(EVIDENCE, "help"), { recursive: true });
    const darkBefore = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    await page.screenshot({
      path: join(EVIDENCE, "help", "before.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "Toggle dark mode" }).click();
    const darkAfter = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    await page
      .getByRole("searchbox", { name: "Search help center" })
      .waitFor({ timeout: 5000 });

    // Rendered form action is https://replymaven.com/docs/search. Stay on the
    // local origin by opening the Worker search route directly.
    await page.goto(`${BASE}/docs/search?q=widget`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.locator(".help-search-meta").first().waitFor({ timeout: 15000 });
    const meta = await page
      .locator(".help-search-meta")
      .first()
      .evaluate((el) => (el.textContent ?? "").trim());
    await page.screenshot({
      path: join(EVIDENCE, "help", "after.png"),
      fullPage: true,
    });
    if (darkBefore === darkAfter) {
      fail(`Theme toggle did not change html.dark (was ${darkBefore}).`);
    }
    if (!page.url().includes("search") || !page.url().includes("q=widget")) {
      fail(`Search URL was ${page.url()}`);
    }
    const notes = [
      "feature: public-help",
      `url: ${page.url()}`,
      `theme dark before/after: ${darkBefore} -> ${darkAfter}`,
      `search meta: ${meta}`,
      "note: search submitted via GET /docs/search?q=widget (form action is production canonical)",
    ].join("\n");
    writeEvidence("help", "notes.txt", notes);
    console.log(notes);
  });
}

async function driveWidget() {
  await withBrowser(async (page) => {
    await page.goto(`${BASE}/test-widget.html`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page
      .getByRole("heading", { name: "Widget Test Page" })
      .waitFor({ timeout: 10000 });
    const greetingClose = page.locator(".rm-greeting-close");
    if ((await greetingClose.count()) > 0) {
      await greetingClose.first().click({ timeout: 3000 }).catch(() => {});
    }
    await page.locator(".rm-trigger").first().waitFor({ timeout: 15000 });
    mkdirSync(join(EVIDENCE, "widget"), { recursive: true });
    await page.screenshot({ path: join(EVIDENCE, "widget", "before.png") });
    await page.locator(".rm-trigger").first().click();
    await page.locator(".rm-chat-window.open").first().waitFor({ timeout: 10000 });
    const header = await page.locator(".rm-chat-window.open").first().evaluate(
      (el) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    );
    await page.screenshot({ path: join(EVIDENCE, "widget", "after.png") });
    await page.locator(".rm-trigger").first().click();
    const stillOpen = await page.locator(".rm-chat-window.open").count();
    if (stillOpen > 0) {
      fail("Widget stayed open after second trigger click.");
    }
    const notes = [
      "feature: embed-widget",
      `url: ${page.url()}`,
      "action: click .rm-trigger open then close",
      `open header snippet: ${header}`,
      "result: .rm-chat-window.open gone after close",
    ].join("\n");
    writeEvidence("widget", "notes.txt", notes);
    console.log(notes);
  });
}

function fontStackFromHelp(html) {
  return {
    sans: html.match(/--font-sans:\s*([^;]+);/)?.[1]?.trim() ?? "",
    heading: html.match(/--font-heading:\s*([^;]+);/)?.[1]?.trim() ?? "",
  };
}

function expectedStack(fontFamily) {
  if (!fontFamily || fontFamily === "system-ui") {
    return "system-ui, sans-serif";
  }
  return `"${fontFamily}", system-ui, sans-serif`;
}

async function driveFontContract() {
  const pairs = [
    {
      slug: "lovablehtml",
      helpPath: "/help/lovablehtml",
      configSlug: "lovablehtml",
    },
    { slug: "replymaven", helpPath: "/docs", configSlug: "replymaven" },
  ];
  const lines = ["feature: help-widget-font"];
  mkdirSync(join(EVIDENCE, "font-contract"), { recursive: true });

  for (const pair of pairs) {
    const configRes = await fetch(`${BASE}/api/widget/${pair.configSlug}/config`);
    if (configRes.status !== 200) {
      fail(`config ${pair.configSlug} -> ${configRes.status}`);
    }
    const config = await configRes.json();
    const family = config.widget?.fontFamily ?? "system-ui";
    const help = await fetchText(pair.helpPath);
    if (help.status !== 200) {
      fail(`help ${pair.helpPath} -> ${help.status}`);
    }
    const stacks = fontStackFromHelp(help.body);
    const expected = expectedStack(family);
    lines.push(
      `${pair.slug}: fontFamily=${family}`,
      `  --font-sans: ${stacks.sans}`,
      `  --font-heading: ${stacks.heading}`,
      `  expected: ${expected}`,
    );
    if (stacks.sans !== stacks.heading) {
      fail(`${pair.slug}: --font-sans and --font-heading differ.`);
    }
    if (stacks.sans !== expected) {
      fail(
        `${pair.slug}: --font-sans was ${stacks.sans}; expected ${expected}.`,
      );
    }
  }

  const notes = lines.join("\n");
  writeEvidence("font-contract", "notes.txt", notes);

  await withBrowser(async (page) => {
    await page.goto(`${BASE}/docs`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page
      .getByRole("heading", { name: "How can we help?" })
      .waitFor({ timeout: 15000 });
    await page.screenshot({
      path: join(EVIDENCE, "font-contract", "after.png"),
      fullPage: true,
    });
  });
  console.log(notes);
}

function cleanup() {
  console.log(`cleanup: no Vite process touched. evidence kept at ${EVIDENCE}`);
}

if (command === "doctor") {
  await doctor();
} else if (command === "drive" && target === "landing") {
  await doctor();
  await driveLanding();
} else if (command === "drive" && target === "help") {
  await doctor();
  await driveHelp();
} else if (command === "drive" && target === "widget") {
  await doctor();
  await driveWidget();
} else if (command === "drive" && target === "font-contract") {
  await doctor();
  await driveFontContract();
} else if (command === "cleanup") {
  cleanup();
} else {
  fail(
    "usage: verify.mjs doctor | drive landing|help|widget|font-contract | cleanup",
  );
}

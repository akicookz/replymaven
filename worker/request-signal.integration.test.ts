import { afterEach, expect, test } from "bun:test";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { unstable_readConfig } from "wrangler";

const cleanupWorkers: Miniflare[] = [];

afterEach(async () => {
  await Promise.all(cleanupWorkers.splice(0).map((worker) => worker.dispose()));
});

async function pollAborted(url: URL): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(new URL("/status", url));
    const status = await response.json() as { aborted: boolean };
    if (status.aborted) return true;
    await Bun.sleep(10);
  }
  return false;
}

test("the deployed compatibility config propagates inbound cancellation to Request.signal", async () => {
  const config = unstable_readConfig({ config: "wrangler.jsonc" });
  const worker = new Miniflare({
    modules: true,
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    host: "127.0.0.1",
    port: 0,
    script: `let aborted = false;

export default {
  fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/status") {
      return Response.json({ aborted });
    }

    request.signal.addEventListener("abort", () => {
      aborted = true;
    }, { once: true });

    let timer;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("ready\\n"));
        timer = setInterval(() => {
          controller.enqueue(new TextEncoder().encode("waiting\\n"));
        }, 20);
      },
      cancel() {
        clearInterval(timer);
      },
    });
    return new Response(body, {
      headers: { "Content-Type": "text/plain" },
    });
  },
};
`,
  });
  cleanupWorkers.push(worker);
  const workerUrl = await worker.ready;

  const controller = new AbortController();
  const response = await fetch(new URL("/hold", workerUrl), {
    signal: controller.signal,
  });
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();

  controller.abort(new DOMException("Client disconnected", "AbortError"));
  await reader?.read().catch(() => undefined);

  expect(await pollAborted(workerUrl)).toBe(true);
}, 30_000);

test("Cloudflare dev tooling supports the current remote-binding preview protocol", async () => {
  const wranglerPackage = JSON.parse(
    await readFile("node_modules/wrangler/package.json", "utf8"),
  ) as { version: string };
  const vitePluginPackage = JSON.parse(
    await readFile("node_modules/@cloudflare/vite-plugin/package.json", "utf8"),
  ) as { version: string };
  const [wranglerMajor, wranglerMinor] = wranglerPackage.version
    .split(".")
    .map(Number);
  const [pluginMajor, pluginMinor] = vitePluginPackage.version
    .split(".")
    .map(Number);

  expect(
    wranglerMajor > 4 || (wranglerMajor === 4 && wranglerMinor >= 120),
  ).toBe(true);
  expect(pluginMajor > 1 || (pluginMajor === 1 && pluginMinor >= 51)).toBe(
    true,
  );
});

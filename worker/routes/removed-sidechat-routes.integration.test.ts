import { expect, test } from "bun:test";

test("the mounted worker leaves the retired custom Sidechat routes absent", async () => {
  const fixturePath = new URL(
    "./removed-sidechat-routes.mounted.fixture.test.ts",
    import.meta.url,
  ).pathname;
  const child = Bun.spawn([process.execPath, "test", fixturePath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REMOVED_SIDECHAT_ROUTES_FIXTURE: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Removed route fixture failed:\n${stdout}\n${stderr}`);
  }

  const output = `${stdout}\n${stderr}`;
  expect(output).toContain("3 pass");
  expect(output).toContain("0 fail");
});

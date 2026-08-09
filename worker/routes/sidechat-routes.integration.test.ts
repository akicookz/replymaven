import { expect, test } from "bun:test";

test("the mounted worker enforces Sidechat session and team authorization", async () => {
  const fixturePath = new URL(
    "./sidechat-routes.mounted.fixture.test.ts",
    import.meta.url,
  ).pathname;
  const child = Bun.spawn([process.execPath, "test", fixturePath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SIDECHAT_MOUNTED_FIXTURE: "1",
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
    throw new Error(`Mounted route fixture failed:\n${stdout}\n${stderr}`);
  }

  const output = `${stdout}\n${stderr}`;
  expect(output).toContain("4 pass");
  expect(output).toContain("0 fail");
});

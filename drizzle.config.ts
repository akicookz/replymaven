import { defineConfig } from "drizzle-kit";
import fs from "fs";
import path from "path";

// Find the local D1 database file (wrangler generates a hash-based filename)
function getLocalD1Path(): string {
  const d1Dir = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";

  if (fs.existsSync(d1Dir)) {
    const files = fs.readdirSync(d1Dir).filter((f) => f.endsWith(".sqlite"));
    if (files.length > 0) {
      return path.join(d1Dir, files[0]);
    }
  }

  // Fallback - return expected path even if it doesn't exist yet
  return `${d1Dir}/local.sqlite`;
}

export default defineConfig({
  schema: "./worker/db/index.ts",
  out: "./worker/db/drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: getLocalD1Path(),
  },
});

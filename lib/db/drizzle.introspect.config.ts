/**
 * Use this config only for pulling schema from Neon (does not touch src/schema).
 *
 *   cd lib/db && DATABASE_URL="postgresql://..." pnpm exec drizzle-kit pull --config drizzle.introspect.config.ts
 *
 * Review ./introspected/schema.ts and merge into src/schema manually.
 */
import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for introspection");
}

export default defineConfig({
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  out: path.join(__dirname, "introspected"),
});

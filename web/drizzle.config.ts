import { resolve } from "path";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Drizzle CLI does not load .env.local — Next.js does. Match that so `db:push` works.
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

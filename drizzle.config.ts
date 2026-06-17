import { defineConfig } from "drizzle-kit";

/*
  Used only by the drizzle-kit CLI (db:push / db:generate / db:studio), never by
  the Next app. drizzle-kit auto-loads `.env` (NOT `.env.local`), so put
  DATABASE_URL in `.env` for the CLI — Next reads `.env` too, so the app sees it
  as well. (Both files are gitignored.) Fail fast with a clear message rather
  than dialing an empty connection string.
*/
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is required for drizzle-kit. Set it in .env (drizzle-kit auto-loads .env, not .env.local).",
  );
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});

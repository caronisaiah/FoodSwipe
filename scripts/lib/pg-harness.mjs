// Real PostgreSQL for integration tests, with no network and no production database.
//
// PGlite is the actual PostgreSQL engine (PostgreSQL 18.x compiled to WebAssembly) running in-process:
// real SQL semantics, real unique/partial indexes, CHECK constraints, triggers and data-modifying CTEs.
// It is NOT a mock. The app's own lib/db modules run unchanged against it: only `lib/db/index.ts`
// (getDb) is pointed at the isolated instance. DATABASE_URL and the production database are never read.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createSandbox } from "./ts-sandbox.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** A fresh in-memory database with every committed migration (0000 .. latest) applied. */
export async function createTestDatabase({ migrate: doMigrate = true } = {}) {
  const client = new PGlite();
  const db = drizzle(client);
  if (doMigrate) await migrate(db, { migrationsFolder: join(root, "drizzle") });
  return { client, db };
}

/** A sandbox that loads the real app modules with getDb() bound to the isolated database. */
export function createAppSandbox(db, { overrides = {}, env = {} } = {}) {
  const sandbox = createSandbox({
    root,
    env,
    overrides: {
      "lib/db/index.ts": { isDbConfigured: () => true, getDb: () => db, schema: {} },
      ...overrides,
    },
  });
  return sandbox;
}

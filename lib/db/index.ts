import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

/**
 * Lazy Neon/Drizzle client. Created on first use so importing this module never
 * throws when `DATABASE_URL` is unset (keeps `next build` + local dev working
 * without a database). Read paths treat a null client as "no persisted videos".
 */
let client: NeonHttpDatabase<typeof schema> | null = null;

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!client) client = drizzle(neon(url), { schema });
  return client;
}

export { schema };

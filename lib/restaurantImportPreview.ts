import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { isAllowedMarket, type Market } from "@/lib/markets";

export const IMPORT_PREVIEW_TTL_MS = 15 * 60 * 1000;

export interface ImportPreviewContext {
  query: string;
  maxResults: number;
  market: Market;
}

interface ImportPreviewReceipt extends ImportPreviewContext {
  purpose: "restaurant-import-preview";
  placeIds: string[];
  expiresAt: number;
}

/** Signed membership/context only, never browser-supplied restaurant metadata. */
export function signImportPreview(
  context: ImportPreviewContext,
  placeIds: string[],
  secret: string,
  now = Date.now(),
): string {
  const receipt: ImportPreviewReceipt = {
    ...context,
    purpose: "restaurant-import-preview",
    placeIds: [...new Set(placeIds)],
    expiresAt: now + IMPORT_PREVIEW_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(receipt)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/** Fail closed for malformed, expired, tampered or cross-search receipts. */
export function verifyImportPreview(
  token: unknown,
  context: ImportPreviewContext,
  secret: string,
  now = Date.now(),
): string[] | null {
  if (typeof token !== "string" || token.length > 16384) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const receipt = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ImportPreviewReceipt;
    if (
      receipt.purpose !== "restaurant-import-preview" ||
      receipt.query !== context.query || receipt.maxResults !== context.maxResults ||
      receipt.market !== context.market || !isAllowedMarket(receipt.market) ||
      !Number.isFinite(receipt.expiresAt) || receipt.expiresAt <= now ||
      !Array.isArray(receipt.placeIds) || receipt.placeIds.length > 20 ||
      !receipt.placeIds.every((id) => typeof id === "string" && id.trim() === id && id.length > 0 && id.length <= 256)
    ) return null;
    return receipt.placeIds;
  } catch {
    return null;
  }
}

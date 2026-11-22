import { MARKETS, getMarketOrigin, getMarketShortName, type Market } from "@/lib/markets";
import { findPossibleDuplicates, type IdentityRecord } from "@/lib/duplicateWarnings";

/**
 * Publication-readiness checks run at promotion (candidate -> live restaurant). Pure and read-only.
 *
 * Hard problems (a coordinate that is not a real position, missing required fields, a Place ID or
 * candidate that is already published) already BLOCK promotion elsewhere and are not repeated here. These
 * checks cover what is only *suspicious*: they never reject a restaurant and never merge records, but a
 * `warning` must be acknowledged by name, with a written reason, before the restaurant goes live. The
 * acknowledgement and reason are stored in the promotion's audit event.
 *
 *   warning  coordinates_outside_market   pin is far from the market it is published in
 *   warning  missing_place_identity       no Google Place ID, so nothing ties it to one real place
 *   warning  malformed_place_identity     a Place ID that does not look like one
 *   warning  possible_duplicate           same address + similar name, or same name with an unknown address
 *   info     place_identity_unverified    a Place ID typed by hand, never confirmed against Google
 *   info     same_name_other_location / same_address_different_name   probably a branch / shared building
 *
 * Chains (many branches, one name) and food halls (many restaurants, one address) are real, so name or
 * address alone is never a blocker; `info` notes are shown so a human can confirm they are deliberate.
 */
export const MARKET_RADIUS_MILES = 60;
export const MIN_OVERRIDE_REASON_LENGTH = 10;

export interface PublicationCheck {
  code: string;
  severity: "warning" | "info";
  message: string;
  existing?: { kind: string; id: string; name: string; slug: string | null; status: string; address: string | null };
}

export interface PublicationCandidate {
  id: string;
  name: string;
  address: string | null;
  market: Market;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
  source: string;
}

function miles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const PLACE_ID_SHAPE = /^[A-Za-z0-9_-]{20,200}$/;

export function evaluatePublicationChecks(candidate: PublicationCandidate, identityIndex: IdentityRecord[]): PublicationCheck[] {
  const checks: PublicationCheck[] = [];

  if (typeof candidate.lat === "number" && typeof candidate.lng === "number") {
    const origin = getMarketOrigin(candidate.market);
    const own = miles(origin.lat, origin.lng, candidate.lat, candidate.lng);
    if (own > MARKET_RADIUS_MILES) {
      const nearer = MARKETS.filter((m) => m !== candidate.market)
        .map((m) => ({ m, d: miles(getMarketOrigin(m).lat, getMarketOrigin(m).lng, candidate.lat as number, candidate.lng as number) }))
        .find((x) => x.d <= MARKET_RADIUS_MILES);
      checks.push({
        code: "coordinates_outside_market",
        severity: "warning",
        message: nearer
          ? `These coordinates are ${Math.round(own)} miles from the ${getMarketShortName(candidate.market)} market centre but within ${Math.round(nearer.d)} miles of ${getMarketShortName(nearer.m)}. The market may be wrong.`
          : `These coordinates are ${Math.round(own)} miles from the ${getMarketShortName(candidate.market)} market centre (limit ${MARKET_RADIUS_MILES}). Check the market and the pin.`,
      });
    }
  }

  const placeId = candidate.googlePlaceId?.trim() ?? "";
  if (!placeId) {
    checks.push({
      code: "missing_place_identity",
      severity: "warning",
      message: "No Google Place ID. Nothing ties this record to one real place, so duplicates and wrong-branch matches cannot be ruled out.",
    });
  } else if (!PLACE_ID_SHAPE.test(placeId)) {
    checks.push({ code: "malformed_place_identity", severity: "warning", message: "The Google Place ID does not look like a Place ID. Re-check it." });
  } else if (candidate.source === "manual") {
    checks.push({ code: "place_identity_unverified", severity: "info", message: "The Place ID was entered by hand and has not been confirmed against Google." });
  }

  for (const note of findPossibleDuplicates(
    { name: candidate.name, address: candidate.address, market: candidate.market, googlePlaceId: candidate.googlePlaceId, excludeId: candidate.id },
    identityIndex,
  )) {
    checks.push({
      code: note.severity === "warning" ? "possible_duplicate" : note.code,
      severity: note.severity,
      message: note.message,
      existing: { kind: note.existing.kind, id: note.existing.id, name: note.existing.name, slug: note.existing.slug, status: note.existing.status, address: note.existing.address },
    });
  }
  return checks;
}

export interface PublicationOverride {
  /** Codes of the warnings the administrator has read and accepts. */
  acknowledged: string[];
  /** Why publishing despite them is correct. At least MIN_OVERRIDE_REASON_LENGTH characters. */
  reason: string;
}

/** The warnings still unacknowledged. Empty means publication may proceed. */
export function unresolvedWarnings(checks: PublicationCheck[], override: PublicationOverride | null): PublicationCheck[] {
  const warnings = checks.filter((c) => c.severity === "warning");
  if (warnings.length === 0) return [];
  if (!override || override.reason.trim().length < MIN_OVERRIDE_REASON_LENGTH) return warnings;
  const acknowledged = new Set(override.acknowledged);
  return warnings.filter((w) => !acknowledged.has(w.code));
}

/** Validate the `override` object of a promote request body. */
export function parsePublicationOverride(value: unknown): { ok: true; override: PublicationOverride | null } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, override: null };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, message: "override must be an object { acknowledge: string[], reason: string }." };
  const o = value as Record<string, unknown>;
  const ack = o.acknowledge;
  if (!Array.isArray(ack) || ack.length === 0 || ack.length > 10 || !ack.every((c) => typeof c === "string" && c.length > 0 && c.length <= 60)) {
    return { ok: false, message: "override.acknowledge must list the warning codes being accepted (1-10 strings)." };
  }
  if (typeof o.reason !== "string" || o.reason.trim().length < MIN_OVERRIDE_REASON_LENGTH || o.reason.trim().length > 1000) {
    return { ok: false, message: `override.reason must explain the exception (${MIN_OVERRIDE_REASON_LENGTH}-1000 characters).` };
  }
  return { ok: true, override: { acknowledged: [...new Set(ack as string[])], reason: o.reason.trim() } };
}

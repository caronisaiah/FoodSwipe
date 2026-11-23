/**
 * Conservative duplicate hints that SUPPLEMENT Google Place ID matching. They never block a write and
 * never merge records.
 *
 * Why only hints: a Google Place ID identifies one branch exactly, and chains legitimately share a
 * name across many addresses (Nom Wah, Raku, Fish Cheeks), while food halls put several different
 * restaurants at one street address (Dhamaka is inside Essex Market). So:
 *   - same street address AND a similar name      -> "warning" (very likely the same place)
 *   - same name AND a different street address     -> "info"    (probably another branch; shown so a
 *                                                                 human can confirm it is deliberate)
 *   - same street address AND an unrelated name    -> "info"    (probably a shared building)
 *   - same name AND an address missing on a side   -> "warning" (cannot tell which branch)
 * Only records in the SAME market are compared.
 */
export interface IdentityRecord {
  kind: "candidate" | "published";
  id: string;
  name: string;
  address: string | null;
  market: string;
  status: string;
  slug: string | null;
  googlePlaceId: string | null;
}

export interface DuplicateNote {
  severity: "warning" | "info";
  code: "possible_duplicate_address" | "possible_duplicate_name" | "same_name_other_location" | "same_address_different_name";
  message: string;
  existing: Pick<IdentityRecord, "kind" | "id" | "name" | "address" | "status" | "slug" | "market">;
}

const SUFFIXES: Record<string, string> = {
  street: "st", avenue: "ave", boulevard: "blvd", place: "pl", road: "rd", drive: "dr", lane: "ln", court: "ct",
  east: "e", west: "w", north: "n", south: "s", square: "sq", alley: "aly",
};

function ascii(value: string): string {
  return value.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase();
}

export function normalizeName(name: string): string {
  return ascii(name)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the /, "")
    .trim();
}

/** "119 Delancey Street, Essex Market #34, New York, NY 10002" -> "119 delancey st". */
export function normalizeStreet(address: string | null | undefined): string | null {
  if (!address) return null;
  const first = ascii(address).split(",")[0] ?? "";
  const tokens = first
    .replace(/#\s*\w+/g, " ")
    .replace(/[^a-z0-9 -]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => SUFFIXES[t] ?? t);
  if (!tokens.length || !/^\d/.test(tokens[0])) return null; // needs a house number to be comparable
  return tokens.join(" ");
}

function similarNames(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  const ta = new Set(a.split(" "));
  const tb = new Set(b.split(" "));
  const shared = [...ta].filter((t) => tb.has(t)).length;
  return shared / Math.max(ta.size, tb.size) >= 0.6;
}

export function findPossibleDuplicates(
  input: { name: string; address: string | null; market: string; googlePlaceId?: string | null; excludeId?: string },
  index: IdentityRecord[],
): DuplicateNote[] {
  const name = normalizeName(input.name);
  const street = normalizeStreet(input.address);
  const notes: DuplicateNote[] = [];
  for (const rec of index) {
    if (rec.id === input.excludeId || rec.market !== input.market) continue;
    if (input.googlePlaceId && rec.googlePlaceId === input.googlePlaceId) continue; // exact match is a hard conflict, reported elsewhere
    const recName = normalizeName(rec.name);
    const recStreet = normalizeStreet(rec.address);
    const sameName = recName === name;
    const similar = sameName || similarNames(name, recName);
    const existing = { kind: rec.kind, id: rec.id, name: rec.name, address: rec.address, status: rec.status, slug: rec.slug, market: rec.market };
    if (street && recStreet && street === recStreet) {
      notes.push(similar
        ? { severity: "warning", code: "possible_duplicate_address", existing, message: `Same street address as ${rec.kind} "${rec.name}" (${rec.status}). Likely the same place.` }
        : { severity: "info", code: "same_address_different_name", existing, message: `Shares a street address with ${rec.kind} "${rec.name}" (${rec.status}); possibly a shared building such as a food hall.` });
    } else if (sameName) {
      notes.push(street && recStreet
        ? { severity: "info", code: "same_name_other_location", existing, message: `Another ${rec.kind} named "${rec.name}" exists at a different address (${rec.address}). Fine if this is a separate branch.` }
        : { severity: "warning", code: "possible_duplicate_name", existing, message: `A ${rec.kind} named "${rec.name}" exists and one of the addresses is missing, so the branch cannot be compared.` });
    }
  }
  return notes.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1));
}

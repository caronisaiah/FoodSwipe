import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, isDbConfigured } from "./index";
import {
  restaurantHeroMediaSelections,
  restaurants,
  type NewRestaurantHeroMediaSelectionRow,
  type RestaurantHeroMediaSelectionRow,
} from "./schema";

export { isDbConfigured };

export const HERO_SELECTION_TARGET_TYPES = ["candidate", "restaurant"] as const;
export type HeroSelectionTargetType = (typeof HERO_SELECTION_TARGET_TYPES)[number];

export const HERO_SELECTION_PROVIDERS = ["google_places"] as const;
export type HeroSelectionProvider = (typeof HERO_SELECTION_PROVIDERS)[number];

export const HERO_SELECTION_RELATIONSHIPS = ["exact_location"] as const;
export type HeroSelectionRelationship = (typeof HERO_SELECTION_RELATIONSHIPS)[number];

export const HERO_SELECTION_APPROVAL_STATES = ["approved", "cleared"] as const;
export type HeroSelectionApprovalState = (typeof HERO_SELECTION_APPROVAL_STATES)[number];

export interface HeroMediaSelection {
  id: string;
  targetType: HeroSelectionTargetType;
  candidateRestaurantId: string | null;
  restaurantId: string | null;
  sourceProvider: HeroSelectionProvider;
  relationship: HeroSelectionRelationship;
  sourcePlaceId: string;
  selectedPhotoOrdinal: number;
  approvalState: HeroSelectionApprovalState;
  reviewerNotes: string | null;
  selectionReason: string | null;
  riskNote: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertCandidateHeroSelectionInput {
  candidateRestaurantId: string;
  sourcePlaceId: string;
  selectedPhotoOrdinal: number;
  reviewerNotes?: string | null;
  selectionReason?: string | null;
  riskNote?: string | null;
}

export interface CloneHeroSelectionResult {
  ok: boolean;
  cloned: boolean;
  selection: HeroMediaSelection | null;
  warning?: string;
}

function inSet<T extends string>(set: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (set as readonly string[]).includes(value);
}

function cleanText(value: unknown, max = 1000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

function cleanPlaceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function validHeroPhotoOrdinal(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n >= 1 && n <= 10 ? n : null;
}

function rowToSelection(row: RestaurantHeroMediaSelectionRow): HeroMediaSelection {
  return {
    id: row.id,
    targetType: inSet(HERO_SELECTION_TARGET_TYPES, row.targetType)
      ? row.targetType
      : row.candidateRestaurantId
        ? "candidate"
        : "restaurant",
    candidateRestaurantId: row.candidateRestaurantId ?? null,
    restaurantId: row.restaurantId ?? null,
    sourceProvider: inSet(HERO_SELECTION_PROVIDERS, row.sourceProvider)
      ? row.sourceProvider
      : "google_places",
    relationship: inSet(HERO_SELECTION_RELATIONSHIPS, row.relationship)
      ? row.relationship
      : "exact_location",
    sourcePlaceId: row.sourcePlaceId,
    selectedPhotoOrdinal: validHeroPhotoOrdinal(row.selectedPhotoOrdinal) ?? 1,
    approvalState: inSet(HERO_SELECTION_APPROVAL_STATES, row.approvalState)
      ? row.approvalState
      : "cleared",
    reviewerNotes: row.reviewerNotes ?? null,
    selectionReason: row.selectionReason ?? null,
    riskNote: row.riskNote ?? null,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function insertSelection(values: NewRestaurantHeroMediaSelectionRow): Promise<HeroMediaSelection> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const [row] = await db.insert(restaurantHeroMediaSelections).values(values).returning();
  return rowToSelection(row);
}

export async function getApprovedHeroSelectionForCandidate(
  candidateRestaurantId: string,
): Promise<HeroMediaSelection | null> {
  const db = getDb();
  if (!db) return null;
  const id = cleanText(candidateRestaurantId, 200);
  if (!id) return null;
  const rows = await db
    .select()
    .from(restaurantHeroMediaSelections)
    .where(and(
      eq(restaurantHeroMediaSelections.targetType, "candidate"),
      eq(restaurantHeroMediaSelections.candidateRestaurantId, id),
      eq(restaurantHeroMediaSelections.approvalState, "approved"),
    ))
    .orderBy(desc(restaurantHeroMediaSelections.updatedAt))
    .limit(1);
  return rows[0] ? rowToSelection(rows[0]) : null;
}

export async function getApprovedHeroSelectionMapForCandidates(
  candidateRestaurantIds: string[],
): Promise<Record<string, HeroMediaSelection>> {
  const db = getDb();
  if (!db || candidateRestaurantIds.length === 0) return {};
  const ids = Array.from(new Set(
    candidateRestaurantIds
      .map((id) => cleanText(id, 200))
      .filter((id): id is string => Boolean(id)),
  ));
  if (ids.length === 0) return {};

  const out: Record<string, HeroMediaSelection> = {};
  try {
    const rows = await db
      .select()
      .from(restaurantHeroMediaSelections)
      .where(and(
        eq(restaurantHeroMediaSelections.targetType, "candidate"),
        inArray(restaurantHeroMediaSelections.candidateRestaurantId, ids),
        eq(restaurantHeroMediaSelections.approvalState, "approved"),
      ))
      .orderBy(desc(restaurantHeroMediaSelections.updatedAt));
    for (const row of rows) {
      const candidateId = row.candidateRestaurantId;
      if (!candidateId || out[candidateId]) continue;
      out[candidateId] = rowToSelection(row);
    }
    return out;
  } catch {
    return {};
  }
}

export async function getApprovedHeroSelectionForRestaurant(
  restaurantId: string,
): Promise<HeroMediaSelection | null> {
  const db = getDb();
  if (!db) return null;
  const id = cleanText(restaurantId, 200);
  if (!id) return null;
  const rows = await db
    .select()
    .from(restaurantHeroMediaSelections)
    .where(and(
      eq(restaurantHeroMediaSelections.targetType, "restaurant"),
      eq(restaurantHeroMediaSelections.restaurantId, id),
      eq(restaurantHeroMediaSelections.approvalState, "approved"),
    ))
    .orderBy(desc(restaurantHeroMediaSelections.updatedAt))
    .limit(1);
  return rows[0] ? rowToSelection(rows[0]) : null;
}

export async function getApprovedHeroSelectionForRestaurantSlug(
  slug: string,
): Promise<HeroMediaSelection | null> {
  const db = getDb();
  if (!db) return null;
  const s = cleanText(slug, 200);
  if (!s) return null;
  try {
    const rows = await db
      .select({ selection: restaurantHeroMediaSelections })
      .from(restaurantHeroMediaSelections)
      .innerJoin(restaurants, eq(restaurantHeroMediaSelections.restaurantId, restaurants.id))
      .where(and(
        eq(restaurants.slug, s),
        eq(restaurants.status, "published"),
        eq(restaurantHeroMediaSelections.targetType, "restaurant"),
        eq(restaurantHeroMediaSelections.approvalState, "approved"),
      ))
      .orderBy(desc(restaurantHeroMediaSelections.updatedAt))
      .limit(1);
    return rows[0]?.selection ? rowToSelection(rows[0].selection) : null;
  } catch {
    return null;
  }
}

export async function upsertApprovedHeroSelectionForCandidate(
  input: UpsertCandidateHeroSelectionInput,
): Promise<HeroMediaSelection> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const candidateRestaurantId = cleanText(input.candidateRestaurantId, 200);
  const sourcePlaceId = cleanPlaceId(input.sourcePlaceId);
  const selectedPhotoOrdinal = validHeroPhotoOrdinal(input.selectedPhotoOrdinal);
  if (!candidateRestaurantId || !sourcePlaceId || !selectedPhotoOrdinal) {
    throw new Error("Invalid hero selection input");
  }

  const now = new Date();
  await db
    .update(restaurantHeroMediaSelections)
    .set({ approvalState: "cleared", updatedAt: now })
    .where(and(
      eq(restaurantHeroMediaSelections.targetType, "candidate"),
      eq(restaurantHeroMediaSelections.candidateRestaurantId, candidateRestaurantId),
      eq(restaurantHeroMediaSelections.approvalState, "approved"),
    ));

  return insertSelection({
    id: crypto.randomUUID(),
    targetType: "candidate",
    candidateRestaurantId,
    restaurantId: null,
    sourceProvider: "google_places",
    relationship: "exact_location",
    sourcePlaceId,
    selectedPhotoOrdinal,
    approvalState: "approved",
    reviewerNotes: cleanText(input.reviewerNotes),
    selectionReason:
      cleanText(input.selectionReason) ?? "Selected from exact-location Google photo candidates",
    riskNote: cleanText(input.riskNote),
    approvedAt: now,
    updatedAt: now,
  });
}

export async function clearApprovedHeroSelectionForCandidate(
  candidateRestaurantId: string,
): Promise<number> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const id = cleanText(candidateRestaurantId, 200);
  if (!id) return 0;
  const rows = await db
    .update(restaurantHeroMediaSelections)
    .set({ approvalState: "cleared", updatedAt: new Date() })
    .where(and(
      eq(restaurantHeroMediaSelections.targetType, "candidate"),
      eq(restaurantHeroMediaSelections.candidateRestaurantId, id),
      eq(restaurantHeroMediaSelections.approvalState, "approved"),
    ))
    .returning({ id: restaurantHeroMediaSelections.id });
  return rows.length;
}

export async function cloneCandidateHeroSelectionToRestaurant(
  candidateRestaurantId: string,
  restaurantId: string,
): Promise<CloneHeroSelectionResult> {
  const db = getDb();
  if (!db) return { ok: false, cloned: false, selection: null, warning: "Database not configured." };
  const candidateId = cleanText(candidateRestaurantId, 200);
  const publishedId = cleanText(restaurantId, 200);
  if (!candidateId || !publishedId) {
    return { ok: false, cloned: false, selection: null, warning: "Invalid hero selection clone target." };
  }

  const existing = await getApprovedHeroSelectionForRestaurant(publishedId);
  if (existing) return { ok: true, cloned: false, selection: existing };

  const source = await getApprovedHeroSelectionForCandidate(candidateId);
  if (!source) return { ok: true, cloned: false, selection: null };

  const now = new Date();
  try {
    const selection = await insertSelection({
      id: crypto.randomUUID(),
      targetType: "restaurant",
      candidateRestaurantId: null,
      restaurantId: publishedId,
      sourceProvider: source.sourceProvider,
      relationship: source.relationship,
      sourcePlaceId: source.sourcePlaceId,
      selectedPhotoOrdinal: source.selectedPhotoOrdinal,
      approvalState: "approved",
      reviewerNotes: source.reviewerNotes,
      selectionReason: source.selectionReason,
      riskNote: source.riskNote,
      approvedAt: source.approvedAt ? new Date(source.approvedAt) : now,
      updatedAt: now,
    });
    return { ok: true, cloned: true, selection };
  } catch {
    const afterRace = await getApprovedHeroSelectionForRestaurant(publishedId);
    if (afterRace) return { ok: true, cloned: false, selection: afterRace };
    return {
      ok: false,
      cloned: false,
      selection: null,
      warning: "Restaurant was promoted, but hero selection clone failed.",
    };
  }
}

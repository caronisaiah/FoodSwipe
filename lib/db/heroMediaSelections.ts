import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "./index";
import { auditSql, auditedUpdate, decodeRow, executeRows } from "./audit";
import { AUDIT_FIELDS, type AuditContext } from "@/lib/adminAudit";
import {
  restaurantHeroMediaSelections,
  restaurants,
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
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10
    ? value
    : null;
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
    selectedPhotoOrdinal: row.selectedPhotoOrdinal,
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
  ctx: AuditContext,
): Promise<HeroMediaSelection> {
  if (!getDb()) throw new Error("DATABASE_URL not configured");
  const candidateRestaurantId = cleanText(input.candidateRestaurantId, 200);
  const sourcePlaceId = cleanPlaceId(input.sourcePlaceId);
  const selectedPhotoOrdinal = validHeroPhotoOrdinal(input.selectedPhotoOrdinal);
  if (!candidateRestaurantId || !sourcePlaceId || !selectedPhotoOrdinal) {
    throw new Error("Invalid hero selection input");
  }

  const now = new Date().toISOString();
  const table = restaurantHeroMediaSelections;
  // ONE statement: clear the previous approval, insert the new one and write the event. The insert reads
  // `cleared` (via `dep`) so the old approved row is retired before the unique "one approved selection
  // per candidate" index is checked for the new one. `prev` is the pre-change snapshot used for the diff.
  const rows = await executeRows(sql`
    with prev as (
      select * from ${table}
      where target_type = 'candidate' and candidate_restaurant_id = ${candidateRestaurantId} and approval_state = 'approved'
    ), cleared as (
      update ${table} set approval_state = 'cleared', updated_at = ${now}::timestamptz
      where target_type = 'candidate' and candidate_restaurant_id = ${candidateRestaurantId} and approval_state = 'approved'
      returning id
    ), cur as (
      insert into ${table} (
        id, target_type, candidate_restaurant_id, restaurant_id, source_provider, relationship, source_place_id,
        selected_photo_ordinal, approval_state, reviewer_notes, selection_reason, risk_note, approved_at, updated_at
      )
      select ${crypto.randomUUID()}, 'candidate', ${candidateRestaurantId}, null, 'google_places', 'exact_location', ${sourcePlaceId},
        ${selectedPhotoOrdinal}, 'approved', ${cleanText(input.reviewerNotes)}::text,
        ${cleanText(input.selectionReason) ?? "Selected from exact-location Google photo candidates"}::text,
        ${cleanText(input.riskNote)}::text, ${now}::timestamptz, ${now}::timestamptz
      from (select count(*) as n from cleared) dep
      returning *
    ), ev as (${auditSql.eventInsert({
      ctx, resourceType: "restaurant_candidate", resourceIdColumn: "candidate_restaurant_id",
      fields: AUDIT_FIELDS.hero_selection, action: "restaurant_candidate.hero_selected",
    }, "optional", false)})
    select to_jsonb(cur) as row from cur`);
  if (!rows[0]) throw new Error("Hero selection was not saved.");
  return rowToSelection(decodeRow(table, rows[0].row));
}

export async function clearApprovedHeroSelectionForCandidate(
  candidateRestaurantId: string,
  ctx: AuditContext,
): Promise<number> {
  if (!getDb()) throw new Error("DATABASE_URL not configured");
  const id = cleanText(candidateRestaurantId, 200);
  if (!id) return 0;
  const result = await auditedUpdate({
    table: restaurantHeroMediaSelections,
    where: and(
      eq(restaurantHeroMediaSelections.targetType, "candidate"),
      eq(restaurantHeroMediaSelections.candidateRestaurantId, id),
      eq(restaurantHeroMediaSelections.approvalState, "approved"),
    )!,
    set: { approvalState: "cleared", updatedAt: new Date() },
    audit: {
      ctx, resourceType: "restaurant_candidate", resourceIdColumn: "candidate_restaurant_id",
      fields: AUDIT_FIELDS.hero_selection, action: "restaurant_candidate.hero_cleared",
    },
  });
  return result ? 1 : 0;
}

export async function cloneCandidateHeroSelectionToRestaurant(
  candidateRestaurantId: string,
  restaurantId: string,
  ctx: AuditContext,
): Promise<CloneHeroSelectionResult> {
  if (!getDb()) return { ok: false, cloned: false, selection: null, warning: "Database not configured." };
  const candidateId = cleanText(candidateRestaurantId, 200);
  const publishedId = cleanText(restaurantId, 200);
  if (!candidateId || !publishedId) {
    return { ok: false, cloned: false, selection: null, warning: "Invalid hero selection clone target." };
  }

  const existing = await getApprovedHeroSelectionForRestaurant(publishedId);
  if (existing) return { ok: true, cloned: false, selection: existing };

  const source = await getApprovedHeroSelectionForCandidate(candidateId);
  if (!source) return { ok: true, cloned: false, selection: null };

  const now = new Date().toISOString();
  const table = restaurantHeroMediaSelections;
  try {
    // One statement: copy the candidate's approved selection to the published restaurant and record the
    // `restaurant.hero_inherited` event. `not exists` keeps a concurrent clone from double-inserting.
    const rows = await executeRows(sql`
      with cur as (
        insert into ${table} (
          id, target_type, candidate_restaurant_id, restaurant_id, source_provider, relationship, source_place_id,
          selected_photo_ordinal, approval_state, reviewer_notes, selection_reason, risk_note, approved_at, updated_at
        )
        select ${crypto.randomUUID()}, 'restaurant', null, ${publishedId}, s.source_provider, s.relationship, s.source_place_id,
          s.selected_photo_ordinal, 'approved', s.reviewer_notes, s.selection_reason, s.risk_note,
          coalesce(s.approved_at, ${now}::timestamptz), ${now}::timestamptz
        from ${table} s
        where s.target_type = 'candidate' and s.candidate_restaurant_id = ${candidateId} and s.approval_state = 'approved'
          and not exists (
            select 1 from ${table} x where x.target_type = 'restaurant' and x.restaurant_id = ${publishedId} and x.approval_state = 'approved')
        limit 1
        returning *
      ), ev as (${auditSql.eventInsert({
        ctx, resourceType: "restaurant", resourceIdColumn: "restaurant_id",
        related: { type: "restaurant_candidate", id: sql`${candidateId}` },
        fields: AUDIT_FIELDS.hero_selection, action: "restaurant.hero_inherited",
      }, "none", false)})
      select to_jsonb(cur) as row from cur`);
    if (rows[0]) return { ok: true, cloned: true, selection: rowToSelection(decodeRow(table, rows[0].row)) };
    const afterRace = await getApprovedHeroSelectionForRestaurant(publishedId);
    return { ok: true, cloned: false, selection: afterRace };
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

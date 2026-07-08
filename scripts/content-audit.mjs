#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";

const { loadEnvConfig } = nextEnv;

const CONTENT_MODES = new Set(["demo", "mixed", "production"]);
const DEFAULT_CONTENT_MODE = "mixed";
const FAIL_CLOSED_CONTENT_MODE = "production";
const KNOWN_MARKETS = new Set(["dc", "nyc"]);
const DEMO_TERMS = /\b(test|demo|sample|seed|fake|dummy|placeholder|lorem|mock)\b/i;
const DB_DRIVER_LABEL =
  "Neon HTTP via @neondatabase/serverless neon(url), mirroring lib/db/index.ts; audit queries are SELECT-only";

const GROUPS = {
  restaurants: ["status", "market"],
  candidate_restaurants: ["market", "status", "source"],
  restaurant_videos: ["platform", "legal_display_status", "status", "source_type", "match_confidence"],
  video_candidates: ["status", "platform", "legal_display_status", "resolver_status"],
  restaurant_sources: ["source_type"],
  restaurant_evidence_documents: ["subject_type", "fetch_status", "market", "source_type"],
  ingestion_jobs: ["status", "source", "dry_run"],
};

function usage() {
  return [
    "Usage:",
    "  npm run content:audit",
    "  npm run content:audit -- --check-connection",
    "  npm run content:audit -- --export ./exports/content-audit.json",
    "  npm run content:audit -- --export ./exports/content-audit.json --force",
  ].join("\n");
}

function parseArgs(argv) {
  const out = { exportPath: null, force: false, checkConnection: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--force") {
      out.force = true;
      continue;
    }
    if (arg === "--check-connection") {
      out.checkConnection = true;
      continue;
    }
    if (arg === "--export") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--export requires a file path.");
      }
      out.exportPath = next;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function normalizeContentMode(value) {
  if (typeof value !== "string") return null;
  const mode = value.trim().toLowerCase();
  return CONTENT_MODES.has(mode) ? mode : null;
}

function getContentModeReport() {
  const raw = process.env.FOODSWIPE_CONTENT_MODE;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return {
      raw: null,
      normalized: DEFAULT_CONTENT_MODE,
      source: "default-unset",
      seedVisibility: true,
      warning: null,
    };
  }
  const mode = normalizeContentMode(raw);
  if (mode) {
    return {
      raw,
      normalized: mode,
      source: "explicit",
      seedVisibility: mode !== "production",
      warning: null,
    };
  }
  return {
    raw,
    normalized: FAIL_CLOSED_CONTENT_MODE,
    source: "invalid-fail-closed",
    seedVisibility: false,
    warning: `Invalid FOODSWIPE_CONTENT_MODE was treated as ${FAIL_CLOSED_CONTENT_MODE}.`,
  };
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const dbUrl = process.env.DATABASE_URL;
  return dbUrl ? message.replaceAll(dbUrl, "[redacted DATABASE_URL]") : message;
}

function errorSummary(error, label = "error") {
  if (!error || typeof error !== "object") {
    return { label, message: safeError(error) };
  }
  return {
    label,
    name: "name" in error ? String(error.name) : undefined,
    message: safeError(error),
    code: "code" in error ? String(error.code) : undefined,
    errno: "errno" in error ? String(error.errno) : undefined,
    syscall: "syscall" in error ? String(error.syscall) : undefined,
    hostname: "hostname" in error ? String(error.hostname) : undefined,
  };
}

function errorChain(error) {
  const out = [];
  let cur = error;
  for (let depth = 0; cur && depth < 4; depth += 1) {
    out.push(errorSummary(cur, depth === 0 ? "error" : `cause ${depth}`));
    cur =
      typeof cur === "object" && "sourceError" in cur && cur.sourceError
        ? cur.sourceError
        : typeof cur === "object" && "cause" in cur
          ? cur.cause
          : null;
  }
  return out;
}

function likelyCauseHint(error) {
  const chain = errorChain(error);
  const text = chain
    .map((item) => `${item.name ?? ""} ${item.message ?? ""} ${item.code ?? ""} ${item.hostname ?? ""}`)
    .join(" ")
    .toLowerCase();

  if (text.includes("unable_to_get_issuer_cert") || text.includes("self_signed_cert") || text.includes("certificate")) {
    return "Likely local TLS trust issue. On managed networks, use an approved NODE_EXTRA_CA_CERTS file rather than disabling TLS verification.";
  }
  if (text.includes("fetch failed") || text.includes("econnreset") || text.includes("etimedout") || text.includes("enotfound")) {
    return "Likely local network/proxy/DNS connectivity to Neon. Try a non-intercepted network or configure the approved Node proxy/CA settings.";
  }
  return "Connection failed before the audit could run. The diagnostics above should identify whether this is env, network, TLS, or Neon availability.";
}

function safeDbTarget(urlString) {
  try {
    const url = new URL(urlString);
    const database = decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "(unknown)";
    const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    return {
      label: `${host}/${database}`,
      host,
      database,
    };
  } catch {
    return {
      label: "configured (target unparseable)",
      host: null,
      database: null,
    };
  }
}

function loadedEnvFileNames(envResult) {
  return Array.isArray(envResult?.loadedEnvFiles)
    ? envResult.loadedEnvFiles.map((file) => file.path).filter(Boolean)
    : [];
}

function buildDiagnostics(envResult) {
  return {
    envLoadingRan: true,
    loadedEnvFiles: loadedEnvFileNames(envResult),
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    dbConnectionTarget: process.env.DATABASE_URL ? safeDbTarget(process.env.DATABASE_URL) : null,
    contentMode: getContentModeReport(),
    driver: DB_DRIVER_LABEL,
    nodeVersion: process.version,
    nodeExtraCaCertsConfigured: Boolean(process.env.NODE_EXTRA_CA_CERTS),
    httpsProxyConfigured: Boolean(process.env.HTTPS_PROXY || process.env.https_proxy),
    httpProxyConfigured: Boolean(process.env.HTTP_PROXY || process.env.http_proxy),
    noProxyConfigured: Boolean(process.env.NO_PROXY || process.env.no_proxy),
  };
}

function printDiagnostics(diagnostics, error = null) {
  console.error("");
  console.error("Content audit diagnostics");
  console.error("-------------------------");
  console.error(`envLoadingRan: ${diagnostics.envLoadingRan ? "yes" : "no"}`);
  console.error(`loadedEnvFiles: ${diagnostics.loadedEnvFiles.join(", ") || "none"}`);
  console.error(`DATABASE_URL exists: ${diagnostics.hasDatabaseUrl ? "yes" : "no"}`);
  console.error(`dbTarget: ${diagnostics.dbConnectionTarget?.label ?? "not configured"}`);
  console.error(`contentMode: ${diagnostics.contentMode.normalized} (${diagnostics.contentMode.source})`);
  console.error(`driver: ${diagnostics.driver}`);
  console.error(`nodeVersion: ${diagnostics.nodeVersion}`);
  console.error(`NODE_EXTRA_CA_CERTS configured: ${diagnostics.nodeExtraCaCertsConfigured ? "yes" : "no"}`);
  console.error(`HTTPS_PROXY configured: ${diagnostics.httpsProxyConfigured ? "yes" : "no"}`);
  console.error(`HTTP_PROXY configured: ${diagnostics.httpProxyConfigured ? "yes" : "no"}`);
  console.error(`NO_PROXY configured: ${diagnostics.noProxyConfigured ? "yes" : "no"}`);
  if (error) {
    console.error("errorChain:");
    for (const item of errorChain(error)) {
      const parts = [
        item.label,
        item.name,
        item.message,
        item.code ? `code=${item.code}` : null,
        item.errno ? `errno=${item.errno}` : null,
        item.syscall ? `syscall=${item.syscall}` : null,
        item.hostname ? `hostname=${item.hostname}` : null,
      ].filter(Boolean);
      console.error(`- ${parts.join(" | ")}`);
    }
    console.error(`likelyCause: ${likelyCauseHint(error)}`);
  }
}

function qIdent(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "(blank)";
  return String(value);
}

function listCounts(rows, keys = ["value"]) {
  if (!rows || rows.length === 0) return "none";
  return rows
    .map((row) => {
      const label = keys.map((key) => displayValue(row[key])).join(" / ");
      return `${label}: ${row.count}`;
    })
    .join(", ");
}

function limitList(items, formatter, limit = 8) {
  if (!items || items.length === 0) return "none";
  const shown = items.slice(0, limit).map(formatter);
  const extra = items.length > limit ? `, +${items.length - limit} more` : "";
  return `${shown.join(", ")}${extra}`;
}

function hasDemoTerm(...values) {
  return values.some((value) => typeof value === "string" && DEMO_TERMS.test(value));
}

function hasKnownMarket(value) {
  return typeof value === "string" && KNOWN_MARKETS.has(value.trim().toLowerCase());
}

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function loadSeedSummary(projectDir, warnings) {
  const seedPath = path.join(projectDir, "lib", "seed", "restaurants.ts");
  const marketPath = path.join(projectDir, "lib", "markets.ts");
  let source = "";
  let defaultMarket = "dc";

  try {
    source = await readFile(seedPath, "utf8");
  } catch (error) {
    warnings.push(`Could not read seed restaurants file: ${safeError(error)}`);
  }

  try {
    const marketSource = await readFile(marketPath, "utf8");
    const match = marketSource.match(/DEFAULT_MARKET:\s*Market\s*=\s*"([^"]+)"/);
    if (match) defaultMarket = match[1];
  } catch (error) {
    warnings.push(`Could not read market config file: ${safeError(error)}`);
  }

  const restaurants = [];
  const seen = new Set();
  const re = /\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*neighborhood:/g;
  for (const match of source.matchAll(re)) {
    const slug = match[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    restaurants.push({ slug, name: match[2], market: defaultMarket });
  }

  const seedSlugs = restaurants.map((row) => row.slug);
  const seedNames = restaurants.map((row) => row.name);
  return {
    count: restaurants.length,
    markets: restaurants.length > 0 ? [defaultMarket] : [],
    restaurants,
    slugs: seedSlugs,
    names: seedNames,
  };
}

async function loadPublicSchema(sql) {
  const rows = await sql.query(
    "select table_name, column_name from information_schema.columns where table_schema = 'public'",
  );
  const schema = new Map();
  for (const row of rows) {
    const table = String(row.table_name);
    const column = String(row.column_name);
    if (!schema.has(table)) schema.set(table, new Set());
    schema.get(table).add(column);
  }
  return schema;
}

async function countAll(sql, table) {
  const rows = await sql.query(`select count(*)::int as count from ${qIdent(table)}`);
  return toCount(rows[0]?.count);
}

async function countWhere(sql, table, whereSql, params = []) {
  const rows = await sql.query(`select count(*)::int as count from ${qIdent(table)} where ${whereSql}`, params);
  return toCount(rows[0]?.count);
}

async function countBy(sql, table, column) {
  const ident = qIdent(column);
  const rows = await sql.query(
    `select ${ident}::text as value, count(*)::int as count from ${qIdent(table)} group by ${ident} order by count desc, value asc`,
  );
  return rows.map((row) => ({ value: row.value, count: toCount(row.count) }));
}

async function countByPair(sql, table, left, right) {
  const leftIdent = qIdent(left);
  const rightIdent = qIdent(right);
  const rows = await sql.query(
    `select ${leftIdent}::text as ${left}, ${rightIdent}::text as ${right}, count(*)::int as count from ${qIdent(table)} group by ${leftIdent}, ${rightIdent} order by ${leftIdent} asc, ${rightIdent} asc`,
  );
  return rows.map((row) => ({ [left]: row[left], [right]: row[right], count: toCount(row.count) }));
}

async function selectRows(sql, table, columns, limit = 10000) {
  const projection = columns.map((column) => qIdent(column)).join(", ");
  return sql.query(`select ${projection} from ${qIdent(table)} limit ${Number(limit)}`);
}

async function checkConnection(sql) {
  const rows = await sql.query("select 1::int as ok");
  return toCount(rows[0]?.ok) === 1;
}

async function safeTableAudit(report, sql, schema, table, auditFn) {
  const columns = schema.get(table);
  const summary = {
    present: Boolean(columns),
    total: 0,
    by: {},
    details: {},
    errors: [],
  };
  report.tableSummaries[table] = summary;
  if (!columns) {
    report.warnings.push(`Optional table not found: ${table}`);
    return summary;
  }

  try {
    summary.total = await countAll(sql, table);
    for (const column of GROUPS[table] ?? []) {
      if (columns.has(column)) {
        summary.by[column] = await countBy(sql, table, column);
      }
    }
    await auditFn(summary, columns);
  } catch (error) {
    const message = safeError(error);
    summary.errors.push(message);
    report.warnings.push(`Could not fully audit ${table}: ${message}`);
  }
  return summary;
}

function addPossibleDemo(possibleDemoRows, row) {
  if (row.reasons.length === 0) return;
  possibleDemoRows.push({
    certainty: "possible",
    ...row,
  });
}

async function auditRestaurants(report, sql, schema, seedSummary) {
  const seedSlugSet = new Set(seedSummary.slugs);
  const seedNameSet = new Set(seedSummary.names.map(normalizeName));
  const columns = schema.get("restaurants");
  if (!columns) return [];

  const selectColumns = ["id", "slug", "name", "market", "status"].filter((column) => columns.has(column));
  const rows = selectColumns.length > 0 ? await selectRows(sql, "restaurants", selectColumns) : [];
  const slugOverlaps = [];
  const nameMatches = [];

  for (const row of rows) {
    const slug = row.slug ?? row.id;
    const normalized = normalizeName(row.name);
    const reasons = [];
    if (seedSlugSet.has(slug)) {
      slugOverlaps.push({
        id: row.id ?? null,
        slug,
        name: row.name ?? null,
        market: row.market ?? null,
        status: row.status ?? null,
      });
      reasons.push("slug overlaps seed slug");
    }
    if (seedNameSet.has(normalized)) {
      nameMatches.push({
        id: row.id ?? null,
        slug,
        name: row.name ?? null,
        market: row.market ?? null,
        status: row.status ?? null,
      });
      reasons.push("name matches seed name");
    }
    if (hasDemoTerm(slug, row.name)) reasons.push("name or slug contains obvious test/demo term");
    if ("market" in row && !hasKnownMarket(row.market)) reasons.push("market is outside known market allow-list");
    if ("status" in row && !["published", "hidden"].includes(String(row.status))) {
      reasons.push("status is outside expected published restaurant statuses");
    }
    addPossibleDemo(report.possibleDemoRows, {
      table: "restaurants",
      id: row.id ?? null,
      slug,
      name: row.name ?? null,
      market: row.market ?? null,
      status: row.status ?? null,
      reasons,
    });
  }

  report.overlaps.restaurantSlugOverlaps = slugOverlaps;
  report.overlaps.restaurantNameMatches = nameMatches;
  return rows;
}

async function auditCandidatesForDemo(report, sql, schema, seedSummary) {
  const seedSlugSet = new Set(seedSummary.slugs);
  const seedNameSet = new Set(seedSummary.names.map(normalizeName));
  const columns = schema.get("candidate_restaurants");
  if (!columns) return;
  const selectColumns = ["id", "slug", "name", "market", "status", "source", "review_notes"].filter((column) =>
    columns.has(column),
  );
  if (selectColumns.length === 0) return;
  const rows = await selectRows(sql, "candidate_restaurants", selectColumns);
  for (const row of rows) {
    const reasons = [];
    if (row.slug && seedSlugSet.has(row.slug)) reasons.push("slug overlaps seed slug");
    if (seedNameSet.has(normalizeName(row.name))) reasons.push("name matches seed name");
    if (hasDemoTerm(row.slug, row.name, row.source, row.review_notes)) {
      reasons.push("candidate text/source contains obvious test/demo term");
    }
    if ("market" in row && !hasKnownMarket(row.market)) reasons.push("market is outside known market allow-list");
    if ("status" in row && !["candidate", "approved", "rejected", "needs_review"].includes(String(row.status))) {
      reasons.push("status is outside expected candidate statuses");
    }
    addPossibleDemo(report.possibleDemoRows, {
      table: "candidate_restaurants",
      id: row.id ?? null,
      slug: row.slug ?? null,
      name: row.name ?? null,
      market: row.market ?? null,
      status: row.status ?? null,
      reasons,
    });
  }
}

async function auditSourcesForDemo(report, sql, schema) {
  const columns = schema.get("restaurant_sources");
  if (!columns) return;
  const selectColumns = ["id", "candidate_id", "source_type", "raw_name", "notes"].filter((column) =>
    columns.has(column),
  );
  if (selectColumns.length === 0) return;
  const rows = await selectRows(sql, "restaurant_sources", selectColumns);
  for (const row of rows) {
    const reasons = [];
    if (hasDemoTerm(row.source_type, row.raw_name, row.notes)) {
      reasons.push("source metadata contains obvious test/demo term");
    }
    addPossibleDemo(report.possibleDemoRows, {
      table: "restaurant_sources",
      id: row.id ?? null,
      candidateRestaurantId: row.candidate_id ?? null,
      name: row.raw_name ?? null,
      sourceType: row.source_type ?? null,
      reasons,
    });
  }
}

async function buildReport(sql, projectDir) {
  const warnings = [];
  const seedSummary = await loadSeedSummary(projectDir, warnings);
  const dbTarget = safeDbTarget(process.env.DATABASE_URL);
  const contentMode = getContentModeReport();
  if (contentMode.warning) warnings.push(contentMode.warning);

  const report = {
    generatedAt: new Date().toISOString(),
    contentMode,
    dbConnectionTarget: dbTarget,
    seedSummary,
    tableSummaries: {},
    overlaps: {
      restaurantSlugOverlaps: [],
      restaurantNameMatches: [],
      restaurantVideosWithSeedRestaurantIds: [],
    },
    possibleDemoRows: [],
    protectedData: [],
    warnings,
    nextSafeAction:
      "Review this report before any future reset. Do not run delete/reset SQL until protected data is backed up and reviewed.",
  };

  const schema = await loadPublicSchema(sql);

  await safeTableAudit(report, sql, schema, "restaurants", async (summary, columns) => {
    if (columns.has("market") && columns.has("status")) {
      summary.by.marketStatus = await countByPair(sql, "restaurants", "market", "status");
    }
    if (columns.has("status")) {
      summary.details.publishedCount = await countWhere(sql, "restaurants", "status = 'published'");
      summary.details.hiddenCount = await countWhere(sql, "restaurants", "status = 'hidden'");
    }
  });

  await safeTableAudit(report, sql, schema, "candidate_restaurants", async (summary, columns) => {
    if (columns.has("market") && columns.has("status")) {
      summary.by.marketStatus = await countByPair(sql, "candidate_restaurants", "market", "status");
    }
    if (columns.has("google_place_id")) {
      summary.details.withGooglePlaceId = await countWhere(sql, "candidate_restaurants", "google_place_id is not null");
    }
    if (columns.has("price_level")) {
      summary.details.missingPriceLevel = await countWhere(sql, "candidate_restaurants", "price_level is null");
    }
    if (columns.has("website_domain")) {
      summary.details.missingWebsite = await countWhere(
        sql,
        "candidate_restaurants",
        "website_domain is null or btrim(website_domain) = ''",
      );
    }
    for (const column of ["cuisine_tags", "vibe_tags", "best_for", "dish_highlights"]) {
      if (columns.has(column)) {
        summary.details[`missing_${column}`] = await countWhere(
          sql,
          "candidate_restaurants",
          `${qIdent(column)} is null or coalesce(cardinality(${qIdent(column)}), 0) = 0`,
        );
      }
    }
  });

  await safeTableAudit(report, sql, schema, "restaurant_videos", async (summary, columns) => {
    if (columns.has("restaurant_id")) {
      const seedSlugs = report.seedSummary.slugs;
      summary.details.linkedToSeedSlugs = await countWhere(
        sql,
        "restaurant_videos",
        "restaurant_id = any($1::text[])",
        [seedSlugs],
      );

      const seedVideoRows = await sql.query(
        "select id, restaurant_id, platform, status from restaurant_videos where restaurant_id = any($1::text[]) order by restaurant_id asc, id asc limit 50",
        [seedSlugs],
      );
      report.overlaps.restaurantVideosWithSeedRestaurantIds = seedVideoRows.map((row) => ({
        id: row.id,
        restaurantId: row.restaurant_id,
        platform: row.platform ?? null,
        status: row.status ?? null,
      }));

      if (schema.has("restaurants")) {
        const linkedRows = await sql.query(
          "select count(*)::int as count from restaurant_videos v where exists (select 1 from restaurants r where r.slug = v.restaurant_id or r.id = v.restaurant_id)",
        );
        summary.details.linkedToDbRestaurants = toCount(linkedRows[0]?.count);
        const orphanRows = await sql.query(
          "select count(*)::int as count from restaurant_videos v where not exists (select 1 from restaurants r where r.slug = v.restaurant_id or r.id = v.restaurant_id) and not (v.restaurant_id = any($1::text[]))",
          [seedSlugs],
        );
        summary.details.orphanLikeRows = toCount(orphanRows[0]?.count);
      }
    }
  });

  await safeTableAudit(report, sql, schema, "video_candidates", async (summary, columns) => {
    if (columns.has("restaurant_slug")) {
      summary.details.withRestaurantSlug = await countWhere(sql, "video_candidates", "restaurant_slug is not null");
    }
    if (columns.has("candidate_restaurant_id")) {
      summary.details.withCandidateRestaurantId = await countWhere(
        sql,
        "video_candidates",
        "candidate_restaurant_id is not null",
      );
    }
    if (columns.has("restaurant_slug") && columns.has("candidate_restaurant_id")) {
      summary.details.withoutRestaurantLink = await countWhere(
        sql,
        "video_candidates",
        "restaurant_slug is null and candidate_restaurant_id is null",
      );
    }
  });

  await safeTableAudit(report, sql, schema, "restaurant_sources", async () => {});

  await safeTableAudit(report, sql, schema, "restaurant_evidence_documents", async (summary, columns) => {
    if (columns.has("fetch_status") && columns.has("cleaned_text")) {
      summary.details.readableOkDocs = await countWhere(
        sql,
        "restaurant_evidence_documents",
        "fetch_status = 'ok' and length(btrim(cleaned_text)) > 0",
      );
      summary.details.emptyOkDocs = await countWhere(
        sql,
        "restaurant_evidence_documents",
        "fetch_status = 'ok' and length(btrim(cleaned_text)) = 0",
      );
    }
    if (columns.has("candidate_restaurant_id")) {
      summary.details.withCandidateAssociation = await countWhere(
        sql,
        "restaurant_evidence_documents",
        "candidate_restaurant_id is not null",
      );
    }
    if (columns.has("restaurant_slug")) {
      summary.details.withRestaurantSlugAssociation = await countWhere(
        sql,
        "restaurant_evidence_documents",
        "restaurant_slug is not null",
      );
    }
  });

  await safeTableAudit(report, sql, schema, "ingestion_jobs", async () => {});

  await auditRestaurants(report, sql, schema, seedSummary);
  await auditCandidatesForDemo(report, sql, schema, seedSummary);
  await auditSourcesForDemo(report, sql, schema);
  report.protectedData = buildProtectedDataWarnings(report);

  return report;
}

function buildProtectedDataWarnings(report) {
  const table = report.tableSummaries;
  const items = [];
  const restaurants = table.restaurants;
  if (restaurants?.present && restaurants.total > 0) {
    items.push({
      label: "DB restaurants",
      count: restaurants.total,
      reason: "Published/hidden launch content candidates may live here.",
    });
  }
  const candidates = table.candidate_restaurants;
  if (candidates?.present && candidates.total > 0) {
    items.push({
      label: "candidate_restaurants",
      count: candidates.total,
      reason: "Review-stage pipeline data; do not reset without export/review.",
    });
  }
  const videos = table.restaurant_videos;
  if (videos?.present && videos.total > 0) {
    items.push({
      label: "restaurant_videos",
      count: videos.total,
      reason: "Attached review video references and attribution.",
    });
  }
  const videoCandidates = table.video_candidates;
  if (videoCandidates?.present && videoCandidates.total > 0) {
    items.push({
      label: "video_candidates",
      count: videoCandidates.total,
      reason: "Review queue state and dedupe records.",
    });
  }
  const evidence = table.restaurant_evidence_documents;
  if (evidence?.present && evidence.total > 0) {
    items.push({
      label: "restaurant_evidence_documents",
      count: evidence.total,
      reason: "Private website evidence used for tag review.",
    });
  }
  const sources = table.restaurant_sources;
  if (sources?.present && sources.total > 0) {
    items.push({
      label: "restaurant_sources",
      count: sources.total,
      reason: "Candidate provenance and import references.",
    });
  }
  const jobs = table.ingestion_jobs;
  if (jobs?.present && jobs.total > 0) {
    items.push({
      label: "ingestion_jobs",
      count: jobs.total,
      reason: "Import audit history.",
    });
  }
  return items;
}

function printSection(title) {
  console.log("");
  console.log(title);
  console.log("-".repeat(title.length));
}

function printTableStatus(label, summary) {
  if (!summary?.present) {
    console.log(`${label}: table not present`);
    return;
  }
  console.log(`${label}: total ${summary.total}`);
}

function printReport(report) {
  printSection("Content mode / environment");
  console.log(`generatedAt: ${report.generatedAt}`);
  console.log(`contentMode: ${report.contentMode.normalized} (${report.contentMode.source})`);
  console.log(`seedVisibility: ${report.contentMode.seedVisibility ? "enabled" : "disabled"}`);
  console.log(`dbTarget: ${report.dbConnectionTarget.label}`);

  printSection("Seed inventory");
  console.log(`seed restaurants: ${report.seedSummary.count}`);
  console.log(`seed markets: ${report.seedSummary.markets.join(", ") || "none"}`);

  printSection("Published restaurants");
  const restaurants = report.tableSummaries.restaurants;
  printTableStatus("restaurants", restaurants);
  if (restaurants?.present) {
    console.log(`by status: ${listCounts(restaurants.by.status)}`);
    console.log(`by market: ${listCounts(restaurants.by.market)}`);
    console.log(`by market/status: ${listCounts(restaurants.by.marketStatus, ["market", "status"])}`);
  }

  printSection("Candidate restaurants");
  const candidates = report.tableSummaries.candidate_restaurants;
  printTableStatus("candidate_restaurants", candidates);
  if (candidates?.present) {
    console.log(`by market: ${listCounts(candidates.by.market)}`);
    console.log(`by status: ${listCounts(candidates.by.status)}`);
    console.log(`by source: ${listCounts(candidates.by.source)}`);
    console.log(`field gaps: ${JSON.stringify(candidates.details)}`);
  }

  printSection("Videos");
  const restaurantVideos = report.tableSummaries.restaurant_videos;
  printTableStatus("restaurant_videos", restaurantVideos);
  if (restaurantVideos?.present) {
    console.log(`by platform: ${listCounts(restaurantVideos.by.platform)}`);
    console.log(`by status: ${listCounts(restaurantVideos.by.status)}`);
    console.log(`by legal display: ${listCounts(restaurantVideos.by.legal_display_status)}`);
    console.log(`linkage: ${JSON.stringify(restaurantVideos.details)}`);
  }
  const videoCandidates = report.tableSummaries.video_candidates;
  printTableStatus("video_candidates", videoCandidates);
  if (videoCandidates?.present) {
    console.log(`by status: ${listCounts(videoCandidates.by.status)}`);
    console.log(`by platform: ${listCounts(videoCandidates.by.platform)}`);
    console.log(`linkage: ${JSON.stringify(videoCandidates.details)}`);
  }

  printSection("Website evidence");
  const evidence = report.tableSummaries.restaurant_evidence_documents;
  printTableStatus("restaurant_evidence_documents", evidence);
  if (evidence?.present) {
    console.log(`by subject: ${listCounts(evidence.by.subject_type)}`);
    console.log(`by fetch status: ${listCounts(evidence.by.fetch_status)}`);
    console.log(`readability/linkage: ${JSON.stringify(evidence.details)}`);
  }

  printSection("Sources / ingestion jobs");
  const sources = report.tableSummaries.restaurant_sources;
  printTableStatus("restaurant_sources", sources);
  if (sources?.present) console.log(`by source type: ${listCounts(sources.by.source_type)}`);
  const jobs = report.tableSummaries.ingestion_jobs;
  printTableStatus("ingestion_jobs", jobs);
  if (jobs?.present) {
    console.log(`by status: ${listCounts(jobs.by.status)}`);
    console.log(`by source: ${listCounts(jobs.by.source)}`);
    console.log(`by dry_run: ${listCounts(jobs.by.dry_run)}`);
  }

  printSection("Seed overlap warnings");
  console.log(
    `DB restaurant slug overlaps: ${limitList(
      report.overlaps.restaurantSlugOverlaps,
      (row) => `${row.slug} (${row.status ?? "unknown"})`,
    )}`,
  );
  console.log(
    `DB restaurant name matches: ${limitList(
      report.overlaps.restaurantNameMatches,
      (row) => `${row.name} (${row.slug ?? "no-slug"})`,
    )}`,
  );
  console.log(
    `restaurant_videos tied to seed slugs: ${limitList(
      report.overlaps.restaurantVideosWithSeedRestaurantIds,
      (row) => `${row.restaurantId}/${row.id}`,
    )}`,
  );

  printSection("Possible demo/test rows");
  console.log(
    limitList(
      report.possibleDemoRows,
      (row) => `${row.table}:${row.slug ?? row.id ?? row.name ?? "unknown"} [${row.reasons.join("; ")}]`,
      12,
    ),
  );

  printSection("Protected data warning");
  console.log(
    limitList(
      report.protectedData,
      (item) => `${item.label}: ${item.count}`,
      12,
    ),
  );

  printSection("Next safe action");
  console.log(report.nextSafeAction);

  if (report.warnings.length > 0) {
    printSection("Warnings");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
}

async function writeExport(report, exportPath, force) {
  if (!exportPath) return;
  const resolved = path.resolve(process.cwd(), exportPath);
  if (existsSync(resolved) && !force) {
    throw new Error(`Export file already exists: ${resolved}. Re-run with --force to overwrite.`);
  }
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log("");
  console.log(`Wrote JSON audit export: ${resolved}${force ? " (overwritten with --force)" : ""}`);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(safeError(error));
    console.error("");
    console.error(usage());
    process.exit(1);
  }

  if (args.exportPath) {
    const resolved = path.resolve(process.cwd(), args.exportPath);
    if (existsSync(resolved) && !args.force) {
      console.error(`Export file already exists: ${resolved}. Re-run with --force to overwrite.`);
      process.exit(1);
    }
  }

  const projectDir = process.cwd();
  const envResult = loadEnvConfig(projectDir);
  const diagnostics = buildDiagnostics(envResult);

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required for content audit. Set it in .env or the current shell.");
    printDiagnostics(diagnostics);
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    await checkConnection(sql);
    console.log(`DB connection OK (${DB_DRIVER_LABEL})`);
    if (args.checkConnection) return;

    const report = await buildReport(sql, projectDir);
    printReport(report);
    await writeExport(report, args.exportPath, args.force);
  } catch (error) {
    console.error(`Content audit failed: ${safeError(error)}`);
    printDiagnostics(diagnostics, error);
    process.exit(1);
  }
}

main();

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AiResult, RunStructuredRequest } from "@/lib/ai/run-structured";
import { localDateKey, localTimeKey } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { platform as platformSchema, type Platform } from "@/lib/schemas/creator";
import { contentItemStatus, type ContentItemStatus } from "@/lib/schemas/enums";
import { EVIDENCE_KIND_LABELS, ideaEvidence, type IdeaEvidence } from "@/lib/schemas/opportunities";
import { parseWith } from "@/lib/schemas/parse";
import {
  contentPackageModelSchemaFor,
  contentPackageOutputFor,
  formatRulesFor,
  parseStoredPackage,
  STUDIO_ERRORS,
  STUDIO_PACKAGE_SCHEMA_VERSION,
  type ContentPackageModelOutput,
  type StudioErrorCode,
  type StudioPackage,
} from "@/lib/schemas/studio";
import type { Database, Json } from "@/lib/supabase/database.types";
import { CALENDAR_ERRORS, instantInWindow, type CalendarFailure } from "./calendar";
import { buildCreatorContext, renderContextForPrompt, type CreatorContext } from "./creator-context";

type StudioClient = Pick<SupabaseClient<Database>, "from" | "rpc">;
type ReadClient = Pick<SupabaseClient<Database>, "from">;

/** A package generation still pending inside this window blocks another one. */
export const IN_FLIGHT_WINDOW_MS = 2 * 60 * 1000;
/** AI versions allowed per item inside `ITEM_LIMIT_WINDOW_MS`. */
export const ITEM_VERSION_LIMIT = 5;
export const ITEM_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Ceiling on the rendered creator context sent with a package request. */
export const CONTEXT_CHAR_LIMIT = 5_000;
/** Items shown on /app/studio. */
export const STUDIO_LIST_LIMIT = 50;

/** Statuses Studio lists and can generate for. `published` and `archived` are read-only. */
export const EDITABLE_STATUSES = ["draft", "ready", "scheduled"] as const satisfies readonly ContentItemStatus[];
const EDITABLE: ReadonlySet<string> = new Set(EDITABLE_STATUSES);

export type StudioFailure = { ok: false; code: StudioErrorCode; message: string; retryable: boolean };

function fail(code: StudioErrorCode): StudioFailure {
  return { ok: false, code, ...STUDIO_ERRORS[code] };
}

function unexpected(event: string, error: unknown) {
  logEvent("error", event, { stage: "unexpected", name: error instanceof Error ? error.name : typeof error });
}

const uuid = z.uuid();

const asPlatform = (value: string | null): Platform | null => {
  const parsed = platformSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

// ---------------------------------------------------------------------------
// Reading one item
// ---------------------------------------------------------------------------

const ITEM_COLUMNS =
  "id, title, platform, format, status, scheduled_for, pillar:content_pillars(name), idea:content_ideas(topic, audience_need, angle, hook, rationale, cta, evidence)";

const itemRow = z.object({
  id: z.string(),
  title: z.string(),
  platform: z.string().nullable(),
  format: z.string().nullable(),
  status: contentItemStatus,
  scheduled_for: z.string().nullable(),
  pillar: z.object({ name: z.string() }).nullable(),
  idea: z
    .object({
      topic: z.string(),
      audience_need: z.string().nullable(),
      angle: z.string().nullable(),
      hook: z.string().nullable(),
      rationale: z.string().nullable(),
      cta: z.string().nullable(),
      evidence: z.unknown(),
    })
    .nullable(),
});

interface LoadedItem {
  id: string;
  title: string;
  platform: Platform | null;
  format: string | null;
  status: ContentItemStatus;
  scheduled_for: string | null;
  pillar_name: string | null;
  idea: {
    topic: string;
    audience_need: string | null;
    angle: string | null;
    hook: string | null;
    rationale: string | null;
    cta: string | null;
    evidence: IdeaEvidence;
  } | null;
}

type ReadItemResult = { ok: true; item: LoadedItem } | { ok: false; code: "not_found" | "read_error" };

/** One of the creator's items with its idea and pillar. Scoped by `user_id` on top of RLS. */
async function readItem(client: ReadClient, userId: string, itemId: string, event: string): Promise<ReadItemResult> {
  const row = await client.from("content_items").select(ITEM_COLUMNS).eq("id", itemId).eq("user_id", userId).maybeSingle();
  if (row.error) {
    logEvent("error", event, { stage: "item", db_code: row.error.code });
    return { ok: false, code: "read_error" };
  }
  if (!row.data) return { ok: false, code: "not_found" };
  const parsed = itemRow.safeParse(row.data);
  if (!parsed.success) {
    logEvent("error", event, { stage: "item_validate" });
    return { ok: false, code: "read_error" };
  }
  const { pillar, idea, ...rest } = parsed.data;
  const evidence = idea ? ideaEvidence.safeParse(idea.evidence) : null;
  return {
    ok: true,
    item: {
      ...rest,
      platform: asPlatform(rest.platform),
      pillar_name: pillar?.name ?? null,
      idea: idea ? { ...idea, evidence: evidence?.success ? evidence.data : [] } : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export type GeneratePackageResult = { ok: true; versionNo: number } | StudioFailure;

type RunPackage = (
  request: RunStructuredRequest<"content_package", ContentPackageModelOutput, StudioPackage>,
) => Promise<AiResult<StudioPackage>>;

export interface StudioDeps {
  /** `runStructured` from `@/lib/ai`; injected so tests never reach a provider. */
  run: RunPackage;
  now?: () => number;
}

/**
 * Prompt text for the creator's context, at most `limit` characters where
 * possible: the oldest recent content goes first, then the oldest performance
 * snapshots, then the oldest insights. Profile, voice, pillars and strategy
 * are never cut (their inputs are already length-bounded).
 */
export function renderCappedContext(context: CreatorContext, limit: number = CONTEXT_CHAR_LIMIT): string {
  const trimmed: CreatorContext = {
    ...context,
    recentContent: [...(context.recentContent ?? [])],
    performance: [...(context.performance ?? [])],
    insights: [...(context.insights ?? [])],
  };
  let rendered = renderContextForPrompt(trimmed);
  for (const section of ["recentContent", "performance", "insights"] as const) {
    const rows = trimmed[section] as unknown[];
    while (rendered.length > limit && rows.length > 0) {
      // Every list is newest first, so the last row is the oldest.
      rows.pop();
      rendered = renderContextForPrompt(trimmed);
    }
  }
  return rendered;
}

const generationFailed = (stage: string, fields: { db_code?: string; code?: string } = {}) =>
  logEvent("error", "content_package_failed", { stage, ...fields });

/**
 * Content Agent: turns one of the creator's Studio items (and its idea) into
 * a full package through the AI service, and stores it as the item's next AI
 * version. Never throws; nothing is stored on failure.
 *
 * `client` acts as the creator (`createUserClient()`); `userId` comes from
 * Clerk's verified session. Metering and the daily cap happen in `run`.
 */
export async function generateContentPackage(
  client: ReadClient,
  userId: string,
  itemId: unknown,
  deps: StudioDeps,
): Promise<GeneratePackageResult> {
  const now = deps.now ?? Date.now;
  const id = uuid.safeParse(itemId);
  if (!id.success) return fail("not_found");

  try {
    // 1. The item, its idea and pillar.
    const loaded = await readItem(client, userId, id.data, "content_package_failed");
    if (!loaded.ok) return fail(loaded.code === "not_found" ? "not_found" : "persistence_error");
    const { item } = loaded;
    if (!EDITABLE.has(item.status)) return fail("not_editable");

    // 2. Creator context.
    const built = await buildCreatorContext(client, userId, {
      include: ["profile", "brand", "pillars", "strategy", "recentContent", "performance", "insights"],
    });
    if (!built.ok) return fail("persistence_error");
    const { context } = built;
    if (!context.profile || !context.strategy) return fail("missing_context");
    const platforms = context.profile.platforms.map(asPlatform).filter((p): p is Platform => p !== null);
    if (platforms.length === 0) return fail("missing_context");

    // 3. Per-item cap: no AI call after 5 packages for this item in 24 hours.
    const since = new Date(now() - ITEM_LIMIT_WINDOW_MS).toISOString();
    const recent = await client
      .from("content_versions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("content_item_id", item.id)
      .eq("source", "ai")
      .gte("created_at", since);
    if (recent.error) {
      generationFailed("item_limit_check", { db_code: recent.error.code });
      return fail("persistence_error");
    }
    if ((recent.count ?? 0) >= ITEM_VERSION_LIMIT) return fail("item_limit");

    // 4. In-flight guard: one pending package generation per creator.
    const pending = await client
      .from("ai_generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", "content_package")
      .eq("status", "pending")
      .gte("created_at", new Date(now() - IN_FLIGHT_WINDOW_MS).toISOString());
    if (pending.error) {
      generationFailed("in_flight_check", { db_code: pending.error.code });
      return fail("persistence_error");
    }
    if ((pending.count ?? 0) > 0) return fail("in_progress");

    // 5. Generate.
    const rules = formatRulesFor(item.platform, item.format);
    const schema = contentPackageOutputFor({ platforms, primaryPlatform: item.platform, format: item.format });
    const idea = item.idea;
    const result = await deps.run({
      userId,
      kind: "content_package",
      input: {
        context: renderCappedContext(context),
        idea: {
          topic: idea?.topic ?? item.title,
          audience_need: idea?.audience_need ?? null,
          angle: idea?.angle ?? null,
          hook: idea?.hook ?? null,
          rationale: idea?.rationale ?? null,
          cta: idea?.cta ?? null,
          pillar: item.pillar_name,
          // Summaries and source names only: no URLs reach the model.
          evidence: (idea?.evidence ?? []).map(
            (entry) => `${EVIDENCE_KIND_LABELS[entry.kind]}: ${entry.summary}${entry.source ? ` (${entry.source})` : ""}`,
          ),
        },
        platform: item.platform,
        format: item.format,
        video: rules.video,
        thumbnailRequired: rules.thumbnailRequired,
        platforms,
      },
      schema: contentPackageModelSchemaFor(platforms),
      validate: (output) => parseWith(schema, output),
    });
    if (!result.ok) {
      generationFailed("ai", { code: result.code });
      return fail(result.code);
    }

    // 6. Store as the next version. A concurrent insert of the same number loses the race.
    const latest = await client
      .from("content_versions")
      .select("version_no")
      .eq("user_id", userId)
      .eq("content_item_id", item.id)
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) {
      generationFailed("version_no", { db_code: latest.error.code });
      return fail("persistence_error");
    }
    const versionNo = (latest.data?.version_no ?? 0) + 1;
    const inserted = await client.from("content_versions").insert({
      user_id: userId,
      content_item_id: item.id,
      version_no: versionNo,
      content: { schema_version: STUDIO_PACKAGE_SCHEMA_VERSION, package: result.data } as unknown as Json,
      source: "ai",
      note: "Generated package",
      ai_generation_id: result.generationId,
    });
    if (inserted.error) {
      generationFailed("insert", { db_code: inserted.error.code });
      return fail(inserted.error.code === "23505" ? "in_progress" : "persistence_error");
    }
    return { ok: true, versionNo };
  } catch (error) {
    unexpected("content_package_failed", error);
    return fail("persistence_error");
  }
}

// ---------------------------------------------------------------------------
// Starting and scheduling
// ---------------------------------------------------------------------------

/**
 * Opens Studio for a saved idea (`start_studio_item`): creates its draft item
 * and moves the idea to `in_production`, or returns the item it already has.
 * Never throws. The database takes the owner from the session token.
 */
export async function startStudioItem(
  client: StudioClient,
  userId: string,
  ideaId: unknown,
): Promise<{ ok: true; itemId: string } | StudioFailure> {
  const id = uuid.safeParse(ideaId);
  if (!id.success) return fail("idea_not_found");
  try {
    const result = await client.rpc("start_studio_item", { p_idea_id: id.data });
    if (result.error) {
      if (result.error.message === "idea_not_found") return fail("idea_not_found");
      if (result.error.message === "idea_not_available") return fail("idea_not_available");
      logEvent("error", "studio_start_failed", { stage: "rpc", db_code: result.error.code });
      return fail("db_error");
    }
    const itemId = uuid.safeParse(result.data);
    if (!itemId.success) {
      logEvent("error", "studio_start_failed", { stage: "result" });
      return fail("db_error");
    }
    return { ok: true, itemId: itemId.data };
  } catch (error) {
    unexpected("studio_start_failed", error);
    return fail("db_error");
  }
}

function calendarFail(code: keyof typeof CALENDAR_ERRORS): CalendarFailure {
  return { ok: false, code, message: CALENDAR_ERRORS[code] };
}

/**
 * Puts a Studio draft on the calendar at a local date and time in `tz`
 * (`schedule_content_item`); its idea moves to `planned`. Never throws.
 */
export async function scheduleStudioItem(
  client: StudioClient,
  userId: string,
  itemId: unknown,
  date: unknown,
  time: unknown,
  tz: string,
  now: number = Date.now(),
): Promise<{ ok: true } | StudioFailure | CalendarFailure> {
  const id = uuid.safeParse(itemId);
  if (!id.success) return fail("not_found");
  if (!localDateKey(now, tz)) return calendarFail("missing_timezone");
  if (typeof date !== "string" || typeof time !== "string") return calendarFail("invalid_input");
  const checked = instantInWindow(date, time, tz, now);
  if (!checked.ok) return checked;

  try {
    const result = await client.rpc("schedule_content_item", { p_item_id: id.data, p_scheduled_for: checked.instant });
    if (result.error) {
      if (result.error.message === "item_not_found") return fail("not_found");
      if (result.error.message === "item_not_draft") return fail("not_draft");
      if (result.error.message === "scheduled_for_out_of_range") return calendarFail("date_past");
      logEvent("error", "studio_schedule_failed", { stage: "rpc", db_code: result.error.code });
      return calendarFail("db_error");
    }
    return { ok: true };
  } catch (error) {
    unexpected("studio_schedule_failed", error);
    return calendarFail("db_error");
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface StudioListItem {
  id: string;
  title: string;
  platform: Platform | null;
  format: string | null;
  status: ContentItemStatus;
  scheduled_for: string | null;
  created_at: string;
  pillar_name: string | null;
  has_package: boolean;
  /** Scheduled, and the time is before now. */
  passed: boolean;
}

const LIST_COLUMNS =
  "id, title, platform, format, status, scheduled_for, created_at, pillar:content_pillars(name), content_versions(version_no)";

const listRow = z.object({
  id: z.string(),
  title: z.string(),
  platform: z.string().nullable(),
  format: z.string().nullable(),
  status: contentItemStatus,
  scheduled_for: z.string().nullable(),
  created_at: z.string(),
  pillar: z.object({ name: z.string() }).nullable(),
  content_versions: z.array(z.object({ version_no: z.number() })).nullable(),
});

const isScheduled = (item: Pick<StudioListItem, "status" | "scheduled_for">) =>
  item.status === "scheduled" && item.scheduled_for !== null;

/** Scheduled items first, soonest first (past dates included); then the rest, newest first. */
export function sortStudioItems<T extends Pick<StudioListItem, "status" | "scheduled_for" | "created_at">>(items: T[]): T[] {
  return items.toSorted((a, b) => {
    const aScheduled = isScheduled(a);
    const bScheduled = isScheduled(b);
    if (aScheduled !== bScheduled) return aScheduled ? -1 : 1;
    if (aScheduled) return Date.parse(a.scheduled_for!) - Date.parse(b.scheduled_for!);
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
}

/**
 * The creator's Studio items (draft, ready, scheduled), ordered for the list,
 * with whether each has a package. Rows that no longer validate are skipped
 * and logged. Never throws.
 */
export async function listStudioItems(
  client: ReadClient,
  userId: string,
  now: number = Date.now(),
): Promise<{ ok: true; items: StudioListItem[] } | { ok: false }> {
  try {
    const rows = await client
      .from("content_items")
      .select(LIST_COLUMNS)
      .eq("user_id", userId)
      .in("status", [...EDITABLE_STATUSES])
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(STUDIO_LIST_LIMIT)
      // Existence only: one version per item is enough.
      .limit(1, { referencedTable: "content_versions" });
    if (rows.error) {
      logEvent("error", "studio_read_failed", { stage: "list", db_code: rows.error.code });
      return { ok: false };
    }

    const items: StudioListItem[] = [];
    for (const row of rows.data ?? []) {
      const parsed = listRow.safeParse(row);
      if (!parsed.success) {
        logEvent("warn", "studio_read_skipped", { stage: "list_validate" });
        continue;
      }
      const { pillar, content_versions: versions, ...rest } = parsed.data;
      const item = {
        ...rest,
        platform: asPlatform(rest.platform),
        pillar_name: pillar?.name ?? null,
        has_package: (versions ?? []).length > 0,
      };
      items.push({ ...item, passed: isScheduled(item) && Date.parse(item.scheduled_for!) < now });
    }
    return { ok: true, items: sortStudioItems(items) };
  } catch (error) {
    unexpected("studio_read_failed", error);
    return { ok: false };
  }
}

export interface StudioItem extends LoadedItem {
  /** Local date and time in the creator's zone, when scheduled and a zone is known. */
  date: string | null;
  time: string | null;
  passed: boolean;
  /** The highest version; `package` is null when it can't be read. */
  latest: { version_no: number; created_at: string; package: StudioPackage | null } | null;
}

export type GetStudioItemResult = { ok: true; item: StudioItem } | { ok: false; code: "not_found" | "read_error" };

/**
 * One of the creator's items with its latest version, for /app/studio/[id].
 * An invalid id, a missing item or another creator's item is `not_found`.
 * Never throws.
 */
export async function getStudioItem(
  client: ReadClient,
  userId: string,
  itemId: unknown,
  tz: string | null,
  now: number = Date.now(),
): Promise<GetStudioItemResult> {
  const id = uuid.safeParse(itemId);
  if (!id.success) return { ok: false, code: "not_found" };
  try {
    const [loaded, version] = await Promise.all([
      readItem(client, userId, id.data, "studio_read_failed"),
      client
        .from("content_versions")
        .select("version_no, content, created_at")
        .eq("user_id", userId)
        .eq("content_item_id", id.data)
        .order("version_no", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (!loaded.ok) return loaded;
    if (version.error) {
      logEvent("error", "studio_read_failed", { stage: "version", db_code: version.error.code });
      return { ok: false, code: "read_error" };
    }

    const { item } = loaded;
    let latest: StudioItem["latest"] = null;
    if (version.data) {
      const stored = parseStoredPackage(version.data.content);
      if (!stored.ok) logEvent("warn", "studio_read_skipped", { stage: "version_validate" });
      latest = {
        version_no: version.data.version_no,
        created_at: version.data.created_at,
        package: stored.ok ? stored.package : null,
      };
    }

    const scheduled = item.status === "scheduled" ? item.scheduled_for : null;
    return {
      ok: true,
      item: {
        ...item,
        date: scheduled && tz ? localDateKey(scheduled, tz) : null,
        time: scheduled && tz ? localTimeKey(scheduled, tz) : null,
        passed: scheduled !== null && Date.parse(scheduled) < now,
        latest,
      },
    };
  } catch (error) {
    unexpected("studio_read_failed", error);
    return { ok: false, code: "read_error" };
  }
}

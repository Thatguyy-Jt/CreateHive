import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AiResult, RunStructuredRequest } from "@/lib/ai/run-structured";
import { localDateKey, localTimeKey } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { platform as platformSchema, type Platform } from "@/lib/schemas/creator";
import { authorSource, contentItemStatus, type AuthorSource, type ContentItemStatus } from "@/lib/schemas/enums";
import { EVIDENCE_KIND_LABELS, ideaEvidence, type IdeaEvidence } from "@/lib/schemas/opportunities";
import { parseWith } from "@/lib/schemas/parse";
import {
  contentPackageModelSchemaFor,
  contentPackageOutputFor,
  describeIssue,
  editedNote,
  formatRulesFor,
  GENERATED_NOTE,
  parseStoredPackage,
  REGENERATED_NOTE_PREFIX,
  regeneratedNote,
  restoredNote,
  SECTION_KEYS,
  SECTION_LABELS,
  sectionInputFor,
  sectionKey,
  sectionModelSchemaFor,
  sectionOutputFor,
  sectionTexts,
  STUDIO_ERRORS,
  STUDIO_PACKAGE_SCHEMA_VERSION,
  userPackageFor,
  type ContentPackageModelOutput,
  type SectionKey,
  type SectionModelOutput,
  type SectionValue,
  type StudioErrorCode,
  type StudioPackage,
} from "@/lib/schemas/studio";
import type { Database, Json } from "@/lib/supabase/database.types";
import { CALENDAR_ERRORS, instantInWindow, type CalendarFailure } from "./calendar";
import { buildCreatorContext, renderContextForPrompt, type CreatorContext } from "./creator-context";

type StudioClient = Pick<SupabaseClient<Database>, "from" | "rpc">;
type ReadClient = Pick<SupabaseClient<Database>, "from">;

/** A package or section generation still pending inside this window blocks another one. */
export const IN_FLIGHT_WINDOW_MS = 2 * 60 * 1000;
/** Whole-package generations allowed per item inside `ITEM_LIMIT_WINDOW_MS`. */
export const ITEM_VERSION_LIMIT = 5;
/** Section regenerations allowed per item inside `ITEM_LIMIT_WINDOW_MS`. */
export const SECTION_REGENERATION_LIMIT = 10;
export const ITEM_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Most versions one item may have; version numbers are sequential, so the latest number is the count. */
export const MAX_VERSIONS_PER_ITEM = 100;
/** Versions listed in History. */
export const HISTORY_LIMIT = 20;
/** Longest "what should change?" note sent with a section regeneration. */
export const INSTRUCTION_MAX_LENGTH = 200;
/** Ceiling on the rendered creator context sent with a package request. */
export const CONTEXT_CHAR_LIMIT = 5_000;
/** Items shown on /app/studio. */
export const STUDIO_LIST_LIMIT = 50;

/** The AI kinds the in-flight guard covers: one Studio generation at a time per creator. */
const STUDIO_AI_KINDS = ["content_package", "content_section"];

/** Statuses Studio lists and can generate for. `published` and `archived` are read-only. */
export const EDITABLE_STATUSES = ["draft", "ready", "scheduled"] as const satisfies readonly ContentItemStatus[];
const EDITABLE: ReadonlySet<string> = new Set(EDITABLE_STATUSES);

export type StudioFailure = { ok: false; code: StudioErrorCode; message: string; retryable: boolean };

function fail(code: StudioErrorCode): StudioFailure {
  return { ok: false, code, ...STUDIO_ERRORS[code] };
}

/** `invalid_input` with a message naming the field that doesn't fit. */
function invalid(issues: readonly z.core.$ZodIssue[]): StudioFailure {
  const first = issues[0];
  return { ok: false, code: "invalid_input", message: first ? describeIssue(first) : STUDIO_ERRORS.invalid_input.message, retryable: false };
}

function unexpected(event: string, error: unknown) {
  logEvent("error", event, { stage: "unexpected", name: error instanceof Error ? error.name : typeof error });
}

const uuid = z.uuid();

const asPlatform = (value: string | null): Platform | null => {
  const parsed = platformSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const storedContent = (pkg: StudioPackage) => ({ schema_version: STUDIO_PACKAGE_SCHEMA_VERSION, package: pkg }) as unknown as Json;

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

/** An item the creator may change: theirs, and draft, ready or scheduled. */
async function readEditableItem(
  client: ReadClient,
  userId: string,
  itemId: string,
  event: string,
): Promise<{ ok: true; item: LoadedItem } | StudioFailure> {
  const loaded = await readItem(client, userId, itemId, event);
  if (!loaded.ok) return fail(loaded.code === "not_found" ? "not_found" : "persistence_error");
  if (!EDITABLE.has(loaded.item.status)) return fail("not_editable");
  return loaded;
}

type LatestResult =
  | { ok: true; latest: { version_no: number; package: StudioPackage | null } | null }
  | StudioFailure;

/** The item's highest version, with its package (null when unreadable). */
async function readLatestVersion(client: ReadClient, userId: string, itemId: string, event: string): Promise<LatestResult> {
  const row = await client
    .from("content_versions")
    .select("version_no, content")
    .eq("user_id", userId)
    .eq("content_item_id", itemId)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (row.error) {
    logEvent("error", event, { stage: "latest_version", db_code: row.error.code });
    return fail("persistence_error");
  }
  if (!row.data) return { ok: true, latest: null };
  const stored = parseStoredPackage(row.data.content);
  return { ok: true, latest: { version_no: row.data.version_no, package: stored.ok ? stored.package : null } };
}

/** The creator's selected platforms (repurposing may only target these). */
async function readPlatforms(
  client: ReadClient,
  userId: string,
  event: string,
): Promise<{ ok: true; platforms: Platform[] } | StudioFailure> {
  const row = await client.from("creator_profiles").select("platforms").eq("user_id", userId).maybeSingle();
  if (row.error) {
    logEvent("error", event, { stage: "platforms", db_code: row.error.code });
    return fail("persistence_error");
  }
  const platforms = (row.data?.platforms ?? []).map(asPlatform).filter((p): p is Platform => p !== null);
  return { ok: true, platforms };
}

/** Appends one version. Another write with the same number got there first: `version_conflict`. */
async function insertVersion(
  client: ReadClient,
  event: string,
  row: Database["public"]["Tables"]["content_versions"]["Insert"],
): Promise<{ ok: true } | StudioFailure> {
  const inserted = await client.from("content_versions").insert(row);
  if (!inserted.error) return { ok: true };
  logEvent("error", event, { stage: "insert", db_code: inserted.error.code });
  return fail(inserted.error.code === "23505" ? "version_conflict" : "persistence_error");
}

const generationFailed = (stage: string, fields: { db_code?: string; code?: string } = {}) =>
  logEvent("error", "content_package_failed", { stage, ...fields });

/** Context, platforms and idea input shared by both AI tasks. */
async function buildGenerationInput(
  client: ReadClient,
  userId: string,
  item: LoadedItem,
): Promise<
  | {
      ok: true;
      context: string;
      platforms: Platform[];
      idea: {
        topic: string;
        audience_need: string | null;
        angle: string | null;
        hook: string | null;
        rationale: string | null;
        cta: string | null;
        pillar: string | null;
        evidence: string[];
      };
    }
  | StudioFailure
> {
  const built = await buildCreatorContext(client, userId, {
    include: ["profile", "brand", "pillars", "strategy", "recentContent", "performance", "insights"],
  });
  if (!built.ok) return fail("persistence_error");
  const { context } = built;
  if (!context.profile || !context.strategy) return fail("missing_context");
  const platforms = context.profile.platforms.map(asPlatform).filter((p): p is Platform => p !== null);
  if (platforms.length === 0) return fail("missing_context");

  const idea = item.idea;
  return {
    ok: true,
    context: renderCappedContext(context),
    platforms,
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
  };
}

/** One pending Studio generation (package or section) per creator at a time. */
async function checkInFlight(client: ReadClient, userId: string, now: number): Promise<{ ok: true } | StudioFailure> {
  const pending = await client
    .from("ai_generations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("kind", STUDIO_AI_KINDS)
    .eq("status", "pending")
    .gte("created_at", new Date(now - IN_FLIGHT_WINDOW_MS).toISOString());
  if (pending.error) {
    generationFailed("in_flight_check", { db_code: pending.error.code });
    return fail("persistence_error");
  }
  return (pending.count ?? 0) > 0 ? fail("in_progress") : { ok: true };
}

// ---------------------------------------------------------------------------
// Whole-package generation
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
    const loaded = await readEditableItem(client, userId, id.data, "content_package_failed");
    if (!loaded.ok) return loaded;
    const { item } = loaded;

    // 2. Creator context.
    const input = await buildGenerationInput(client, userId, item);
    if (!input.ok) return input;
    const { platforms } = input;

    // 3. Per-item cap: no AI call after 5 whole packages for this item in 24 hours.
    const since = new Date(now() - ITEM_LIMIT_WINDOW_MS).toISOString();
    const recent = await client
      .from("content_versions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("content_item_id", item.id)
      .eq("source", "ai")
      .eq("note", GENERATED_NOTE)
      .gte("created_at", since);
    if (recent.error) {
      generationFailed("item_limit_check", { db_code: recent.error.code });
      return fail("persistence_error");
    }
    if ((recent.count ?? 0) >= ITEM_VERSION_LIMIT) return fail("item_limit");

    // 4. In-flight guard.
    const guard = await checkInFlight(client, userId, now());
    if (!guard.ok) return guard;

    // 5. Generate.
    const rules = formatRulesFor(item.platform, item.format);
    const schema = contentPackageOutputFor({ platforms, primaryPlatform: item.platform, format: item.format });
    const result = await deps.run({
      userId,
      kind: "content_package",
      input: {
        context: input.context,
        idea: input.idea,
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
    if (versionNo > MAX_VERSIONS_PER_ITEM) return fail("version_limit");
    const inserted = await insertVersion(client, "content_package_failed", {
      user_id: userId,
      content_item_id: item.id,
      version_no: versionNo,
      content: storedContent(result.data),
      source: "ai",
      note: GENERATED_NOTE,
      ai_generation_id: result.generationId,
    });
    if (!inserted.ok) return inserted.code === "version_conflict" ? fail("in_progress") : inserted;
    return { ok: true, versionNo };
  } catch (error) {
    unexpected("content_package_failed", error);
    return fail("persistence_error");
  }
}

// ---------------------------------------------------------------------------
// Editing and restoring (no AI)
// ---------------------------------------------------------------------------

export type SaveVersionResult = { ok: true; versionNo: number } | StudioFailure;

const saveInput = z.object({
  baseVersion: z.number().int().positive(),
  section: sectionKey,
  value: z.unknown(),
});

/**
 * Saves the creator's edit of one section as a new version (`source: 'user'`).
 * The server merges the section into the latest package, so the browser never
 * sends a whole package; a stale `baseVersion` is a conflict. Never throws.
 */
export async function savePackageSection(
  client: ReadClient,
  userId: string,
  itemId: unknown,
  input: unknown,
): Promise<SaveVersionResult> {
  const id = uuid.safeParse(itemId);
  if (!id.success) return fail("not_found");
  const parsed = saveInput.safeParse(input);
  if (!parsed.success) return fail("invalid_input");
  const { baseVersion, section } = parsed.data;
  const value = sectionInputFor(section).safeParse(parsed.data.value);
  if (!value.success) return invalid(value.error.issues);

  try {
    const loaded = await readEditableItem(client, userId, id.data, "studio_save_failed");
    if (!loaded.ok) return loaded;

    const [latestResult, platformResult] = await Promise.all([
      readLatestVersion(client, userId, id.data, "studio_save_failed"),
      readPlatforms(client, userId, "studio_save_failed"),
    ]);
    if (!latestResult.ok) return latestResult;
    if (!platformResult.ok) return platformResult;
    const { latest } = latestResult;
    if (!latest) return fail("version_not_found");
    if (latest.version_no !== baseVersion) return fail("version_conflict");
    if (!latest.package) return fail("unreadable_version");
    if (latest.version_no >= MAX_VERSIONS_PER_ITEM) return fail("version_limit");

    const merged = userPackageFor({ platforms: platformResult.platforms }).safeParse({ ...latest.package, ...value.data });
    if (!merged.success) return invalid(merged.error.issues);

    const versionNo = baseVersion + 1;
    const inserted = await insertVersion(client, "studio_save_failed", {
      user_id: userId,
      content_item_id: id.data,
      version_no: versionNo,
      content: storedContent(merged.data),
      source: "user",
      note: editedNote(section),
    });
    return inserted.ok ? { ok: true, versionNo } : inserted;
  } catch (error) {
    unexpected("studio_save_failed", error);
    return fail("persistence_error");
  }
}

const restoreInput = z.object({ versionNo: z.number().int().positive(), baseVersion: z.number().int().positive() });

/**
 * Restores a past version by copying its package into a new latest version.
 * History is never rewritten. Never throws.
 */
export async function restoreVersion(
  client: ReadClient,
  userId: string,
  itemId: unknown,
  input: unknown,
): Promise<SaveVersionResult> {
  const id = uuid.safeParse(itemId);
  if (!id.success) return fail("not_found");
  const parsed = restoreInput.safeParse(input);
  if (!parsed.success) return fail("invalid_input");
  const { versionNo, baseVersion } = parsed.data;

  try {
    const loaded = await readEditableItem(client, userId, id.data, "studio_restore_failed");
    if (!loaded.ok) return loaded;
    const latestResult = await readLatestVersion(client, userId, id.data, "studio_restore_failed");
    if (!latestResult.ok) return latestResult;
    const { latest } = latestResult;
    if (!latest) return fail("version_not_found");
    if (latest.version_no !== baseVersion) return fail("version_conflict");
    if (versionNo === latest.version_no) return fail("already_latest");
    if (latest.version_no >= MAX_VERSIONS_PER_ITEM) return fail("version_limit");

    const target = await client
      .from("content_versions")
      .select("content")
      .eq("user_id", userId)
      .eq("content_item_id", id.data)
      .eq("version_no", versionNo)
      .maybeSingle();
    if (target.error) {
      logEvent("error", "studio_restore_failed", { stage: "target", db_code: target.error.code });
      return fail("persistence_error");
    }
    if (!target.data) return fail("version_not_found");
    const stored = parseStoredPackage(target.data.content);
    if (!stored.ok) return fail("unreadable_version");

    const next = baseVersion + 1;
    const inserted = await insertVersion(client, "studio_restore_failed", {
      user_id: userId,
      content_item_id: id.data,
      version_no: next,
      content: storedContent(stored.package),
      source: "user",
      note: restoredNote(versionNo),
    });
    return inserted.ok ? { ok: true, versionNo: next } : inserted;
  } catch (error) {
    unexpected("studio_restore_failed", error);
    return fail("persistence_error");
  }
}

// ---------------------------------------------------------------------------
// Section regeneration
// ---------------------------------------------------------------------------

type RunSection = (
  request: RunStructuredRequest<"content_section", SectionModelOutput, SectionValue>,
) => Promise<AiResult<SectionValue>>;

export interface SectionDeps {
  /** `runStructured` from `@/lib/ai`; injected so tests never reach a provider. */
  run: RunSection;
  now?: () => number;
}

const regenerateInput = z.object({
  section: sectionKey,
  baseVersion: z.number().int().positive(),
  instruction: z
    .string()
    .nullable()
    .transform((value) => value?.trim() || null)
    .pipe(z.string().max(INSTRUCTION_MAX_LENGTH).nullable()),
});

/**
 * Sections that can be regenerated for this item: a shot list only for video
 * formats or when there are shots, a thumbnail only when the format needs one
 * or there is one already.
 */
export function regenerableSections(
  pkg: StudioPackage,
  rules: { video: boolean; thumbnailRequired: boolean },
): SectionKey[] {
  return SECTION_KEYS.filter((key) => {
    if (key === "shot_list") return rules.video || pkg.shot_list.length > 0;
    if (key === "thumbnail") return rules.thumbnailRequired || pkg.thumbnail !== null;
    return true;
  });
}

/**
 * Regenerates one section of the latest package through the AI service and
 * stores the merged package as a new AI version. Only that section changes.
 * Never throws; nothing is stored on failure.
 */
export async function regenerateSection(
  client: ReadClient,
  userId: string,
  itemId: unknown,
  input: unknown,
  deps: SectionDeps,
): Promise<SaveVersionResult> {
  const now = deps.now ?? Date.now;
  const id = uuid.safeParse(itemId);
  if (!id.success) return fail("not_found");
  const parsed = regenerateInput.safeParse(input);
  if (!parsed.success) return fail("invalid_input");
  const { section, baseVersion, instruction } = parsed.data;

  try {
    // 1. The item and its latest package.
    const loaded = await readEditableItem(client, userId, id.data, "content_section_failed");
    if (!loaded.ok) return loaded;
    const { item } = loaded;
    const latestResult = await readLatestVersion(client, userId, id.data, "content_section_failed");
    if (!latestResult.ok) return latestResult;
    const { latest } = latestResult;
    if (!latest) return fail("version_not_found");
    if (latest.version_no !== baseVersion) return fail("version_conflict");
    if (!latest.package) return fail("unreadable_version");
    if (latest.version_no >= MAX_VERSIONS_PER_ITEM) return fail("version_limit");
    const rules = formatRulesFor(item.platform, item.format);
    if (!regenerableSections(latest.package, rules).includes(section)) return fail("invalid_input");

    // 2. Creator context.
    const generation = await buildGenerationInput(client, userId, item);
    if (!generation.ok) return generation;
    const { platforms } = generation;

    // 3. Section cap: no AI call after 10 section regenerations for this item in 24 hours.
    const recent = await client
      .from("content_versions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("content_item_id", item.id)
      .eq("source", "ai")
      .like("note", `${REGENERATED_NOTE_PREFIX}%`)
      .gte("created_at", new Date(now() - ITEM_LIMIT_WINDOW_MS).toISOString());
    if (recent.error) {
      logEvent("error", "content_section_failed", { stage: "section_limit_check", db_code: recent.error.code });
      return fail("persistence_error");
    }
    if ((recent.count ?? 0) >= SECTION_REGENERATION_LIMIT) return fail("section_limit");

    // 4. In-flight guard.
    const guard = await checkInFlight(client, userId, now());
    if (!guard.ok) return guard;

    // 5. Generate only this section, with the current package as context.
    const texts = sectionTexts(latest.package);
    const schema = sectionOutputFor(section, { platforms, video: rules.video });
    const result = await deps.run({
      userId,
      kind: "content_section",
      input: {
        context: generation.context,
        idea: generation.idea,
        platform: item.platform,
        format: item.format,
        video: rules.video,
        platforms,
        section,
        packageSections: SECTION_KEYS.map((key) => ({ section: key, label: SECTION_LABELS[key], text: texts[key] })),
        instruction,
      },
      schema: sectionModelSchemaFor(section, platforms),
      validate: (output) => parseWith(schema as z.ZodType<SectionValue>, output),
    });
    if (!result.ok) {
      logEvent("error", "content_section_failed", { stage: "ai", code: result.code });
      return fail(result.code);
    }

    // 6. Merge and store. A concurrent edit in the meantime is a conflict.
    const versionNo = baseVersion + 1;
    const inserted = await insertVersion(client, "content_section_failed", {
      user_id: userId,
      content_item_id: item.id,
      version_no: versionNo,
      content: storedContent({ ...latest.package, ...result.data }),
      source: "ai",
      note: regeneratedNote(section),
      ai_generation_id: result.generationId,
    });
    return inserted.ok ? { ok: true, versionNo } : inserted;
  } catch (error) {
    unexpected("content_section_failed", error);
    return fail("persistence_error");
  }
}

// ---------------------------------------------------------------------------
// Starting, scheduling and discarding
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

/**
 * Deletes a Studio draft and all its versions, and returns its idea to Saved
 * (`discard_studio_item`). Drafts only. Never throws.
 */
export async function discardStudioItem(
  client: StudioClient,
  userId: string,
  itemId: unknown,
): Promise<{ ok: true } | StudioFailure> {
  const id = uuid.safeParse(itemId);
  if (!id.success) return fail("not_found");
  try {
    const result = await client.rpc("discard_studio_item", { p_item_id: id.data });
    if (result.error) {
      if (result.error.message === "item_not_found") return fail("not_found");
      if (result.error.message === "item_not_draft") return fail("not_draft");
      logEvent("error", "studio_discard_failed", { stage: "rpc", db_code: result.error.code });
      return fail("db_error");
    }
    return { ok: true };
  } catch (error) {
    unexpected("studio_discard_failed", error);
    return fail("db_error");
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

export interface StudioVersion {
  version_no: number;
  source: AuthorSource;
  note: string | null;
  created_at: string;
  /** The package; null when it can't be read. */
  package: StudioPackage | null;
}

export interface StudioItem extends LoadedItem {
  /** Local date and time in the creator's zone, when scheduled and a zone is known. */
  date: string | null;
  time: string | null;
  passed: boolean;
  /** The version in view: the requested one, else the latest. Null when there is none (or the requested one is missing). */
  version: StudioVersion | null;
  /** The highest version number, or null when the item has no package yet. */
  latestVersionNo: number | null;
  /** A specific version was requested and it doesn't exist for this item. */
  missingVersion: boolean;
  /** The creator's platforms, for the repurposing editor. */
  platforms: Platform[];
}

export type GetStudioItemResult = { ok: true; item: StudioItem } | { ok: false; code: "not_found" | "read_error" };

const VERSION_COLUMNS = "version_no, source, note, created_at, content";

const versionRow = z.object({
  version_no: z.number(),
  source: authorSource,
  note: z.string().nullable(),
  created_at: z.string(),
  content: z.unknown(),
});

function toVersion(row: unknown): StudioVersion | null {
  const parsed = versionRow.safeParse(row);
  if (!parsed.success) return null;
  const { content, ...rest } = parsed.data;
  const stored = parseStoredPackage(content);
  if (!stored.ok) logEvent("warn", "studio_read_skipped", { stage: "version_validate" });
  return { ...rest, package: stored.ok ? stored.package : null };
}

/**
 * One of the creator's items with the version in view (`options.versionNo`, else the
 * latest), for /app/studio/[id]. An invalid id, a missing item or another
 * creator's item is `not_found`. Never throws.
 */
export async function getStudioItem(
  client: ReadClient,
  userId: string,
  itemId: unknown,
  tz: string | null,
  options: { now?: number; versionNo?: number | null } = {},
): Promise<GetStudioItemResult> {
  const now = options.now ?? Date.now();
  const versionNo = options.versionNo ?? null;
  const id = uuid.safeParse(itemId);
  if (!id.success) return { ok: false, code: "not_found" };
  const versions = () =>
    client.from("content_versions").select(VERSION_COLUMNS).eq("user_id", userId).eq("content_item_id", id.data);
  try {
    const [loaded, latest, requested, platforms] = await Promise.all([
      readItem(client, userId, id.data, "studio_read_failed"),
      versions().order("version_no", { ascending: false }).limit(1).maybeSingle(),
      versionNo === null ? null : versions().eq("version_no", versionNo).maybeSingle(),
      readPlatforms(client, userId, "studio_read_failed"),
    ]);
    if (!loaded.ok) return loaded;
    const error = latest.error ?? requested?.error;
    if (error) {
      logEvent("error", "studio_read_failed", { stage: "version", db_code: error.code });
      return { ok: false, code: "read_error" };
    }
    if (!platforms.ok) return { ok: false, code: "read_error" };

    const latestVersion = latest.data ? toVersion(latest.data) : null;
    const version = requested ? (requested.data ? toVersion(requested.data) : null) : latestVersion;
    const { item } = loaded;
    const scheduled = item.status === "scheduled" ? item.scheduled_for : null;
    return {
      ok: true,
      item: {
        ...item,
        date: scheduled && tz ? localDateKey(scheduled, tz) : null,
        time: scheduled && tz ? localTimeKey(scheduled, tz) : null,
        passed: scheduled !== null && Date.parse(scheduled) < now,
        version,
        latestVersionNo: latestVersion?.version_no ?? null,
        missingVersion: requested !== null && !requested.data,
        platforms: platforms.platforms,
      },
    };
  } catch (error) {
    unexpected("studio_read_failed", error);
    return { ok: false, code: "read_error" };
  }
}

export interface VersionSummary {
  version_no: number;
  source: AuthorSource;
  note: string | null;
  created_at: string;
  /** Local date and time in the creator's zone, when one is known. */
  date: string | null;
  time: string | null;
}

/** The item's latest 20 versions, newest first, without their content. Never throws. */
export async function listVersions(
  client: ReadClient,
  userId: string,
  itemId: unknown,
  tz: string | null,
): Promise<{ ok: true; versions: VersionSummary[] } | { ok: false }> {
  const id = uuid.safeParse(itemId);
  if (!id.success) return { ok: false };
  try {
    const rows = await client
      .from("content_versions")
      .select("version_no, source, note, created_at")
      .eq("user_id", userId)
      .eq("content_item_id", id.data)
      .order("version_no", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (rows.error) {
      logEvent("error", "studio_read_failed", { stage: "history", db_code: rows.error.code });
      return { ok: false };
    }
    const versions: VersionSummary[] = [];
    for (const row of rows.data ?? []) {
      const parsed = versionRow.omit({ content: true }).safeParse(row);
      if (!parsed.success) {
        logEvent("warn", "studio_read_skipped", { stage: "history_validate" });
        continue;
      }
      versions.push({
        ...parsed.data,
        date: tz ? localDateKey(parsed.data.created_at, tz) : null,
        time: tz ? localTimeKey(parsed.data.created_at, tz) : null,
      });
    }
    return { ok: true, versions };
  } catch (error) {
    unexpected("studio_read_failed", error);
    return { ok: false };
  }
}

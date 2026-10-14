import type { SupabaseClient } from "@supabase/supabase-js";
import { shiftWeek, todayIn, weekStart } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { experienceLevel, type Difficulty, type ExperienceLevel, type SignalLevel } from "@/lib/schemas/enums";
import { normalizeTopic, storedOpportunity, type StoredOpportunity } from "@/lib/schemas/opportunities";
import { parseWith } from "@/lib/schemas/parse";
import type { Database } from "@/lib/supabase/database.types";
import { getCalendarSetup, listWeek, type CalendarItem } from "./calendar";

// "What should I do today?": one action computed from the creator's own data
// with fixed rules. No AI, nothing stored; the same data always gives the
// same recommendation, and every reason traces back to a fact.

type ReadClient = Pick<SupabaseClient<Database>, "from">;

/** Saved and new ideas considered, newest first. */
export const CANDIDATE_LIMIT = 70;
/** Most reasons shown for one idea. */
export const MAX_REASONS = 3;

/** A stored idea plus the ranking factors that applied to it, in order. */
export interface RankedIdea extends StoredOpportunity {
  reasons: string[];
}

export type Recommendation =
  | { kind: "finish_setup" }
  | { kind: "build_strategy" }
  | { kind: "confirm_timezone" }
  | { kind: "make_today"; item: CalendarItem; moreToday: number }
  /** `room` is null when the creator hasn't set a posting capacity. */
  | { kind: "schedule_saved"; idea: RankedIdea; room: number | null }
  | { kind: "review_new"; idea: RankedIdea; count: number }
  | { kind: "plan_next_week"; nextWeek: string; scheduled: number; savedCount: number }
  | { kind: "generate_ideas" };

export type RecommendationKind = Recommendation["kind"];

export type DailyRecommendationResult =
  | { ok: true; today: string | null; recommendation: Recommendation; nextIdea: RankedIdea | null }
  | { ok: false };

const CANDIDATE_COLUMNS =
  "id, topic, audience_need, angle, hook, format, platform, rationale, cta, difficulty, audience_fit, evidence_strength, evidence, status, created_at, pillar:content_pillars(name)";

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

const LEVEL_RANK: Record<SignalLevel, number> = { high: 3, medium: 2, low: 1 };
const LEVEL_LABEL: Record<SignalLevel, string> = { high: "High", medium: "Medium", low: "Low" };

/** Higher is a better fit; equal ranks mean no preference. */
const DIFFICULTY_RANK: Record<ExperienceLevel, Record<Difficulty, number>> = {
  beginner: { easy: 3, medium: 2, hard: 1 },
  growing: { easy: 2, medium: 2, hard: 1 },
  established: { easy: 0, medium: 0, hard: 0 },
};

export interface RankContext {
  /** Null when unknown: no difficulty preference. */
  experience: ExperienceLevel | null;
  /** Pillar names with something scheduled this week. */
  plannedPillars: readonly string[];
}

function pillarIsOpen(idea: StoredOpportunity, planned: ReadonlySet<string>): boolean {
  return idea.pillar_name !== null && !planned.has(normalizeTopic(idea.pillar_name));
}

const levelRank = (level: SignalLevel | null) => (level ? LEVEL_RANK[level] : 0);

function difficultyRank(idea: StoredOpportunity, experience: ExperienceLevel | null): number {
  return idea.difficulty && experience ? DIFFICULTY_RANK[experience][idea.difficulty] : 0;
}

/** Signals cited by the evidence (items with a source). */
function signalCount(idea: StoredOpportunity): number {
  return idea.evidence.filter((item) => item.source).length;
}

/** The difficulty reason, only when the difficulty is a good fit for the creator's experience. */
function difficultyReason(idea: StoredOpportunity, experience: ExperienceLevel | null): string | null {
  if (!idea.difficulty || !experience || experience === "established") return null;
  if (idea.difficulty === "easy") return "Easy to make";
  if (idea.difficulty === "medium" && experience === "growing") return "Medium effort, within reach for you";
  return null;
}

function reasonsFor(idea: StoredOpportunity, context: RankContext, planned: ReadonlySet<string>): string[] {
  const reasons: string[] = [];
  if (pillarIsOpen(idea, planned)) reasons.push(`Your “${idea.pillar_name}” pillar has nothing planned this week`);
  if (idea.evidence_strength === "high" || idea.evidence_strength === "medium") {
    const signals = signalCount(idea);
    const detail = signals ? `: ${signals === 1 ? "1 signal" : `${signals} signals`}` : "";
    reasons.push(`${LEVEL_LABEL[idea.evidence_strength]} evidence${detail}`);
  }
  if (idea.audience_fit === "high" || idea.audience_fit === "medium") {
    reasons.push(`${LEVEL_LABEL[idea.audience_fit]} audience fit (AI judgment)`);
  }
  const difficulty = difficultyReason(idea, context.experience);
  if (difficulty) reasons.push(difficulty);
  return reasons.slice(0, MAX_REASONS);
}

/**
 * Orders ideas best first: pillar with nothing planned this week, then
 * evidence strength, then audience fit, then difficulty for the creator's
 * experience, then newest. Pure and deterministic. No score is produced.
 */
export function rankIdeas(ideas: readonly StoredOpportunity[], context: RankContext): RankedIdea[] {
  const planned = new Set(context.plannedPillars.map(normalizeTopic));
  const keyed = ideas.map((idea) => ({
    idea,
    keys: [
      pillarIsOpen(idea, planned) ? 1 : 0,
      levelRank(idea.evidence_strength),
      levelRank(idea.audience_fit),
      difficultyRank(idea, context.experience),
    ],
  }));
  keyed.sort((a, b) => {
    for (let index = 0; index < a.keys.length; index++) {
      if (a.keys[index] !== b.keys[index]) return b.keys[index] - a.keys[index];
    }
    return b.idea.created_at.localeCompare(a.idea.created_at);
  });
  return keyed.map(({ idea }) => ({ ...idea, reasons: reasonsFor(idea, context, planned) }));
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** Today's item to act on: the first that hasn't passed, else the last one. */
function pickTodayItem(items: CalendarItem[]): CalendarItem {
  return items.find((item) => !item.passed) ?? items[items.length - 1];
}

function failed(stage: string, dbCode?: string): { ok: false } {
  logEvent("error", "daily_recommendation_failed", { stage, db_code: dbCode });
  return { ok: false };
}

/**
 * The creator's one recommended action for today, plus a secondary idea when
 * the primary isn't about an idea. Reads only, through the creator's RLS
 * client, filtered by `userId` (from Clerk's session). Never throws.
 */
export async function getDailyRecommendation(
  client: ReadClient,
  userId: string,
  now: number = Date.now(),
): Promise<DailyRecommendationResult> {
  try {
    const [setupResult, profile, candidates] = await Promise.all([
      getCalendarSetup(client, userId),
      client.from("creator_profiles").select("experience_level").eq("user_id", userId).maybeSingle(),
      client
        .from("content_ideas")
        .select(CANDIDATE_COLUMNS)
        .eq("user_id", userId)
        .in("status", ["saved", "new"])
        .order("created_at", { ascending: false })
        .limit(CANDIDATE_LIMIT),
    ]);
    if (!setupResult.ok) return { ok: false };
    const readError = profile.error ?? candidates.error;
    if (readError) return failed("select", readError.code);

    const { setup } = setupResult;
    if (!setup.onboarded) return result(null, { kind: "finish_setup" });
    if (!setup.hasStrategy) return result(null, { kind: "build_strategy" });
    const tz = setup.timezone;
    const today = tz ? todayIn(tz, now) : null;
    const thisWeek = today ? weekStart(today) : null;
    if (!tz || !today || !thisWeek) return result(null, { kind: "confirm_timezone" });

    const week = await listWeek(client, userId, thisWeek, tz, now, 0);
    if (!week.ok) return { ok: false };

    const experience = experienceLevel.safeParse(profile.data?.experience_level);
    const context: RankContext = {
      experience: experience.success ? experience.data : null,
      plannedPillars: week.items.flatMap((item) => (item.pillar_name ? [item.pillar_name] : [])),
    };

    const ideas: StoredOpportunity[] = [];
    for (const row of candidates.data ?? []) {
      const { pillar, ...rest } = row as typeof row & { pillar: { name: string } | null };
      const parsed = parseWith(storedOpportunity, { ...rest, pillar_name: pillar?.name ?? null, scheduled_for: null });
      if (parsed.ok) ideas.push(parsed.data);
      else logEvent("warn", "daily_recommendation_skipped", { stage: "idea" });
    }
    // A scheduled idea is `planned`, so every `saved` idea is unscheduled.
    const saved = rankIdeas(
      ideas.filter((idea) => idea.status === "saved"),
      context,
    );
    const fresh = rankIdeas(
      ideas.filter((idea) => idea.status === "new"),
      context,
    );
    const secondary = saved[0] ?? fresh[0] ?? null;

    const capacity = setup.postingCapacityPerWeek;
    const scheduled = week.items.length;
    const room = capacity ? Math.max(0, capacity - scheduled) : null;
    const hasRoom = room === null || room > 0;

    const todayItems = week.items.filter((item) => item.date === today);
    if (todayItems.length > 0) {
      return result(
        today,
        { kind: "make_today", item: pickTodayItem(todayItems), moreToday: todayItems.length - 1 },
        secondary,
      );
    }
    if (hasRoom && saved.length > 0) return result(today, { kind: "schedule_saved", idea: saved[0], room });
    if (fresh.length > 0) return result(today, { kind: "review_new", idea: fresh[0], count: fresh.length });
    if (saved.length > 0) {
      const nextWeek = shiftWeek(thisWeek, 1)!;
      return result(today, { kind: "plan_next_week", nextWeek, scheduled, savedCount: saved.length }, secondary);
    }
    return result(today, { kind: "generate_ideas" }, secondary);
  } catch (error) {
    logEvent("error", "daily_recommendation_failed", {
      stage: "unexpected",
      name: error instanceof Error ? error.name : typeof error,
    });
    return { ok: false };
  }
}

function result(
  today: string | null,
  recommendation: Recommendation,
  nextIdea: RankedIdea | null = null,
): DailyRecommendationResult {
  return { ok: true, today, recommendation, nextIdea };
}

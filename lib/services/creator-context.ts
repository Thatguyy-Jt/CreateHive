import type { SupabaseClient } from "@supabase/supabase-js";
import { baselineFor, type ComparisonLabel } from "@/lib/analytics/baseline";
import { formatCount, formatPercent } from "@/lib/analytics/format";
import { logEvent } from "@/lib/observability/log";
import { signalLevel } from "@/lib/schemas/enums";
import type { Database } from "@/lib/supabase/database.types";
import { readPostSummaries, type PostSummary } from "./analytics";

type ContextClient = Pick<SupabaseClient<Database>, "from">;

export const CONTEXT_SECTIONS = [
  "profile",
  "brand",
  "pillars",
  "strategy",
  "recentContent",
  "performance",
  "insights",
] as const;
export type ContextSection = (typeof CONTEXT_SECTIONS)[number];

export const RECENT_CONTENT_LIMIT = 10;
/** Newest posts with results in the performance section. */
export const PERFORMANCE_LIMIT = 15;
/** Active insights in the context, high confidence first. */
export const INSIGHTS_LIMIT = 8;

export interface ProfileContext {
  niche: string | null;
  audience_description: string | null;
  goals: string[];
  platforms: string[];
  posting_capacity_per_week: number | null;
  experience_level: string | null;
}

export interface BrandContext {
  tone: string | null;
  voice_traits: string[];
  do_list: string[];
  dont_list: string[];
  sample_text: string | null;
}

export interface PillarContext {
  name: string;
  description: string | null;
}

export interface StrategyContext {
  positioning: string;
  growth_objective: string;
  monetization_objective: string;
  version: number;
}

export interface ContentContext {
  title: string;
  platform: string | null;
  format: string | null;
  status: string;
  published_at: string | null;
}

/** One published post with results, compared with the creator's usual on its platform. */
export interface PerformanceContext {
  title: string;
  platform: string | null;
  format: string | null;
  /** Date published (UTC), YYYY-MM-DD. */
  posted: string;
  /** Results captured a week or more after posting. */
  settled: boolean;
  /** Days from posting to the latest results. */
  age_days: number | null;
  views: number | null;
  views_label: ComparisonLabel | null;
  engagement_rate: number | null;
  engagement_label: ComparisonLabel | null;
}

export interface InsightContext {
  insight_type: string;
  summary: string;
  confidence: string | null;
  sample_size: number | null;
  next_step: string | null;
}

/**
 * Everything an agent may know about a creator. Sections that were not
 * requested are absent. Deliberately has no name, email or Clerk id: none of
 * them improve a recommendation, and all of them would reach the AI provider.
 */
export interface CreatorContext {
  profile?: ProfileContext | null;
  brand?: BrandContext | null;
  pillars?: PillarContext[];
  strategy?: StrategyContext | null;
  recentContent?: ContentContext[];
  performance?: PerformanceContext[];
  insights?: InsightContext[];
  /** Requested sections with no data, so prompts can say what is missing instead of guessing. */
  missing: ContextSection[];
}

export type BuildContextResult = { ok: true; context: CreatorContext } | { ok: false };

type Loader = (
  client: ContextClient,
  userId: string,
) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;

// Explicit column lists: a new column never reaches a prompt by accident.
const LOADERS: Record<ContextSection, Loader> = {
  profile: (c, id) =>
    c
      .from("creator_profiles")
      .select("niche, audience_description, goals, platforms, posting_capacity_per_week, experience_level")
      .eq("user_id", id)
      .maybeSingle(),
  brand: (c, id) =>
    c
      .from("brand_profiles")
      .select("tone, voice_traits, do_list, dont_list, sample_text")
      .eq("user_id", id)
      .maybeSingle(),
  pillars: (c, id) =>
    c
      .from("content_pillars")
      .select("name, description")
      .eq("user_id", id)
      .eq("is_active", true)
      .order("position", { ascending: true }),
  strategy: (c, id) =>
    c
      .from("creator_strategies")
      .select("positioning, growth_objective, monetization_objective, version")
      .eq("user_id", id)
      .maybeSingle(),
  recentContent: (c, id) =>
    c
      .from("content_items")
      .select("title, platform, format, status, published_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(RECENT_CONTENT_LIMIT),
  // Published posts with their latest check-in, compared with the creator's usual.
  performance: async (c, id) => {
    const read = await readPostSummaries(c, id);
    return read.ok ? { data: performanceFrom(read.posts), error: null } : { data: null, error: {} };
  },
  insights: async (c, id) => {
    const result = await c
      .from("creator_insights")
      .select("insight_type, summary, confidence, sample_size, next_step")
      .eq("user_id", id)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(INSIGHTS_LIMIT);
    if (result.error || !result.data) return result;
    // High confidence first, so capped prompts drop the weakest insights first.
    return { data: result.data.toSorted((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence)), error: null };
  },
};

function confidenceRank(value: string | null): number {
  const parsed = signalLevel.safeParse(value);
  return parsed.success ? { low: 1, medium: 2, high: 3 }[parsed.data] : 0;
}

/** The newest posts with results (`posts` is newest first), each compared with the others. */
export function performanceFrom(posts: readonly PostSummary[]): PerformanceContext[] {
  return posts
    .filter((post) => post.latest !== null)
    .slice(0, PERFORMANCE_LIMIT)
    .map((post) => {
      const comparison = baselineFor(post, posts);
      const views = comparison.metrics.find((m) => m.metric === "views");
      const engagement = comparison.metrics.find((m) => m.metric === "engagement_rate");
      return {
        title: post.title,
        platform: post.platform,
        format: post.format,
        posted: post.published_at.slice(0, 10),
        settled: comparison.settled,
        age_days: comparison.ageDays,
        views: views?.value ?? null,
        views_label: views?.label ?? null,
        engagement_rate: engagement?.value ?? null,
        engagement_label: engagement?.label ?? null,
      };
    });
}

const isEmpty = (value: unknown) => value === null || value === undefined || (Array.isArray(value) && value.length === 0);

/**
 * Assembles creator-specific context for an agent. Read-only; reads only the
 * requested sections. Pass a client acting as the creator (`createUserClient()`)
 * so RLS limits every read to their own rows. Never throws.
 */
export async function buildCreatorContext(
  client: ContextClient,
  userId: string,
  options: { include: readonly ContextSection[] },
): Promise<BuildContextResult> {
  const sections = [...new Set(options.include)];
  try {
    const results = await Promise.all(sections.map((section) => LOADERS[section](client, userId)));
    const context: CreatorContext = { missing: [] };

    for (const [index, section] of sections.entries()) {
      const { data, error } = results[index];
      if (error) {
        logEvent("error", "context_build_failed", { stage: section, db_code: error.code });
        return { ok: false };
      }
      const value = data ?? null;
      (context as unknown as Record<string, unknown>)[section] = value ?? (isListSection(section) ? [] : null);
      if (isEmpty(value)) context.missing.push(section);
    }
    return { ok: true, context };
  } catch (error) {
    logEvent("error", "context_build_failed", {
      stage: "unexpected",
      name: error instanceof Error ? error.name : typeof error,
    });
    return { ok: false };
  }
}

function isListSection(section: ContextSection) {
  return section === "pillars" || section === "recentContent" || section === "performance" || section === "insights";
}

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

const DELIMITER = /<\/?\s*creator_input[^>]*>/gi;

/** Creator-authored text can't close or open the data block it sits in. */
function clean(value: string): string {
  return value.replace(DELIMITER, "").trim();
}

function line(label: string, value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return `${label}: ${typeof value === "string" ? clean(value) : value}`;
}

function list(label: string, values: readonly string[] | undefined): string | null {
  const items = (values ?? []).map(clean).filter(Boolean);
  return items.length ? `${label}:\n${items.map((item) => `- ${item}`).join("\n")}` : null;
}

function block(section: string, lines: (string | null)[]): string | null {
  const body = lines.filter((entry): entry is string => entry !== null);
  if (body.length === 0) return null;
  return `<creator_input section="${section}">\n${body.join("\n")}\n</creator_input>`;
}

/** "1,200 (above usual)", "1,200 (early, day 3)" or "-". */
function reading(post: PerformanceContext, value: string | null, label: ComparisonLabel | null): string {
  if (value === null) return "-";
  if (!post.settled) return `${value} (early, day ${post.age_days ?? 0})`;
  return `${value} (${label ? `${label} usual` : "no usual yet"})`;
}

/**
 * Stable, labelled prompt text shared by every agent. Creator-authored text is
 * wrapped in `<creator_input>` blocks, which prompts declare to be data, never
 * instructions. Empty sections are omitted.
 */
export function renderContextForPrompt(context: CreatorContext): string {
  const parts: (string | null)[] = [];
  const { profile, brand, pillars, strategy, recentContent, performance, insights } = context;

  if (profile) {
    parts.push(
      block("profile", [
        line("Niche", profile.niche),
        line("Audience", profile.audience_description),
        list("Goals", profile.goals),
        list("Platforms", profile.platforms),
        line("Posts per week they can make", profile.posting_capacity_per_week),
        line("Experience level", profile.experience_level),
      ]),
    );
  }
  if (brand) {
    parts.push(
      block("brand_voice", [
        line("Tone", brand.tone),
        list("Voice traits", brand.voice_traits),
        list("Always do", brand.do_list),
        list("Never do", brand.dont_list),
        line("Writing sample", brand.sample_text),
      ]),
    );
  }
  if (pillars?.length) {
    parts.push(
      block(
        "content_pillars",
        pillars.map((p) => `- ${clean(p.name)}${p.description ? `: ${clean(p.description)}` : ""}`),
      ),
    );
  }
  if (strategy) {
    parts.push(
      block("current_strategy", [
        line("Positioning", strategy.positioning),
        line("Growth objective", strategy.growth_objective),
        line("Monetization objective", strategy.monetization_objective),
      ]),
    );
  }
  if (recentContent?.length) {
    parts.push(
      block(
        "recent_content",
        recentContent.map((item) =>
          [clean(item.title), item.platform, item.format, item.status, item.published_at].filter(Boolean).join(" | "),
        ),
      ),
    );
  }
  if (performance?.length) {
    parts.push(
      block("performance", [
        "Results per post, newest first, compared with the creator's usual on that platform",
        "(title | platform | format | posted | views | engagement rate):",
        ...performance.map((post) =>
          [
            clean(post.title),
            post.platform ?? "-",
            post.format ? clean(post.format) : "-",
            post.posted,
            reading(post, post.views === null ? null : formatCount(post.views), post.views_label),
            reading(
              post,
              post.engagement_rate === null ? null : formatPercent(post.engagement_rate),
              post.engagement_label,
            ),
          ].join(" | "),
        ),
      ]),
    );
  }
  if (insights?.length) {
    parts.push(
      block(
        "learned_insights",
        insights.map((i) =>
          `[${i.insight_type}${i.confidence ? `, ${i.confidence} confidence` : ""}${
            i.sample_size !== null ? `, n=${i.sample_size}` : ""
          }] ${clean(i.summary)}${i.next_step ? ` Next: ${clean(i.next_step)}` : ""}`,
        ),
      ),
    );
  }
  if (context.missing.length) parts.push(`No data yet for: ${context.missing.join(", ")}.`);

  return parts.filter((part): part is string => part !== null).join("\n\n");
}

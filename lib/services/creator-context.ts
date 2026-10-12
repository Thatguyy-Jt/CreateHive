import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/lib/observability/log";
import type { Database } from "@/lib/supabase/database.types";

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
export const PERFORMANCE_LIMIT = 30;

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

export interface PerformanceContext {
  platform: string | null;
  captured_at: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  follower_delta: number | null;
}

export interface InsightContext {
  insight_type: string;
  summary: string;
  confidence: string | null;
  sample_size: number | null;
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
  performance: (c, id) =>
    c
      .from("analytics_snapshots")
      .select("platform, captured_at, views, likes, comments, shares, saves, follower_delta")
      .eq("user_id", id)
      .order("captured_at", { ascending: false })
      .limit(PERFORMANCE_LIMIT),
  insights: (c, id) =>
    c
      .from("creator_insights")
      .select("insight_type, summary, confidence, sample_size")
      .eq("user_id", id)
      .eq("status", "active")
      .order("updated_at", { ascending: false }),
};

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
      `Performance snapshots (newest first; platform | captured | views | likes | comments | shares | saves | follower change):\n` +
        performance
          .map((s) =>
            [s.platform ?? "-", s.captured_at, s.views, s.likes, s.comments, s.shares, s.saves, s.follower_delta]
              .map((v) => (v === null ? "-" : String(v)))
              .join(" | "),
          )
          .join("\n"),
    );
  }
  if (insights?.length) {
    parts.push(
      block(
        "learned_insights",
        insights.map((i) =>
          `[${i.insight_type}${i.confidence ? `, ${i.confidence} confidence` : ""}${
            i.sample_size !== null ? `, n=${i.sample_size}` : ""
          }] ${clean(i.summary)}`,
        ),
      ),
    );
  }
  if (context.missing.length) parts.push(`No data yet for: ${context.missing.join(", ")}.`);

  return parts.filter((part): part is string => part !== null).join("\n\n");
}

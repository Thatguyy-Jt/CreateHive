import { formatCount, formatDuration, formatPercent } from "@/lib/analytics/format";

// The reference video's numbers and the ratios the app computes from them.
// Computed here, never by the AI, and stored with the breakdown. No scores.
// Pure and Zod-free: the result page renders them with `factLines`.

const DAY_MS = 24 * 60 * 60 * 1000;

export type FactSource = "youtube_api" | "creator_entered";

export interface FactsInput {
  source: FactSource;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  /** The poster's followers or subscribers. */
  followers: number | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  /** Any number was shorthand ("1.2K"). */
  rounded: boolean;
  now: number;
}

export interface BreakdownFacts {
  source: FactSource;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  followers: number | null;
  duration_seconds: number | null;
  published_at: string | null;
  age_days: number | null;
  views_per_day: number | null;
  /** (likes + comments + shares + saves present) ÷ views. */
  engagement_rate: number | null;
  /** views ÷ followers. */
  views_to_followers: number | null;
  rounded: boolean;
}

export function computeFacts(input: FactsInput): BreakdownFacts {
  const published = input.publishedAt ? Date.parse(input.publishedAt) : Number.NaN;
  const age = Number.isNaN(published) || published > input.now ? null : Math.floor((input.now - published) / DAY_MS);
  const views = input.views;
  const engagementParts = [input.likes, input.comments, input.shares, input.saves].filter((v): v is number => v !== null);

  return {
    source: input.source,
    views,
    likes: input.likes,
    comments: input.comments,
    shares: input.shares,
    saves: input.saves,
    followers: input.followers,
    duration_seconds: input.durationSeconds,
    published_at: age === null ? null : input.publishedAt,
    age_days: age,
    views_per_day: views !== null && age !== null ? Math.round(views / Math.max(1, age)) : null,
    engagement_rate:
      views !== null && views > 0 && engagementParts.length > 0
        ? engagementParts.reduce((sum, v) => sum + v, 0) / views
        : null,
    views_to_followers: views !== null && input.followers !== null && input.followers > 0 ? views / input.followers : null,
    rounded: input.rounded,
  };
}

export interface FactLine {
  label: string;
  value: string;
}

/** "about 3.2× their follower count" / "45% of their follower count". */
export function followerRatioText(ratio: number): string {
  if (ratio >= 1) return `about ${Math.round(ratio * 10) / 10}× their follower count`;
  return `${formatPercent(ratio)} of their follower count`;
}

/** Every known fact as a label and pre-formatted value, in display order. */
export function factLines(facts: BreakdownFacts): FactLine[] {
  const lines: (FactLine | null)[] = [
    facts.views !== null ? { label: "Views", value: formatCount(facts.views) } : null,
    facts.likes !== null ? { label: "Likes", value: formatCount(facts.likes) } : null,
    facts.comments !== null ? { label: "Comments", value: formatCount(facts.comments) } : null,
    facts.shares !== null ? { label: "Shares", value: formatCount(facts.shares) } : null,
    facts.saves !== null ? { label: "Saves", value: formatCount(facts.saves) } : null,
    facts.followers !== null ? { label: "Poster's followers", value: formatCount(facts.followers) } : null,
    facts.duration_seconds !== null ? { label: "Length", value: formatDuration(facts.duration_seconds) } : null,
    facts.age_days !== null ? { label: "Age", value: facts.age_days === 1 ? "1 day" : `${facts.age_days} days` } : null,
    facts.views_per_day !== null ? { label: "Views per day", value: formatCount(facts.views_per_day) } : null,
    facts.engagement_rate !== null ? { label: "Engagement rate", value: formatPercent(facts.engagement_rate) } : null,
    facts.views_to_followers !== null ? { label: "Views vs followers", value: followerRatioText(facts.views_to_followers) } : null,
  ];
  return lines.filter((line): line is FactLine => line !== null);
}

export const FACT_SOURCE_LABELS: Record<FactSource, string> = {
  youtube_api: "From YouTube",
  creator_entered: "You entered",
};

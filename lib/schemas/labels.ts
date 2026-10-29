// Closed vocabularies and their display labels, with no Zod import, so client
// components can show them without shipping Zod to the browser. The Zod enums
// in enums.ts / creator.ts / research.ts are built from these tuples (one
// source of truth) and re-export the labels for server code.
// tests/schemas/client-safe.test.ts keeps this file free of `zod`.

export const PLATFORMS = ["youtube", "tiktok", "instagram", "linkedin", "x", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
  other: "Other",
};

export const CREATOR_GOALS = [
  "grow_audience",
  "build_authority",
  "monetize",
  "get_ugc_clients",
  "stay_consistent",
] as const;
export type CreatorGoal = (typeof CREATOR_GOALS)[number];

export const GOAL_LABELS: Record<CreatorGoal, string> = {
  grow_audience: "Grow my audience",
  build_authority: "Build authority in my niche",
  monetize: "Start earning from content",
  get_ugc_clients: "Land UGC or brand clients",
  stay_consistent: "Post consistently",
};

export const EXPERIENCE_LEVELS = ["beginner", "growing", "established"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  beginner: "Just starting",
  growing: "Posting for a while",
  established: "Have an audience",
};

export const SIGNAL_SOURCES = ["manual", "youtube"] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

export const MANUAL_SIGNAL_TYPES = ["audience_comment", "competitor_note", "creator_note"] as const;
export type ManualSignalType = (typeof MANUAL_SIGNAL_TYPES)[number];

export const SIGNAL_TYPES = [...MANUAL_SIGNAL_TYPES, "video"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SIGNAL_TYPE_LABELS: Record<SignalType, string> = {
  audience_comment: "Audience comment",
  competitor_note: "Competitor observation",
  creator_note: "My own note",
  video: "YouTube video",
};

export const SIGNAL_SOURCE_LABELS: Record<SignalSource, string> = {
  manual: "Pasted by you",
  youtube: "From YouTube",
};

export const RESULT_FIELDS = [
  "views",
  "likes",
  "comments",
  "shares",
  "saves",
  "follower_delta",
  "avg_view_duration_seconds",
  "avg_percent_viewed",
] as const;
export type ResultField = (typeof RESULT_FIELDS)[number];

export const RESULT_FIELD_LABELS: Record<ResultField, string> = {
  views: "Views",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
  follower_delta: "Follower change",
  avg_view_duration_seconds: "Average view duration",
  avg_percent_viewed: "Average % viewed",
};

export const EVIDENCE_KINDS = [
  "research_signal",
  "creator_history",
  "audience_comment",
  "competitor",
  "trend",
  "creator_input",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  creator_input: "From your profile",
  creator_history: "From your past performance",
  research_signal: "From research",
  audience_comment: "From audience comments",
  competitor: "From a competitor you noted",
  trend: "From trend data",
};

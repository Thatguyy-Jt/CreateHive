import type { Platform } from "@/lib/schemas/labels";

// "Where to find these numbers" for each platform we can't fetch. Plain
// beginner language, shown beside the manual fields. Informational only: the
// app never opens, signs in to or reads a platform for the creator.
// Platforms move things around: re-check every guide before beta and on
// reports from creators, then update LAST_CHECKED.

export const LAST_CHECKED = "2026-10-29";

/** The manual number fields, in form order. */
export const COUNT_FIELDS = ["views", "likes", "comments", "shares", "saves", "followers"] as const;
export type CountField = (typeof COUNT_FIELDS)[number];
export type ManualField = CountField | "duration";

export const FIELD_LABELS: Record<ManualField, string> = {
  views: "Views",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
  followers: "Poster's followers",
  duration: "Length",
};

export type ManualPlatform = Exclude<Platform, "youtube">;

/** Platforms that show views publicly: views are required there. */
export const VIEWS_REQUIRED: ReadonlySet<Platform> = new Set<Platform>(["tiktok", "instagram", "x"]);

export interface PlatformGuide {
  intro: string;
  /** One hint per field, shown under its input. */
  fields: Record<ManualField, string>;
  /** Field labels where the platform names things differently ("Reactions" for likes). */
  labels?: Partial<Record<ManualField, string>>;
}

export const NOT_SHOWN = "If you can't see a number, leave it blank. Never estimate: a blank is better than a guess.";
export const ROUNDED = "Type numbers as the platform shows them, like 1.2K or 3.4M.";
export const COMMENTS_HINT = "Copy 5–20 of the top comments, one per line. Leave out people's names.";
export const TRANSCRIPT_HINT =
  "Turn on the video's captions and copy what's said, or type the first 10–15 seconds yourself. The opening matters most.";
export const YOUTUBE_TRANSCRIPT_HINT =
  "Under the video, open the description (…more), then choose Show transcript and copy it. Or type the first 10–15 seconds yourself.";

export const PLATFORM_GUIDES: Record<ManualPlatform, PlatformGuide> = {
  tiktok: {
    intro: "Open the video in the TikTok app or on tiktok.com. Most numbers sit beside the video.",
    fields: {
      views: "Open the poster's profile. The number on this video's thumbnail in their grid is its views.",
      likes: "The number under the heart beside the video.",
      comments: "The number under the speech bubble beside the video.",
      shares: "The number under the arrow beside the video.",
      saves: "The number under the bookmark beside the video.",
      followers: "On the poster's profile, under their name.",
      duration: "Shown on the video's progress bar. Pause to see it. Type it like 0:45.",
    },
  },
  instagram: {
    intro: "Open the reel in the Instagram app or on instagram.com.",
    fields: {
      views: "Open the poster's profile, then the Reels tab. The number on this reel's thumbnail is its plays.",
      likes: "Under the reel, unless the poster has hidden like counts. Then leave it blank.",
      comments: "Under the reel, next to the speech bubble.",
      shares: "Next to the paper-plane icon, if Instagram shows it.",
      saves: "Usually not public. Leave it blank.",
      followers: "On the poster's profile, at the top.",
      duration: "Pause the reel to see its length. Type it like 0:30.",
    },
  },
  x: {
    intro: "Open the post on x.com or in the X app. The numbers are in the row under the post.",
    fields: {
      views: "The number next to the bar-chart icon under the post.",
      likes: "The number next to the heart.",
      comments: "Replies: the number next to the speech bubble.",
      shares: "Reposts: the number next to the two arrows.",
      saves: "Bookmarks: the number next to the bookmark, if it's shown.",
      followers: "On the poster's profile, under their bio.",
      duration: "Shown on the video player. Type it like 1:20.",
    },
    labels: { comments: "Replies", shares: "Reposts", saves: "Bookmarks" },
  },
  linkedin: {
    intro: "Open the post on linkedin.com or in the LinkedIn app. The numbers are under the post.",
    fields: {
      views: "Only some video posts show views to everyone. If you can't see it, leave it blank.",
      likes: "Reactions: the number next to the reaction icons under the post.",
      comments: "The number of comments, under the post.",
      shares: "Reposts: the number of reposts, under the post.",
      saves: "LinkedIn doesn't show saves. Leave it blank.",
      followers: "On the poster's profile or company page.",
      duration: "Shown on the video player. Type it like 1:20.",
    },
    labels: { views: "Views (if shown)", likes: "Reactions", shares: "Reposts" },
  },
  other: {
    intro: "Look under or beside the video for its numbers, and on the poster's profile for their followers.",
    fields: {
      views: "Views or plays, if the site shows them. Otherwise leave it blank.",
      likes: "Likes, hearts or reactions.",
      comments: "The number of comments.",
      shares: "Shares or reposts, if shown.",
      saves: "Saves or bookmarks, if shown.",
      followers: "On the poster's profile.",
      duration: "Shown on the video player. Type it like 1:20.",
    },
    labels: { views: "Views (if shown)" },
  },
};

export function fieldLabel(platform: ManualPlatform, field: ManualField): string {
  return PLATFORM_GUIDES[platform].labels?.[field] ?? FIELD_LABELS[field];
}

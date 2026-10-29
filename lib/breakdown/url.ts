import type { Platform } from "@/lib/schemas/labels";

// Reads a pasted video link into a platform, a canonical URL and the
// platform's video id. Pure and Zod-free: the form uses it to show the right
// fields as the creator types, and the server re-parses on submit. The server
// never fetches the URL a creator typed; it only calls fixed hosts with the
// parsed id or canonical URL as a parameter.

export const MAX_URL_LENGTH = 500;

export type VideoUrlError = "invalid_url" | "unsupported_link" | "short_link";

export const URL_MESSAGES: Record<VideoUrlError, string> = {
  invalid_url: "Paste the full link to the video, starting with https://.",
  unsupported_link:
    "That doesn't look like a link to one video. Paste the video's own link, like https://www.youtube.com/watch?v=… or https://www.tiktok.com/@name/video/…",
  short_link:
    "That's a short share link. Open it in your browser, then copy the full address from the address bar (it looks like https://www.tiktok.com/@name/video/…).",
};

export interface ParsedVideoUrl {
  platform: Platform;
  /** The only form of the link that is stored or linked to. */
  canonicalUrl: string;
  /** The platform's video id; null for `other` and LinkedIn posts without one. */
  externalId: string | null;
}

export type VideoUrlResult = ({ ok: true } & ParsedVideoUrl) | { ok: false; code: VideoUrlError };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TIKTOK_ID = /^\d{5,30}$/;
const TIKTOK_USER = /^@[A-Za-z0-9._-]{1,64}$/;
const INSTAGRAM_CODE = /^[A-Za-z0-9_-]{5,64}$/;
const X_USER = /^[A-Za-z0-9_]{1,30}$/;
const X_ID = /^\d{5,30}$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const BARE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|\?|#|$)/i;

/** Link shorteners whose target we'd have to fetch to know. Never followed. */
const SHORT_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com", "t.co", "lnkd.in"]);

const fail = (code: VideoUrlError): VideoUrlResult => ({ ok: false, code });
const ok = (platform: Platform, canonicalUrl: string, externalId: string | null): VideoUrlResult =>
  canonicalUrl.length > MAX_URL_LENGTH ? fail("invalid_url") : { ok: true, platform, canonicalUrl, externalId };

const segments = (url: URL) => url.pathname.split("/").filter(Boolean);

function youtube(url: URL, host: string): VideoUrlResult {
  const parts = segments(url);
  let id: string | null = null;
  if (host === "youtu.be") id = parts[0] ?? null;
  else if (parts[0] === "watch") id = url.searchParams.get("v");
  else if (["shorts", "live", "embed"].includes(parts[0] ?? "")) id = parts[1] ?? null;
  if (!id || !YOUTUBE_ID.test(id)) return fail("unsupported_link");
  return ok("youtube", `https://www.youtube.com/watch?v=${id}`, id);
}

function tiktok(url: URL): VideoUrlResult {
  const parts = segments(url);
  if (parts[0] === "t") return fail("short_link");
  const [user, kind, id] = parts;
  if (!user || !TIKTOK_USER.test(user) || kind !== "video" || !id || !TIKTOK_ID.test(id)) return fail("unsupported_link");
  return ok("tiktok", `https://www.tiktok.com/${user}/video/${id}`, id);
}

function instagram(url: URL): VideoUrlResult {
  const [kind, code] = segments(url);
  if (!kind || !["reel", "reels", "p", "tv"].includes(kind) || !code || !INSTAGRAM_CODE.test(code)) {
    return fail("unsupported_link");
  }
  const path = kind === "reels" ? "reel" : kind;
  return ok("instagram", `https://www.instagram.com/${path}/${code}/`, code);
}

function x(url: URL): VideoUrlResult {
  const [user, kind, id] = segments(url);
  if (!user || !X_USER.test(user) || kind !== "status" || !id || !X_ID.test(id)) return fail("unsupported_link");
  return ok("x", `https://x.com/${user}/status/${id}`, id);
}

function linkedin(url: URL): VideoUrlResult {
  const parts = segments(url);
  if (parts[0] !== "posts" && !(parts[0] === "feed" && parts[1] === "update")) return fail("unsupported_link");
  const path = `/${parts.map(encodeURIComponent).join("/")}`;
  const activity = /activity[:-](\d{5,30})/.exec(decodeURIComponent(url.pathname));
  return ok("linkedin", `https://www.linkedin.com${path}/`, activity ? activity[1] : null);
}

/**
 * Parses a pasted link. Accepts `https:` URLs or a bare host ("youtu.be/…").
 * Rejects other schemes, credentials, ports and IP literals.
 */
export function parseVideoUrl(raw: string): VideoUrlResult {
  const input = raw.trim();
  if (!input || input.length > MAX_URL_LENGTH) return fail("invalid_url");

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(input);
  if (!hasScheme && !BARE_HOST.test(input)) return fail("invalid_url");
  let url: URL;
  try {
    url = new URL(hasScheme ? input : `https://${input}`);
  } catch {
    return fail("invalid_url");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return fail("invalid_url");
  const hostname = url.hostname.toLowerCase();
  if (!hostname.includes(".") || IPV4.test(hostname) || hostname.startsWith("[")) return fail("invalid_url");
  if (SHORT_HOSTS.has(hostname)) return fail("short_link");

  const host = hostname.replace(/^(www|m|mobile)\./, "");
  if (host === "youtube.com" || host === "youtu.be") return youtube(url, host);
  if (host === "tiktok.com") return tiktok(url);
  if (host === "instagram.com") return instagram(url);
  if (host === "x.com" || host === "twitter.com") return x(url);
  if (host === "linkedin.com") return linkedin(url);

  // Any other site: stored as given, without the fragment.
  return ok("other", `${url.origin}${url.pathname}${url.search}`, null);
}

import { describe, expect, it } from "vitest";
import { parseVideoUrl } from "@/lib/breakdown/url";

describe("parseVideoUrl", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("reads YouTube link %s", (url, id) => {
    expect(parseVideoUrl(url)).toEqual({
      ok: true,
      platform: "youtube",
      canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
      externalId: id,
    });
  });

  it("reads TikTok, Instagram, X and LinkedIn links into canonical forms", () => {
    expect(parseVideoUrl("https://www.tiktok.com/@some.one/video/7234567890123456789?is_from_webapp=1")).toEqual({
      ok: true,
      platform: "tiktok",
      canonicalUrl: "https://www.tiktok.com/@some.one/video/7234567890123456789",
      externalId: "7234567890123456789",
    });
    expect(parseVideoUrl("https://www.instagram.com/reels/C1a2B3c4D5e/?igsh=x")).toMatchObject({
      platform: "instagram",
      canonicalUrl: "https://www.instagram.com/reel/C1a2B3c4D5e/",
      externalId: "C1a2B3c4D5e",
    });
    expect(parseVideoUrl("https://twitter.com/someone/status/1790000000000000000")).toMatchObject({
      platform: "x",
      canonicalUrl: "https://x.com/someone/status/1790000000000000000",
      externalId: "1790000000000000000",
    });
    expect(parseVideoUrl("https://www.linkedin.com/posts/jane-doe_tips-activity-7190000000000000000-abcd")).toMatchObject({
      platform: "linkedin",
      externalId: "7190000000000000000",
    });
  });

  it("keeps other https sites as `other`, without the fragment", () => {
    expect(parseVideoUrl("https://vimeo.com/123456?x=1#t=5")).toEqual({
      ok: true,
      platform: "other",
      canonicalUrl: "https://vimeo.com/123456?x=1",
      externalId: null,
    });
  });

  it.each(["https://vm.tiktok.com/ZM123abc/", "https://vt.tiktok.com/ZS1/", "https://www.tiktok.com/t/ZT8abc/", "https://t.co/abc", "https://lnkd.in/xyz"])(
    "refuses short link %s without following it",
    (url) => {
      expect(parseVideoUrl(url)).toEqual({ ok: false, code: "short_link" });
    },
  );

  it.each([
    "",
    "not a link",
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com:8443/watch?v=dQw4w9WgXcQ",
    "https://127.0.0.1/video",
    "https://[::1]/video",
    "https://localhost/video",
    `https://example.com/${"a".repeat(600)}`,
  ])("rejects %s", (url) => {
    expect(parseVideoUrl(url)).toEqual({ ok: false, code: "invalid_url" });
  });

  it.each([
    "https://www.youtube.com/@channel",
    "https://www.youtube.com/watch?v=short",
    "https://www.tiktok.com/@someone",
    "https://www.instagram.com/someone/",
    "https://x.com/someone",
    "https://www.linkedin.com/in/jane-doe",
  ])("asks for the video's own link for %s", (url) => {
    expect(parseVideoUrl(url)).toEqual({ ok: false, code: "unsupported_link" });
  });
});

import { describe, expect, it } from "vitest";
import { evidenceKind } from "@/lib/schemas/opportunities";
import {
  manualSignalInput,
  SIGNAL_EVIDENCE_KIND,
  signalType,
  storedSignal,
  youtubeSignalPayload,
} from "@/lib/schemas/research";
import { contentHash } from "@/lib/services/research-signals";

const input = (overrides: Record<string, string> = {}) => ({
  type: "audience_comment",
  text: "I only have 10 minutes after bedtime",
  label: "",
  source_url: "",
  ...overrides,
});

describe("manualSignalInput", () => {
  it("accepts a comment and turns blank optional fields into null", () => {
    expect(manualSignalInput.parse(input())).toEqual({
      type: "audience_comment",
      text: "I only have 10 minutes after bedtime",
      label: null,
      source_url: null,
    });
  });

  it("only accepts the three manual types", () => {
    expect(manualSignalInput.safeParse(input({ type: "video" })).success).toBe(false);
    expect(manualSignalInput.safeParse(input({ type: "" })).success).toBe(false);
  });

  it("bounds text and label", () => {
    expect(manualSignalInput.safeParse(input({ text: "   " })).success).toBe(false);
    expect(manualSignalInput.safeParse(input({ text: "x".repeat(1000) })).success).toBe(true);
    expect(manualSignalInput.safeParse(input({ text: "x".repeat(1001) })).success).toBe(false);
    expect(manualSignalInput.safeParse(input({ label: "x".repeat(121) })).success).toBe(false);
  });

  it.each(["javascript:alert(1)", "data:text/html,hi", "http://example.com", "example.com", "ftp://example.com/a"])(
    "rejects the link %s",
    (url) => {
      expect(manualSignalInput.safeParse(input({ source_url: url })).success).toBe(false);
    },
  );

  it("accepts an https link up to 500 characters", () => {
    expect(manualSignalInput.parse(input({ source_url: "https://example.com/post/1" })).source_url).toBe(
      "https://example.com/post/1",
    );
    expect(manualSignalInput.safeParse(input({ source_url: `https://example.com/${"a".repeat(500)}` })).success).toBe(
      false,
    );
  });
});

describe("signal kinds", () => {
  it("maps every signal type to a valid evidence kind, and never to trend", () => {
    for (const type of signalType.options) {
      expect(evidenceKind.options).toContain(SIGNAL_EVIDENCE_KIND[type]);
      expect(SIGNAL_EVIDENCE_KIND[type]).not.toBe("trend");
    }
    expect(SIGNAL_EVIDENCE_KIND).toEqual({
      audience_comment: "audience_comment",
      competitor_note: "competitor",
      creator_note: "creator_input",
      video: "research_signal",
    });
  });
});

describe("stored signals", () => {
  const base = {
    id: "s1",
    title: null,
    source_url: null,
    fetched_at: "2026-10-10T00:00:00+00:00",
    expires_at: null,
    created_at: "2026-10-10T00:00:00+00:00",
  };

  it("validates the payload for its source", () => {
    expect(
      storedSignal.safeParse({ ...base, source: "manual", signal_type: "creator_note", payload: { text: "t", label: null } })
        .success,
    ).toBe(true);
    expect(storedSignal.safeParse({ ...base, source: "manual", signal_type: "video", payload: { text: "t", label: null } }).success).toBe(
      false,
    );
    expect(storedSignal.safeParse({ ...base, source: "youtube", signal_type: "video", payload: { text: "t", label: null } }).success).toBe(
      false,
    );
    expect(storedSignal.safeParse({ ...base, source: "reddit", signal_type: "video", payload: {} }).success).toBe(false);
  });

  it("rejects a stored non-https link", () => {
    expect(
      storedSignal.safeParse({
        ...base,
        source_url: "javascript:alert(1)",
        source: "manual",
        signal_type: "creator_note",
        payload: { text: "t", label: null },
      }).success,
    ).toBe(false);
  });

  it("validates YouTube payloads", () => {
    const payload = {
      video_id: "abc",
      channel_title: "Example",
      published_at: "2026-09-30T00:00:00Z",
      view_count: 10,
      like_count: null,
      comment_count: 2,
      query: "q",
    };
    expect(youtubeSignalPayload.safeParse(payload).success).toBe(true);
    expect(youtubeSignalPayload.safeParse({ ...payload, view_count: -1 }).success).toBe(false);
  });
});

describe("contentHash", () => {
  it("is stable and case/whitespace-insensitive", () => {
    expect(contentHash("audience_comment", "  Hello   World ")).toBe(contentHash("audience_comment", "hello world"));
    expect(contentHash("audience_comment", "hello world")).toHaveLength(32);
  });

  it("differs by type and text", () => {
    expect(contentHash("audience_comment", "hello")).not.toBe(contentHash("creator_note", "hello"));
    expect(contentHash("audience_comment", "hello")).not.toBe(contentHash("audience_comment", "hello!"));
  });
});

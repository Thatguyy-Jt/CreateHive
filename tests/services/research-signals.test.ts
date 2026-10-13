import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredSignal } from "@/lib/schemas/research";
import {
  addManualSignal,
  contentHash,
  deleteSignal,
  listSignals,
  loadSignalsForPrompt,
  MANUAL_SIGNAL_LIMIT,
  PROMPT_EXCERPT_MAX,
  selectPromptSignals,
  SIGNAL_ERRORS,
} from "@/lib/services/research-signals";
import { fakeSupabase, pgError, type FakeResult } from "./fake-supabase";

const USER_ID = "user_research";
const NOW = Date.parse("2026-10-12T12:00:00Z");
const SIGNAL_ID = "6f1c1f9e-4d0a-4b8e-9a37-0d1f7e2b9c11";

const input = {
  type: "audience_comment" as const,
  text: "I only have 10 minutes after bedtime",
  label: "Comment on my squat video",
  source_url: "https://example.com/c/1",
};

let errorLog: ReturnType<typeof vi.spyOn>;
let warnLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  errorLog.mockRestore();
  warnLog.mockRestore();
});

describe("addManualSignal", () => {
  function setup(count: number, insert: FakeResult = {}) {
    return fakeSupabase({ research_signals: (q) => (q.op === "insert" ? insert : { count }) });
  }

  it("stores a pasted signal with a content-hash external id and no expiry", async () => {
    const { client, queries } = setup(3);
    await expect(addManualSignal(client, USER_ID, input)).resolves.toEqual({ ok: true });

    const count = queries.find((q) => q.op === "select")!;
    expect(count.filters).toEqual([
      ["eq", "user_id", USER_ID],
      ["eq", "source", "manual"],
    ]);
    expect(queries.find((q) => q.op === "insert")!.payload).toEqual({
      user_id: USER_ID,
      source: "manual",
      external_id: contentHash("audience_comment", input.text),
      signal_type: "audience_comment",
      title: "Comment on my squat video",
      source_url: "https://example.com/c/1",
      payload: { text: input.text, label: "Comment on my squat video" },
      expires_at: null,
    });
  });

  it(`refuses at ${MANUAL_SIGNAL_LIMIT} pasted signals without inserting`, async () => {
    const { client, queries } = setup(MANUAL_SIGNAL_LIMIT);
    await expect(addManualSignal(client, USER_ID, input)).resolves.toEqual({
      ok: false,
      code: "limit_reached",
      message: SIGNAL_ERRORS.limit_reached,
    });
    expect(queries.some((q) => q.op === "insert")).toBe(false);
  });

  it("reports a duplicate (unique violation) as duplicate", async () => {
    const { client } = setup(0, { error: pgError("23505") });
    await expect(addManualSignal(client, USER_ID, input)).resolves.toMatchObject({ ok: false, code: "duplicate" });
  });

  it("reports other failures as db_error and logs no creator text", async () => {
    const { client } = setup(0, { error: pgError("XX000", input.text) });
    await expect(addManualSignal(client, USER_ID, input)).resolves.toMatchObject({ ok: false, code: "db_error" });
    const logged = errorLog.mock.calls.flat().join(" ");
    expect(logged).toContain("signal_save_failed");
    expect(logged).not.toContain(input.text);
    expect(logged).not.toContain(USER_ID);
  });
});

describe("deleteSignal", () => {
  it("deletes only the creator's row", async () => {
    const { client, queries } = fakeSupabase({ research_signals: { data: [{ id: SIGNAL_ID }] } });
    await expect(deleteSignal(client, USER_ID, SIGNAL_ID)).resolves.toEqual({ ok: true });
    const query = queries[0];
    expect(query.op).toBe("delete");
    expect(query.filters).toEqual([
      ["eq", "id", SIGNAL_ID],
      ["eq", "user_id", USER_ID],
    ]);
  });

  it("returns not_found when nothing was deleted (missing, or another creator's)", async () => {
    const { client } = fakeSupabase({ research_signals: { data: [] } });
    await expect(deleteSignal(client, USER_ID, SIGNAL_ID)).resolves.toMatchObject({ ok: false, code: "not_found" });
  });

  it("returns db_error on failure", async () => {
    const { client } = fakeSupabase({ research_signals: { error: pgError() } });
    await expect(deleteSignal(client, USER_ID, SIGNAL_ID)).resolves.toMatchObject({ ok: false, code: "db_error" });
  });
});

// ---------------------------------------------------------------------------

const manual = (id: string, text = "Pasted text", extra: Record<string, unknown> = {}) => ({
  id,
  source: "manual",
  signal_type: "audience_comment",
  title: null,
  source_url: null,
  payload: { text, label: null },
  fetched_at: "2026-10-10T00:00:00+00:00",
  expires_at: null,
  created_at: "2026-10-10T00:00:00+00:00",
  ...extra,
});
const video = (id: string, views: number | null = 1200) => ({
  id,
  source: "youtube",
  signal_type: "video",
  title: `Video ${id}`,
  source_url: `https://www.youtube.com/watch?v=${id}`,
  payload: {
    video_id: id,
    channel_title: "Example Fit",
    published_at: "2026-09-30T00:00:00Z",
    view_count: views,
    like_count: null,
    comment_count: null,
    query: "q",
  },
  fetched_at: "2026-10-11T00:00:00+00:00",
  expires_at: "2026-10-18T00:00:00+00:00",
  created_at: "2026-10-11T00:00:00+00:00",
});

describe("listSignals", () => {
  it("reads unexpired rows, newest first, and skips rows that no longer validate", async () => {
    const { client, queries } = fakeSupabase({
      research_signals: { data: [manual("a"), { ...manual("b"), payload: { nope: 1 } }, video("v1")] },
    });
    const result = await listSignals(client, USER_ID, NOW);
    expect(result.ok && result.signals.map((s) => s.id)).toEqual(["a", "v1"]);
    expect(warnLog.mock.calls.flat().join(" ")).toContain("signal_read_skipped");
    expect(queries[0].filters).toEqual([
      ["eq", "user_id", USER_ID],
      ["or", "expires_at.is.null,expires_at.gt.2026-10-12T12:00:00.000Z"],
      ["order", "fetched_at", { ascending: false }],
      ["limit", 120],
    ]);
  });

  it("returns ok: false on a read error", async () => {
    const { client } = fakeSupabase({ research_signals: { error: pgError() } });
    await expect(listSignals(client, USER_ID, NOW)).resolves.toEqual({ ok: false });
  });
});

describe("selectPromptSignals", () => {
  const parsed = (rows: unknown[]) => rows as StoredSignal[];

  it("caps at 12 overall and 6 per source, assigning sequential refs", () => {
    const rows = parsed([
      ...Array.from({ length: 9 }, (_, i) => video(`v${i}`)),
      ...Array.from({ length: 9 }, (_, i) => manual(`m${i}`)),
    ]);
    const selected = selectPromptSignals(rows);
    expect(selected).toHaveLength(12);
    expect(selected.filter((s) => s.source === "youtube")).toHaveLength(6);
    expect(selected.filter((s) => s.source === "manual")).toHaveLength(6);
    expect(selected.map((s) => s.ref)).toEqual(Array.from({ length: 12 }, (_, i) => `S${i + 1}`));
  });

  it("builds short excerpts with no URLs or ids", () => {
    const [comment, clip] = selectPromptSignals(parsed([manual("m1", "word ".repeat(200)), video("v1", 48210)]));
    expect(comment.excerpt.length).toBeLessThanOrEqual(PROMPT_EXCERPT_MAX);
    expect(comment.excerpt.endsWith("…")).toBe(true);
    expect(clip.excerpt).toBe("Video v1 | channel: Example Fit | published Sep 30, 2026 | 48,210 views");
    for (const signal of [comment, clip]) {
      expect(signal.excerpt).not.toContain("https://");
      expect(signal.excerpt).not.toContain(signal.id === "m1" ? "m1" : "watch?v");
    }
  });

  it("keeps server-side citation details off the excerpt", () => {
    const [clip] = selectPromptSignals(parsed([video("v1")]));
    expect(clip).toMatchObject({
      kind: "research_signal",
      label: "YouTube: Video v1",
      source_url: "https://www.youtube.com/watch?v=v1",
      observed_at: "2026-10-11T00:00:00+00:00",
    });
    const [note] = selectPromptSignals(
      parsed([manual("n1", "My bedtime videos get replies", { signal_type: "creator_note", payload: { text: "My bedtime videos get replies", label: "Replies" } })]),
    );
    expect(note).toMatchObject({ kind: "creator_input", excerpt: "Replies: My bedtime videos get replies", label: "My own note: Replies" });
  });
});

describe("loadSignalsForPrompt", () => {
  it("returns ok: false when signals can't be read", async () => {
    const { client } = fakeSupabase({ research_signals: { error: pgError() } });
    await expect(loadSignalsForPrompt(client, USER_ID, NOW)).resolves.toEqual({ ok: false });
  });
});

import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createTestDb, insertRow, seedCreator } from "./helpers";

const A = "user_alice";
const B = "user_bob";

let db: PGlite;
let bobBreakdown: string;

beforeAll(async () => {
  db = await createTestDb();
  await seedCreator(db, A);
  bobBreakdown = (await seedCreator(db, B)).rowIds.video_breakdowns;
});

afterAll(async () => {
  await db.close();
});

const row = (userId: string, extra: Record<string, unknown> = {}) => ({
  user_id: userId,
  platform: "youtube",
  source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  external_id: "dQw4w9WgXcQ",
  facts: JSON.stringify({ source: "youtube_api" }),
  prompt_version: "v1",
  breakdown: JSON.stringify({ schema_version: 1 }),
  ...extra,
});

async function expectRaise(tx: Transaction, fn: () => Promise<unknown>, message: RegExp) {
  await tx.query("savepoint attempt");
  await expect(fn()).rejects.toThrow(message);
  await tx.query("rollback to savepoint attempt");
}

describe("video_breakdowns", () => {
  it("lets a creator add, read and delete their own breakdowns, but never edit one", async () => {
    await asUser(db, A, async (tx) => {
      const created = await insertRow(tx, "video_breakdowns", row(A));
      const { rows } = await tx.query<{ id: string }>("select id from public.video_breakdowns where id = $1", [created.id]);
      expect(rows).toHaveLength(1);
      await expectRaise(tx, () => tx.query("update public.video_breakdowns set prompt_version = 'v2'"), /permission denied/);
      const deleted = await tx.query("delete from public.video_breakdowns where id = $1", [created.id]);
      expect(deleted.affectedRows).toBe(1);
    });
  });

  it("hides, protects and refuses other creators' rows", async () => {
    await asUser(db, A, async (tx) => {
      const { rows } = await tx.query("select id from public.video_breakdowns where id = $1", [bobBreakdown]);
      expect(rows).toEqual([]);
      const deleted = await tx.query("delete from public.video_breakdowns where id = $1", [bobBreakdown]);
      expect(deleted.affectedRows).toBe(0);
      await expectRaise(tx, () => insertRow(tx, "video_breakdowns", row(B)), /row-level security/);
    });
  });

  it("requires a platform, a capped URL, facts, a prompt version and content", async () => {
    await asUser(db, A, async (tx) => {
      await expectRaise(tx, () => insertRow(tx, "video_breakdowns", row(A, { platform: "" })), /check constraint/);
      await expectRaise(tx, () => insertRow(tx, "video_breakdowns", row(A, { source_url: `https://x.com/${"a".repeat(500)}` })), /check constraint/);
      await expectRaise(tx, () => insertRow(tx, "video_breakdowns", row(A, { prompt_version: "" })), /check constraint/);
      await expectRaise(tx, () => insertRow(tx, "video_breakdowns", row(A, { breakdown: null })), /null value/);
    });
  });

  it("lets the daily sweep drop expired YouTube data and keep the breakdown", async () => {
    await asService(db, async (tx) => {
      const expired = await insertRow(
        tx,
        "video_breakdowns",
        row(A, { source_data: JSON.stringify({ title: "t" }), source_expires_at: new Date(Date.now() - 60_000).toISOString() }),
      );
      const fresh = await insertRow(
        tx,
        "video_breakdowns",
        row(A, { source_data: JSON.stringify({ title: "t" }), source_expires_at: new Date(Date.now() + 60_000).toISOString() }),
      );
      await tx.query("update public.video_breakdowns set source_data = null where source_data is not null and source_expires_at < now()");
      const { rows } = await tx.query<{ id: string; has_source: boolean; breakdown: unknown }>(
        "select id, source_data is not null as has_source, breakdown from public.video_breakdowns where id = any($1)",
        [[expired.id, fresh.id]],
      );
      expect(Object.fromEntries(rows.map((r) => [r.id, r.has_source]))).toEqual({ [String(expired.id)]: false, [String(fresh.id)]: true });
      expect(rows.every((r) => r.breakdown !== null)).toBe(true);
    });
  });
});

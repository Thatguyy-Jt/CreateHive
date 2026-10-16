import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asSubjectless, asUser, createTestDb, insertRow, seedCreator } from "./helpers";

const A = "user_alice";
const B = "user_bob";
const GEN_1 = "11111111-1111-4111-8111-111111111111";
const GEN_2 = "22222222-2222-4222-8222-222222222222";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await insertRow(db, "users", { id: A });
  // Bob has one active insight from the seed.
  await seedCreator(db, B);
});

afterAll(async () => {
  await db.close();
});

const insight = (summary: string, overrides: Record<string, unknown> = {}) => ({
  insight_type: "hook",
  summary,
  next_step: "Open with a question.",
  evidence: [{ observation: "“Post” (YouTube): Views 2,300, above your usual", metric: "views", value: 2300 }],
  confidence: "low",
  sample_size: 2,
  ...overrides,
});

const replace = (tx: Pick<Transaction, "query">, generation: string, insights: unknown) =>
  tx.query<{ replace_creator_insights: number }>("select public.replace_creator_insights($1, $2::jsonb)", [
    generation,
    JSON.stringify(insights),
  ]);

async function expectRaise(tx: Transaction, fn: () => Promise<unknown>, message: RegExp) {
  await tx.query("savepoint attempt");
  await expect(fn()).rejects.toThrow(message);
  await tx.query("rollback to savepoint attempt");
}

const statuses = async (tx: Pick<Transaction, "query">) =>
  (
    await tx.query<{ summary: string; status: string; ai_generation_id: string | null }>(
      "select summary, status, ai_generation_id from public.creator_insights order by created_at, summary",
    )
  ).rows;

describe("replace_creator_insights", () => {
  it("supersedes the creator's active insights and inserts the new set, keeping dismissed ones", async () => {
    await asUser(db, A, async (tx) => {
      const first = await replace(tx, GEN_1, [insight("Questions work"), insight("Tutorials do better", { insight_type: "format" })]);
      expect(first.rows[0].replace_creator_insights).toBe(2);
      await tx.query("update public.creator_insights set status = 'dismissed' where summary = 'Tutorials do better'");

      const second = await replace(tx, GEN_2, [insight("Shorter posts keep viewers", { confidence: "medium", sample_size: 3 })]);
      expect(second.rows[0].replace_creator_insights).toBe(1);

      expect(await statuses(tx)).toEqual(
        expect.arrayContaining([
          { summary: "Questions work", status: "superseded", ai_generation_id: GEN_1 },
          { summary: "Tutorials do better", status: "dismissed", ai_generation_id: GEN_1 },
          { summary: "Shorter posts keep viewers", status: "active", ai_generation_id: GEN_2 },
        ]),
      );
      const { rows } = await tx.query<{ next_step: string; sample_size: number; confidence: string }>(
        "select next_step, sample_size, confidence from public.creator_insights where status = 'active'",
      );
      expect(rows).toEqual([{ next_step: "Open with a question.", sample_size: 3, confidence: "medium" }]);
    });
  });

  it("accepts an empty set, superseding everything active", async () => {
    await asUser(db, A, async (tx) => {
      await replace(tx, GEN_1, [insight("Questions work")]);
      await replace(tx, GEN_2, []);
      const { rows } = await tx.query("select id from public.creator_insights where status = 'active'");
      expect(rows).toEqual([]);
    });
  });

  it("changes nothing when an element is invalid", async () => {
    await asUser(db, A, async (tx) => {
      await replace(tx, GEN_1, [insight("Questions work")]);
      await expectRaise(tx, () => replace(tx, GEN_2, [insight("Fine"), insight("Bad", { insight_type: "vibes" })]), /check constraint/);
      await expectRaise(tx, () => replace(tx, GEN_2, [insight("No evidence", { evidence: "nope" })]), /invalid_insights/);
      await expectRaise(tx, () => replace(tx, GEN_2, Array.from({ length: 7 }, (_, i) => insight(`I${i}`))), /invalid_insights/);
      await expectRaise(tx, () => replace(tx, GEN_2, { not: "an array" }), /invalid_insights/);
      expect(await statuses(tx)).toEqual([{ summary: "Questions work", status: "active", ai_generation_id: GEN_1 }]);
    });
  });

  it("only touches the caller's rows, whatever the input says", async () => {
    await asUser(db, A, async (tx) => {
      await replace(tx, GEN_1, [insight("Questions work", { user_id: B, status: "dismissed" })]);
      expect(await statuses(tx)).toEqual([{ summary: "Questions work", status: "active", ai_generation_id: GEN_1 }]);
    });
    await asService(db, async (tx) => {
      const { rows } = await tx.query<{ user_id: string; status: string }>(
        "select user_id, status from public.creator_insights where user_id = $1",
        [B],
      );
      expect(rows).toEqual([{ user_id: B, status: "active" }]);
    });
  });

  it("needs a signed-in creator", async () => {
    await asAnon(db, async (tx) => {
      await expect(replace(tx, GEN_1, [])).rejects.toThrow(/permission denied/);
    });
    await asSubjectless(db, async (tx) => {
      await expect(replace(tx, GEN_1, [])).rejects.toThrow(/requires an authenticated creator/);
    });
  });
});

describe("creator_insights columns", () => {
  it("bounds next_step", async () => {
    await asUser(db, A, async (tx) => {
      await expectRaise(
        tx,
        () => insertRow(tx, "creator_insights", { user_id: A, insight_type: "hook", summary: "x", next_step: "" }),
        /check constraint/,
      );
      await expectRaise(
        tx,
        () => insertRow(tx, "creator_insights", { user_id: A, insight_type: "hook", summary: "x", next_step: "y".repeat(301) }),
        /check constraint/,
      );
    });
  });
});

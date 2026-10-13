import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, insertRow, seedCreator, type Fixture } from "./helpers";

const A = "user_alice";
const B = "user_bob";
const GENERATION_ID = "0b6f5d1e-2c3a-4f5b-8d9e-1a2b3c4d5e6f";

let db: PGlite;
let alice: Fixture;

beforeAll(async () => {
  db = await createTestDb();
  alice = await seedCreator(db, A);
  await seedCreator(db, B);
});

afterAll(async () => {
  await db.close();
});

const opportunity = (userId: string, pillarId: string) => ({
  user_id: userId,
  pillar_id: pillarId,
  topic: "Nap-time workout",
  platform: "youtube",
  rationale: "Fits your quick-workouts pillar.",
  ai_generation_id: GENERATION_ID,
  evidence: JSON.stringify([{ kind: "creator_input", summary: "You said you have 20 minutes." }]),
  evidence_strength: "low",
});

describe("content_ideas opportunity fields", () => {
  it("adds platform, rationale and ai_generation_id as nullable columns", async () => {
    const { rows } = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `select column_name, data_type, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'content_ideas'
         and column_name in ('platform', 'rationale', 'ai_generation_id')
       order by column_name`,
    );
    expect(rows).toEqual([
      { column_name: "ai_generation_id", data_type: "uuid", is_nullable: "YES" },
      { column_name: "platform", data_type: "text", is_nullable: "YES" },
      { column_name: "rationale", data_type: "text", is_nullable: "YES" },
    ]);
  });

  it("indexes the list query by owner and newest first", async () => {
    const { rows } = await db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'public' and indexname = 'content_ideas_user_id_created_at_idx'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/\(user_id, created_at DESC\)/);
  });

  it("lets the owner insert and read the new fields", async () => {
    await asUser(db, A, async (tx) => {
      const inserted = await insertRow(tx, "content_ideas", opportunity(A, alice.pillarId));
      const { rows } = await tx.query<{ platform: string; rationale: string; ai_generation_id: string }>(
        "select platform, rationale, ai_generation_id from public.content_ideas where id = $1",
        [inserted.id],
      );
      expect(rows).toEqual([
        { platform: "youtube", rationale: "Fits your quick-workouts pillar.", ai_generation_id: GENERATION_ID },
      ]);
    });
  });

  it("hides another creator's ideas and blocks writing them", async () => {
    const id = String((await insertRow(db, "content_ideas", opportunity(A, alice.pillarId))).id);
    await asUser(db, B, async (tx) => {
      const { rows } = await tx.query("select platform, rationale from public.content_ideas where id = $1", [id]);
      expect(rows).toEqual([]);
      const updated = await tx.query("update public.content_ideas set status = 'saved' where id = $1", [id]);
      expect(updated.affectedRows).toBe(0);
    });
    const { rows } = await db.query<{ status: string }>("select status from public.content_ideas where id = $1", [id]);
    expect(rows[0].status).toBe("new");
  });
});

import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asSubjectless, asUser, createTestDb, insertRow, STRATEGY_JSON } from "./helpers";

const A = "user_alice";
const B = "user_bob";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  // Users only: no strategy or pillars yet.
  await insertRow(db, "users", { id: A });
  await insertRow(db, "users", { id: B });
});

afterAll(async () => {
  await db.close();
});

const strategy = (positioning = "Helps busy parents train at home") =>
  JSON.stringify({
    positioning,
    growth_objective: "Reach 1,000 engaged followers",
    monetization_objective: "Build an email list",
    notes: null,
    prompt_version: "v1",
    ai_generation_id: null,
    audience_profile: JSON.parse(STRATEGY_JSON.audience_profile),
    format_strategy: JSON.parse(STRATEGY_JSON.format_strategy),
    voice_profile: JSON.parse(STRATEGY_JSON.voice_profile),
    thirty_day_plan: JSON.parse(STRATEGY_JSON.thirty_day_plan),
  });

const pillars = (...names: string[]) => JSON.stringify(names.map((name) => ({ name, description: `${name} desc` })));

async function save(tx: Transaction, s: string, p: string): Promise<number> {
  const { rows } = await tx.query<{ v: number }>("select public.save_creator_strategy($1::jsonb, $2::jsonb) as v", [s, p]);
  return rows[0].v;
}

describe("save_creator_strategy", () => {
  it("creates the strategy at version 1 with ordered, active pillars", async () => {
    await asUser(db, A, async (tx) => {
      expect(await save(tx, strategy(), pillars("Form", "Food", "Mindset"))).toBe(1);

      const { rows: s } = await tx.query<{ user_id: string; prompt_version: string; notes: string | null }>(
        "select user_id, prompt_version, notes from public.creator_strategies",
      );
      expect(s).toEqual([{ user_id: A, prompt_version: "v1", notes: null }]);

      const { rows: p } = await tx.query<{ name: string; position: number; is_active: boolean }>(
        "select name, position, is_active from public.content_pillars order by position",
      );
      expect(p).toEqual([
        { name: "Form", position: 0, is_active: true },
        { name: "Food", position: 1, is_active: true },
        { name: "Mindset", position: 2, is_active: true },
      ]);
    });
  });

  it("regenerating increments the version and retires the old pillars", async () => {
    await asUser(db, A, async (tx) => {
      await save(tx, strategy(), pillars("Form", "Food", "Mindset"));
      expect(await save(tx, strategy("New positioning"), pillars("One", "Two", "Three", "Four"))).toBe(2);

      const { rows: s } = await tx.query<{ positioning: string; version: number }>(
        "select positioning, version from public.creator_strategies",
      );
      expect(s).toEqual([{ positioning: "New positioning", version: 2 }]);

      const { rows: active } = await tx.query<{ name: string }>(
        "select name from public.content_pillars where is_active order by position",
      );
      expect(active.map((r) => r.name)).toEqual(["One", "Two", "Three", "Four"]);
      const { rows: retired } = await tx.query<{ n: number }>(
        "select count(*)::int as n from public.content_pillars where not is_active",
      );
      expect(retired[0].n).toBe(3);
    });
  });

  it("keeps ideas pointing at a retired pillar", async () => {
    await asUser(db, A, async (tx) => {
      await save(tx, strategy(), pillars("Form", "Food", "Mindset"));
      const { rows } = await tx.query<{ id: string }>("select id from public.content_pillars where name = 'Form'");
      await insertRow(tx, "content_ideas", { user_id: A, topic: "Squats", pillar_id: rows[0].id });
      await save(tx, strategy(), pillars("One", "Two", "Three"));

      const { rows: idea } = await tx.query<{ pillar_id: string }>("select pillar_id from public.content_ideas");
      expect(idea[0].pillar_id).toBe(rows[0].id);
    });
  });

  it.each([
    ["too few pillars", strategy(), pillars("A", "B")],
    ["too many pillars", strategy(), pillars("A", "B", "C", "D", "E", "F")],
    ["pillars not an array", strategy(), JSON.stringify({ name: "A" })],
    ["empty positioning", strategy(""), pillars("A", "B", "C")],
    ["missing JSON column", JSON.stringify({ positioning: "p", growth_objective: "g", monetization_objective: "m" }), pillars("A", "B", "C")],
  ])("rejects %s and changes nothing", async (_label, s, p) => {
    await asUser(db, A, async (tx) => {
      await save(tx, strategy("Original"), pillars("Keep1", "Keep2", "Keep3"));
      await tx.query("savepoint attempt");
      await expect(save(tx, s, p)).rejects.toThrow();
      await tx.query("rollback to savepoint attempt");

      const { rows } = await tx.query<{ positioning: string; version: number }>(
        "select positioning, version from public.creator_strategies",
      );
      expect(rows).toEqual([{ positioning: "Original", version: 1 }]);
      const { rows: active } = await tx.query<{ name: string }>(
        "select name from public.content_pillars where is_active order by position",
      );
      expect(active.map((r) => r.name)).toEqual(["Keep1", "Keep2", "Keep3"]);
    });
  });

  it("only ever writes the caller's own rows", async () => {
    // Persist a strategy for Bob (session helpers always roll back), so Alice
    // has another creator's rows to collide with.
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: B })]);
    await db.query("select public.save_creator_strategy($1::jsonb, $2::jsonb)", [strategy("Bob's"), pillars("B1", "B2", "B3")]);
    await db.query("select set_config('request.jwt.claims', '', false)");

    await asUser(db, A, async (tx) => {
      await save(tx, strategy("Alice's"), pillars("A1", "A2", "A3"));
      const { rows } = await tx.query<{ user_id: string }>("select user_id from public.creator_strategies");
      expect(rows.map((r) => r.user_id)).toEqual([A]);
    });

    const { rows } = await asService(db, (tx) =>
      tx.query<{ positioning: string; version: number }>(
        "select positioning, version from public.creator_strategies where user_id = $1",
        [B],
      ),
    );
    expect(rows).toEqual([{ positioning: "Bob's", version: 1 }]);
    const { rows: bobPillars } = await asService(db, (tx) =>
      tx.query<{ n: number }>(
        "select count(*)::int as n from public.content_pillars where user_id = $1 and is_active",
        [B],
      ),
    );
    expect(bobPillars[0].n).toBe(3);
  });

  it("raises without an authenticated subject", async () => {
    await expect(asSubjectless(db, (tx) => save(tx, strategy(), pillars("A", "B", "C")))).rejects.toThrow(
      /authenticated creator/,
    );
  });

  it("cannot be executed by anon", async () => {
    await expect(asAnon(db, (tx) => save(tx, strategy(), pillars("A", "B", "C")))).rejects.toThrow(/permission denied/);
  });

  it("is SECURITY INVOKER with a pinned search_path", async () => {
    const { rows } = await db.query<{ prosecdef: boolean; proconfig: string[] }>(
      "select prosecdef, proconfig from pg_proc where proname = 'save_creator_strategy'",
    );
    expect(rows).toEqual([{ prosecdef: false, proconfig: ['search_path=""'] }]);
  });
});

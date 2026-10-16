import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asSubjectless, asUser, createTestDb, insertRow, seedCreator } from "./helpers";

const A = "user_alice";
const B = "user_bob";

let db: PGlite;
let bobIdea: string;
let bobDraft: string;

beforeAll(async () => {
  db = await createTestDb();
  await insertRow(db, "users", { id: A });
  const bob = await seedCreator(db, B);
  bobIdea = String((await insertRow(db, "content_ideas", { user_id: B, topic: "Bob's idea", status: "saved" })).id);
  // The seeded item is a draft with a version.
  bobDraft = bob.itemId;
});

afterAll(async () => {
  await db.close();
});

const inHours = (hours: number) => new Date(Date.now() + hours * 3600 * 1000).toISOString();

async function idea(tx: Transaction, status = "saved", extra: Record<string, unknown> = {}): Promise<string> {
  return String((await insertRow(tx, "content_ideas", { user_id: A, topic: `Topic ${Math.random()}`, status, ...extra })).id);
}

async function start(tx: Transaction, ideaId: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>("select public.start_studio_item($1::uuid) as id", [ideaId]);
  return rows[0].id;
}

const scheduleItem = (tx: Transaction, itemId: string, at: string) =>
  tx.query("select public.schedule_content_item($1::uuid, $2::timestamptz)", [itemId, at]);

const ideaStatus = async (tx: Transaction, id: string) =>
  (await tx.query<{ status: string }>("select status from public.content_ideas where id = $1", [id])).rows[0]?.status;

/** Runs `fn` expecting it to raise, then rolls back to before it so the transaction stays usable. */
async function expectRaise(tx: Transaction, fn: () => Promise<unknown>, message: RegExp) {
  await tx.query("savepoint attempt");
  await expect(fn()).rejects.toThrow(message);
  await tx.query("rollback to savepoint attempt");
}

describe("content_versions.ai_generation_id", () => {
  it("is a nullable column the creator can insert, still append-only", async () => {
    await asUser(db, A, async (tx) => {
      const ideaId = await idea(tx);
      const itemId = await start(tx, ideaId);
      const generation = "11111111-1111-4111-8111-111111111111";
      await insertRow(tx, "content_versions", {
        user_id: A,
        content_item_id: itemId,
        version_no: 1,
        source: "ai",
        ai_generation_id: generation,
      });
      const { rows } = await tx.query<{ ai_generation_id: string }>("select ai_generation_id from public.content_versions");
      expect(rows).toEqual([{ ai_generation_id: generation }]);
      await expectRaise(tx, () => tx.query("update public.content_versions set note = 'x'"), /permission denied/);
    });
  });
});

describe("start_studio_item", () => {
  it("creates a draft from a saved idea and moves the idea to in_production", async () => {
    await asUser(db, A, async (tx) => {
      const pillar = String((await insertRow(tx, "content_pillars", { user_id: A, name: "Quick workouts" })).id);
      const ideaId = await idea(tx, "saved", { topic: "10-minute squats", platform: "youtube", format: "short", pillar_id: pillar });
      const itemId = await start(tx, ideaId);
      const { rows } = await tx.query<Record<string, unknown>>(
        "select id, user_id, idea_id, pillar_id, title, platform, format, status, scheduled_for from public.content_items",
      );
      expect(rows).toEqual([
        {
          id: itemId,
          user_id: A,
          idea_id: ideaId,
          pillar_id: pillar,
          title: "10-minute squats",
          platform: "youtube",
          format: "short",
          status: "draft",
          scheduled_for: null,
        },
      ]);
      expect(await ideaStatus(tx, ideaId)).toBe("in_production");
    });
  });

  it("is idempotent: a second call returns the same item", async () => {
    await asUser(db, A, async (tx) => {
      const ideaId = await idea(tx);
      const first = await start(tx, ideaId);
      expect(await start(tx, ideaId)).toBe(first);
      const { rows } = await tx.query<{ n: number }>("select count(*)::int as n from public.content_items");
      expect(rows[0].n).toBe(1);
    });
  });

  it("returns the scheduled item of a planned idea", async () => {
    await asUser(db, A, async (tx) => {
      const ideaId = await idea(tx);
      await tx.query("select public.schedule_content_ideas($1::jsonb)", [
        JSON.stringify([{ idea_id: ideaId, scheduled_for: inHours(24) }]),
      ]);
      const { rows } = await tx.query<{ id: string }>("select id from public.content_items where idea_id = $1", [ideaId]);
      expect(await start(tx, ideaId)).toBe(rows[0].id);
      expect(await ideaStatus(tx, ideaId)).toBe("planned");
    });
  });

  it("ignores archived items", async () => {
    await asUser(db, A, async (tx) => {
      const ideaId = await idea(tx);
      const itemId = await start(tx, ideaId);
      await tx.query("update public.content_items set status = 'archived' where id = $1", [itemId]);
      await expectRaise(tx, () => start(tx, ideaId), /idea_not_available/);
    });
  });

  it.each(["new", "dismissed", "used"])("refuses a %s idea", async (status) => {
    await asUser(db, A, async (tx) => {
      const ideaId = await idea(tx, status);
      await expectRaise(tx, () => start(tx, ideaId), /idea_not_available/);
      const { rows } = await tx.query<{ n: number }>("select count(*)::int as n from public.content_items");
      expect(rows[0].n).toBe(0);
    });
  });

  it("treats another creator's idea as not found and leaves it alone", async () => {
    await asUser(db, A, async (tx) => {
      await expectRaise(tx, () => start(tx, bobIdea), /idea_not_found/);
    });
    const { rows } = await asService(db, (tx) =>
      tx.query<{ status: string }>("select status from public.content_ideas where id = $1", [bobIdea]),
    );
    expect(rows[0].status).toBe("saved");
  });

  it("raises without an authenticated subject and can't be executed by anon", async () => {
    await expect(asSubjectless(db, (tx) => start(tx, bobIdea))).rejects.toThrow(/authenticated creator/);
    await expect(asAnon(db, (tx) => start(tx, bobIdea))).rejects.toThrow(/permission denied/);
  });
});

describe("schedule_content_item", () => {
  it("schedules a draft and moves its idea from in_production to planned", async () => {
    await asUser(db, A, async (tx) => {
      const ideaId = await idea(tx);
      const itemId = await start(tx, ideaId);
      const at = inHours(24);
      await scheduleItem(tx, itemId, at);
      const { rows } = await tx.query<{ status: string; scheduled_for: Date }>(
        "select status, scheduled_for from public.content_items where id = $1",
        [itemId],
      );
      expect(rows).toEqual([{ status: "scheduled", scheduled_for: new Date(at) }]);
      expect(await ideaStatus(tx, ideaId)).toBe("planned");
    });
  });

  it("refuses an item that isn't a draft", async () => {
    await asUser(db, A, async (tx) => {
      const itemId = await start(tx, await idea(tx));
      await scheduleItem(tx, itemId, inHours(24));
      await expectRaise(tx, () => scheduleItem(tx, itemId, inHours(48)), /item_not_draft/);
    });
  });

  it.each([
    ["more than an hour ago", -2],
    ["more than 180 days ahead", 181 * 24],
  ])("refuses a time %s", async (_label, hours) => {
    await asUser(db, A, async (tx) => {
      const itemId = await start(tx, await idea(tx));
      await expectRaise(tx, () => scheduleItem(tx, itemId, inHours(hours)), /scheduled_for_out_of_range/);
      const { rows } = await tx.query<{ status: string }>("select status from public.content_items where id = $1", [itemId]);
      expect(rows[0].status).toBe("draft");
    });
  });

  it("treats another creator's item as not found and leaves it alone", async () => {
    await asUser(db, A, async (tx) => {
      await expectRaise(tx, () => scheduleItem(tx, bobDraft, inHours(24)), /item_not_found/);
    });
    const { rows } = await asService(db, (tx) =>
      tx.query<{ status: string }>("select status from public.content_items where id = $1", [bobDraft]),
    );
    expect(rows[0].status).toBe("draft");
  });

  it("raises without an authenticated subject and can't be executed by anon", async () => {
    await expect(asSubjectless(db, (tx) => scheduleItem(tx, bobDraft, inHours(24)))).rejects.toThrow(/authenticated creator/);
    await expect(asAnon(db, (tx) => scheduleItem(tx, bobDraft, inHours(24)))).rejects.toThrow(/permission denied/);
  });

  it("then unscheduling a packaged item keeps it as a draft with its idea planned", async () => {
    await asUser(db, A, async (tx) => {
      const ideaId = await idea(tx);
      const itemId = await start(tx, ideaId);
      await insertRow(tx, "content_versions", { user_id: A, content_item_id: itemId, version_no: 1, source: "ai" });
      await scheduleItem(tx, itemId, inHours(24));
      await tx.query("select public.unschedule_content_item($1::uuid)", [itemId]);
      const { rows } = await tx.query<{ status: string; scheduled_for: string | null }>(
        "select status, scheduled_for from public.content_items where id = $1",
        [itemId],
      );
      expect(rows).toEqual([{ status: "draft", scheduled_for: null }]);
      expect(await ideaStatus(tx, ideaId)).toBe("planned");
      // Studio can still open it from the idea.
      expect(await start(tx, ideaId)).toBe(itemId);
    });
  });
});

describe("discard_studio_item", () => {
  const discard = (tx: Transaction, itemId: string) => tx.query("select public.discard_studio_item($1::uuid)", [itemId]);

  it("deletes a draft and its versions and returns its idea to saved", async () => {
    await asUser(db, A, async (tx) => {
      const ideaId = await idea(tx);
      const itemId = await start(tx, ideaId);
      await insertRow(tx, "content_versions", { user_id: A, content_item_id: itemId, version_no: 1, source: "ai" });
      await insertRow(tx, "content_versions", { user_id: A, content_item_id: itemId, version_no: 2, source: "user" });
      await discard(tx, itemId);
      const { rows: items } = await tx.query("select id from public.content_items where id = $1", [itemId]);
      expect(items).toEqual([]);
      const { rows: versions } = await tx.query<{ n: number }>(
        "select count(*)::int as n from public.content_versions where content_item_id = $1",
        [itemId],
      );
      expect(versions[0].n).toBe(0);
      expect(await ideaStatus(tx, ideaId)).toBe("saved");
      // The idea can start a fresh draft.
      expect(await start(tx, ideaId)).not.toBe(itemId);
    });
  });

  it("returns a planned idea to saved (a packaged draft taken off the calendar)", async () => {
    await asUser(db, A, async (tx) => {
      const ideaId = await idea(tx);
      const itemId = await start(tx, ideaId);
      await insertRow(tx, "content_versions", { user_id: A, content_item_id: itemId, version_no: 1, source: "ai" });
      await scheduleItem(tx, itemId, inHours(24));
      await tx.query("select public.unschedule_content_item($1::uuid)", [itemId]);
      expect(await ideaStatus(tx, ideaId)).toBe("planned");
      await discard(tx, itemId);
      expect(await ideaStatus(tx, ideaId)).toBe("saved");
    });
  });

  it("refuses a scheduled item and leaves it alone", async () => {
    await asUser(db, A, async (tx) => {
      const ideaId = await idea(tx);
      const itemId = await start(tx, ideaId);
      await scheduleItem(tx, itemId, inHours(24));
      await expectRaise(tx, () => discard(tx, itemId), /item_not_draft/);
      const { rows } = await tx.query<{ status: string }>("select status from public.content_items where id = $1", [itemId]);
      expect(rows[0].status).toBe("scheduled");
      expect(await ideaStatus(tx, ideaId)).toBe("planned");
    });
  });

  it("treats another creator's item as not found and leaves it and its versions alone", async () => {
    await asUser(db, A, async (tx) => {
      await expectRaise(tx, () => discard(tx, bobDraft), /item_not_found/);
    });
    const { rows } = await asService(db, (tx) =>
      tx.query<{ n: number }>("select count(*)::int as n from public.content_versions where content_item_id = $1", [bobDraft]),
    );
    expect(rows[0].n).toBe(1);
  });

  it("raises without an authenticated subject and can't be executed by anon", async () => {
    await expect(asSubjectless(db, (tx) => discard(tx, bobDraft))).rejects.toThrow(/authenticated creator/);
    await expect(asAnon(db, (tx) => discard(tx, bobDraft))).rejects.toThrow(/permission denied/);
  });

  it("leaves versions append-only for creators", async () => {
    await asUser(db, A, async (tx) => {
      const itemId = await start(tx, await idea(tx));
      await insertRow(tx, "content_versions", { user_id: A, content_item_id: itemId, version_no: 1, source: "ai" });
      await expectRaise(tx, () => tx.query("delete from public.content_versions"), /permission denied/);
      await expectRaise(tx, () => tx.query("update public.content_versions set version_no = 9"), /permission denied/);
    });
  });
});

describe("studio functions", () => {
  it.each(["start_studio_item", "schedule_content_item", "discard_studio_item"])("%s is SECURITY INVOKER with a pinned search_path", async (name) => {
    const { rows } = await db.query<{ prosecdef: boolean; proconfig: string[] }>(
      "select prosecdef, proconfig from pg_proc where proname = $1",
      [name],
    );
    expect(rows).toEqual([{ prosecdef: false, proconfig: ['search_path=""'] }]);
  });
});

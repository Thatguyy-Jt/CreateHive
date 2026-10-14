import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asSubjectless, asUser, createTestDb, insertRow, seedCreator } from "./helpers";

const A = "user_alice";
const B = "user_bob";

let db: PGlite;
let bobIdea: string;
let bobItem: string;

beforeAll(async () => {
  db = await createTestDb();
  await insertRow(db, "users", { id: A });
  await insertRow(db, "creator_profiles", { user_id: A, niche: "Fitness" });
  const bob = await seedCreator(db, B);
  bobIdea = String((await insertRow(db, "content_ideas", { user_id: B, topic: "Bob's idea", status: "saved" })).id);
  bobItem = bob.itemId;
  await db.query("update public.content_items set status = 'scheduled', scheduled_for = now() + interval '1 day' where id = $1", [
    bobItem,
  ]);
});

afterAll(async () => {
  await db.close();
});

const inHours = (hours: number) => new Date(Date.now() + hours * 3600 * 1000).toISOString();

async function idea(tx: Transaction, status = "saved", extra: Record<string, unknown> = {}): Promise<string> {
  return String((await insertRow(tx, "content_ideas", { user_id: A, topic: `Topic ${Math.random()}`, status, ...extra })).id);
}

async function schedule(tx: Transaction, slots: unknown): Promise<number> {
  const { rows } = await tx.query<{ n: number }>("select public.schedule_content_ideas($1::jsonb) as n", [JSON.stringify(slots)]);
  return rows[0].n;
}

/** Runs `fn` expecting it to raise, then rolls back to before it so the transaction stays usable. */
async function expectRaise(tx: Transaction, fn: () => Promise<unknown>, message: RegExp) {
  await tx.query("savepoint attempt");
  await expect(fn()).rejects.toThrow(message);
  await tx.query("rollback to savepoint attempt");
}

describe("creator_profiles.timezone", () => {
  it("is a nullable text column the creator can update", async () => {
    await asUser(db, A, async (tx) => {
      await tx.query("update public.creator_profiles set timezone = 'Africa/Lagos' where user_id = $1", [A]);
      const { rows } = await tx.query<{ timezone: string }>("select timezone from public.creator_profiles");
      expect(rows).toEqual([{ timezone: "Africa/Lagos" }]);
    });
    const { rows } = await db.query<{ timezone: string | null }>("select timezone from public.creator_profiles where user_id = $1", [B]);
    expect(rows[0].timezone).toBeNull();
  });

  it("can't be read or changed for another creator", async () => {
    await asUser(db, A, async (tx) => {
      const { affectedRows } = await tx.query("update public.creator_profiles set timezone = 'UTC' where user_id = $1", [B]);
      expect(affectedRows).toBe(0);
    });
  });
});

describe("schedule_content_ideas", () => {
  it("creates a scheduled item from the idea and marks the idea planned", async () => {
    await asUser(db, A, async (tx) => {
      const pillar = String((await insertRow(tx, "content_pillars", { user_id: A, name: "Quick workouts" })).id);
      const id = await idea(tx, "saved", { platform: "youtube", format: "short", pillar_id: pillar, topic: "10-minute squats" });
      const at = inHours(24);
      expect(await schedule(tx, [{ idea_id: id, scheduled_for: at }])).toBe(1);

      const { rows: items } = await tx.query<Record<string, unknown>>(
        "select user_id, idea_id, pillar_id, title, platform, format, status, scheduled_for from public.content_items",
      );
      expect(items).toEqual([
        {
          user_id: A,
          idea_id: id,
          pillar_id: pillar,
          title: "10-minute squats",
          platform: "youtube",
          format: "short",
          status: "scheduled",
          scheduled_for: new Date(at),
        },
      ]);
      const { rows: ideas } = await tx.query<{ status: string }>("select status from public.content_ideas where id = $1", [id]);
      expect(ideas).toEqual([{ status: "planned" }]);
    });
  });

  it("schedules a batch atomically: one bad slot schedules nothing", async () => {
    await asUser(db, A, async (tx) => {
      const good = await idea(tx);
      const dismissed = await idea(tx, "dismissed");
      await expectRaise(
        tx,
        () =>
          schedule(tx, [
            { idea_id: good, scheduled_for: inHours(24) },
            { idea_id: dismissed, scheduled_for: inHours(48) },
          ]),
        /idea_not_saved/,
      );
      const { rows } = await tx.query<{ n: number }>("select count(*)::int as n from public.content_items");
      expect(rows[0].n).toBe(0);
      const { rows: status } = await tx.query<{ status: string }>("select status from public.content_ideas where id = $1", [good]);
      expect(status[0].status).toBe("saved");
    });
  });

  it.each(["new", "dismissed", "planned", "in_production", "used"])("refuses a %s idea", async (status) => {
    await asUser(db, A, async (tx) => {
      const id = await idea(tx, status);
      await expectRaise(tx, () => schedule(tx, [{ idea_id: id, scheduled_for: inHours(24) }]), /idea_not_saved/);
    });
  });

  it("refuses to schedule the same idea twice", async () => {
    await asUser(db, A, async (tx) => {
      const id = await idea(tx);
      await schedule(tx, [{ idea_id: id, scheduled_for: inHours(24) }]);
      await expectRaise(tx, () => schedule(tx, [{ idea_id: id, scheduled_for: inHours(48) }]), /idea_not_saved/);
      const { rows } = await tx.query<{ n: number }>("select count(*)::int as n from public.content_items");
      expect(rows[0].n).toBe(1);
    });
  });

  it("treats another creator's idea as not found", async () => {
    await asUser(db, A, async (tx) => {
      await expectRaise(tx, () => schedule(tx, [{ idea_id: bobIdea, scheduled_for: inHours(24) }]), /idea_not_found/);
    });
    const { rows } = await asService(db, (tx) =>
      tx.query<{ status: string }>("select status from public.content_ideas where id = $1", [bobIdea]),
    );
    expect(rows[0].status).toBe("saved");
  });

  it.each([
    ["a duplicate idea in one batch", "dup", /duplicate_idea/],
    ["an empty batch", [], /invalid_slots/],
    ["more than 20 slots", "many", /invalid_slots/],
    ["a non-array", { idea_id: "x" }, /invalid_slots/],
    ["a missing date", "nodate", /invalid_slots/],
  ] as const)("rejects %s", async (_label, kind, error) => {
    await asUser(db, A, async (tx) => {
      const id = await idea(tx);
      const slots =
        kind === "dup"
          ? [
              { idea_id: id, scheduled_for: inHours(24) },
              { idea_id: id, scheduled_for: inHours(48) },
            ]
          : kind === "many"
            ? Array.from({ length: 21 }, (_, i) => ({ idea_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, scheduled_for: inHours(24) }))
            : kind === "nodate"
              ? [{ idea_id: id }]
              : kind;
      await expectRaise(tx, () => schedule(tx, slots), error);
    });
  });

  it.each([
    ["more than an hour ago", -2],
    ["more than 180 days ahead", 181 * 24],
  ])("refuses a time %s", async (_label, hours) => {
    await asUser(db, A, async (tx) => {
      const id = await idea(tx);
      await expectRaise(tx, () => schedule(tx, [{ idea_id: id, scheduled_for: inHours(hours) }]), /scheduled_for_out_of_range/);
    });
  });

  it("allows a time within the 1-hour grace", async () => {
    await asUser(db, A, async (tx) => {
      const id = await idea(tx);
      expect(await schedule(tx, [{ idea_id: id, scheduled_for: inHours(-0.5) }])).toBe(1);
    });
  });

  it("raises without an authenticated subject", async () => {
    await expect(asSubjectless(db, (tx) => schedule(tx, [{ idea_id: bobIdea, scheduled_for: inHours(24) }]))).rejects.toThrow(
      /authenticated creator/,
    );
  });

  it("cannot be executed by anon", async () => {
    await expect(asAnon(db, (tx) => schedule(tx, [{ idea_id: bobIdea, scheduled_for: inHours(24) }]))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("unschedule_content_item", () => {
  async function scheduled(tx: Transaction): Promise<{ ideaId: string; itemId: string }> {
    const ideaId = await idea(tx);
    await schedule(tx, [{ idea_id: ideaId, scheduled_for: inHours(24) }]);
    const { rows } = await tx.query<{ id: string }>("select id from public.content_items where idea_id = $1", [ideaId]);
    return { ideaId, itemId: rows[0].id };
  }

  const unschedule = (tx: Transaction, id: string) => tx.query("select public.unschedule_content_item($1::uuid)", [id]);

  it("deletes an item without versions and returns its idea to saved", async () => {
    await asUser(db, A, async (tx) => {
      const { ideaId, itemId } = await scheduled(tx);
      await unschedule(tx, itemId);
      const { rows } = await tx.query("select id from public.content_items where id = $1", [itemId]);
      expect(rows).toEqual([]);
      const { rows: status } = await tx.query<{ status: string }>("select status from public.content_ideas where id = $1", [ideaId]);
      expect(status[0].status).toBe("saved");
    });
  });

  it("keeps an item with versions as an undated draft and leaves the idea planned", async () => {
    await asUser(db, A, async (tx) => {
      const { ideaId, itemId } = await scheduled(tx);
      await insertRow(tx, "content_versions", { user_id: A, content_item_id: itemId, version_no: 1, source: "user" });
      await unschedule(tx, itemId);
      const { rows } = await tx.query<{ status: string; scheduled_for: string | null }>(
        "select status, scheduled_for from public.content_items where id = $1",
        [itemId],
      );
      expect(rows).toEqual([{ status: "draft", scheduled_for: null }]);
      const { rows: versions } = await tx.query<{ n: number }>("select count(*)::int as n from public.content_versions");
      expect(versions[0].n).toBe(1);
      const { rows: status } = await tx.query<{ status: string }>("select status from public.content_ideas where id = $1", [ideaId]);
      expect(status[0].status).toBe("planned");
    });
  });

  it("refuses an item that isn't scheduled", async () => {
    await asUser(db, A, async (tx) => {
      const { itemId } = await scheduled(tx);
      await tx.query("update public.content_items set status = 'published' where id = $1", [itemId]);
      await expectRaise(tx, () => unschedule(tx, itemId), /item_not_found/);
      const { rows } = await tx.query("select id from public.content_items where id = $1", [itemId]);
      expect(rows).toHaveLength(1);
    });
  });

  it("treats another creator's item as not found and leaves it alone", async () => {
    await asUser(db, A, async (tx) => {
      await expectRaise(tx, () => unschedule(tx, bobItem), /item_not_found/);
    });
    const { rows } = await asService(db, (tx) =>
      tx.query<{ status: string }>("select status from public.content_items where id = $1", [bobItem]),
    );
    expect(rows[0].status).toBe("scheduled");
  });

  it("raises without an authenticated subject", async () => {
    await expect(asSubjectless(db, (tx) => unschedule(tx, bobItem))).rejects.toThrow(/authenticated creator/);
  });

  it("cannot be executed by anon", async () => {
    await expect(asAnon(db, (tx) => unschedule(tx, bobItem))).rejects.toThrow(/permission denied/);
  });
});

describe("calendar functions", () => {
  it.each(["schedule_content_ideas", "unschedule_content_item"])("%s is SECURITY INVOKER with a pinned search_path", async (name) => {
    const { rows } = await db.query<{ prosecdef: boolean; proconfig: string[] }>(
      "select prosecdef, proconfig from pg_proc where proname = $1",
      [name],
    );
    expect(rows).toEqual([{ prosecdef: false, proconfig: ['search_path=""'] }]);
  });

  it("only let a creator see their own scheduled items", async () => {
    await asUser(db, A, async (tx) => {
      const { rows } = await tx.query("select id from public.content_items where id = $1", [bobItem]);
      expect(rows).toEqual([]);
    });
  });
});

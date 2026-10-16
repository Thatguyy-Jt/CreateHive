import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asSubjectless, asUser, createTestDb, insertRow, seedCreator } from "./helpers";

const A = "user_alice";
const B = "user_bob";

let db: PGlite;
let bobItem: string;

beforeAll(async () => {
  db = await createTestDb();
  await insertRow(db, "users", { id: A });
  bobItem = (await seedCreator(db, B)).itemId;
});

afterAll(async () => {
  await db.close();
});

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3600 * 1000).toISOString();

async function idea(tx: Transaction, status: string): Promise<string> {
  return String((await insertRow(tx, "content_ideas", { user_id: A, topic: `Topic ${Math.random()}`, status })).id);
}

async function item(tx: Transaction, status: string, ideaId: string | null = null): Promise<string> {
  return String((await insertRow(tx, "content_items", { user_id: A, title: "Squats", status, idea_id: ideaId })).id);
}

const publish = (tx: Transaction, itemId: string, at = hoursFromNow(-2), extra: unknown[] = [null, null, null]) =>
  tx.query("select public.publish_content_item($1::uuid, $2::timestamptz, $3, $4, $5::integer)", [itemId, at, ...extra]);

const row = async (tx: Pick<Transaction, "query">, table: string, id: string) =>
  (await tx.query<Record<string, unknown>>(`select * from public.${table} where id = $1`, [id])).rows[0];

/** Runs `fn` expecting it to raise, then rolls back to before it so the transaction stays usable. */
async function expectRaise(tx: Transaction, fn: () => Promise<unknown>, message: RegExp) {
  await tx.query("savepoint attempt");
  await expect(fn()).rejects.toThrow(message);
  await tx.query("rollback to savepoint attempt");
}

describe("publish_content_item", () => {
  it("publishes a scheduled item with its details and moves its idea to used", async () => {
    await asUser(db, A, async (tx) => {
      const ideaId = await idea(tx, "planned");
      const itemId = await item(tx, "scheduled", ideaId);
      await tx.query("update public.content_items set scheduled_for = $2 where id = $1", [itemId, hoursFromNow(-3)]);
      const at = hoursFromNow(-2);
      await publish(tx, itemId, at, ["https://youtube.com/shorts/1", "Stop doing squats wrong", 45]);

      const published = await row(tx, "content_items", itemId);
      expect(published).toMatchObject({
        status: "published",
        published_url: "https://youtube.com/shorts/1",
        hook_used: "Stop doing squats wrong",
        duration_seconds: 45,
      });
      expect(new Date(published.published_at as string).toISOString()).toBe(at);
      expect(published.scheduled_for).not.toBeNull();
      expect((await row(tx, "content_ideas", ideaId)).status).toBe("used");
    });
  });

  it("publishes drafts, with optional details defaulting to null", async () => {
    await asUser(db, A, async (tx) => {
      const ideaId = await idea(tx, "in_production");
      const itemId = await item(tx, "draft", ideaId);
      await tx.query("select public.publish_content_item($1::uuid, $2::timestamptz)", [itemId, hoursFromNow(-1)]);
      expect(await row(tx, "content_items", itemId)).toMatchObject({ status: "published", published_url: null, hook_used: null });
      expect((await row(tx, "content_ideas", ideaId)).status).toBe("used");
    });
  });

  it("refuses published and archived items", async () => {
    await asUser(db, A, async (tx) => {
      for (const status of ["published", "archived"]) {
        const itemId = await item(tx, status);
        await expectRaise(tx, () => publish(tx, itemId), /item_not_publishable/);
      }
    });
  });

  it("refuses dates over 2 years ago or more than an hour ahead", async () => {
    await asUser(db, A, async (tx) => {
      const itemId = await item(tx, "draft");
      await expectRaise(tx, () => publish(tx, itemId, hoursFromNow(2)), /published_at_out_of_range/);
      await expectRaise(tx, () => publish(tx, itemId, hoursFromNow(-24 * 731)), /published_at_out_of_range/);
      await expectRaise(tx, () => publish(tx, itemId, null as unknown as string), /published_at_out_of_range/);
      expect((await row(tx, "content_items", itemId)).status).toBe("draft");
    });
  });

  it("refuses another creator's item", async () => {
    await asUser(db, A, async (tx) => {
      await expectRaise(tx, () => publish(tx, bobItem), /item_not_found/);
    });
    expect((await row(db, "content_items", bobItem)).status).toBe("draft");
  });

  it("requires a signed-in creator", async () => {
    await asAnon(db, async (tx) => {
      await expect(publish(tx, bobItem)).rejects.toThrow(/permission denied/);
    });
    await asSubjectless(db, async (tx) => {
      await expect(publish(tx, bobItem)).rejects.toThrow(/requires an authenticated creator/);
    });
  });
});

describe("content_items publish columns", () => {
  it("bound hook_used and duration_seconds", async () => {
    await asUser(db, A, async (tx) => {
      const itemId = await item(tx, "published");
      const set = (column: string, value: unknown) =>
        tx.query(`update public.content_items set ${column} = $2 where id = $1`, [itemId, value]);
      await expectRaise(tx, () => set("hook_used", ""), /check constraint/);
      await expectRaise(tx, () => set("hook_used", "x".repeat(301)), /check constraint/);
      await expectRaise(tx, () => set("duration_seconds", 0), /check constraint/);
      await expectRaise(tx, () => set("duration_seconds", 86_401), /check constraint/);
      await set("hook_used", "x".repeat(300));
      await set("duration_seconds", 86_400);
    });
  });
});

describe("posts and check-ins", () => {
  it("lets a creator log a past post and add results, and deleting the post removes them", async () => {
    await asUser(db, A, async (tx) => {
      const post = await insertRow(tx, "content_items", {
        user_id: A,
        title: "Old video",
        platform: "youtube",
        status: "published",
        published_at: hoursFromNow(-24 * 30),
      });
      await insertRow(tx, "analytics_snapshots", { user_id: A, content_item_id: post.id, views: 1200, source: "manual" });
      await insertRow(tx, "analytics_snapshots", { user_id: A, content_item_id: post.id, views: 1500, source: "manual" });

      await tx.query("delete from public.content_items where id = $1", [post.id]);
      const { rows } = await tx.query("select id from public.analytics_snapshots where content_item_id = $1", [post.id]);
      expect(rows).toEqual([]);
    });
  });

  it("has the per-item index for check-ins in time order", async () => {
    const { rows } = await db.query<{ indexname: string }>(
      "select indexname from pg_indexes where tablename = 'analytics_snapshots' and indexname like '%content_item%'",
    );
    expect(rows.map((r) => r.indexname)).toEqual(["analytics_snapshots_content_item_id_captured_at_idx"]);
  });
});

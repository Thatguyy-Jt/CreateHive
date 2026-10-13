import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, insertRow } from "./helpers";

const A = "user_alice";
const B = "user_bob";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await insertRow(db, "users", { id: A });
  await insertRow(db, "users", { id: B });
});

afterAll(async () => {
  await db.close();
});

const manual = (userId: string, externalId = "hash1") => ({
  user_id: userId,
  source: "manual",
  external_id: externalId,
  signal_type: "audience_comment",
  payload: JSON.stringify({ text: "I only have 10 minutes", label: null }),
});

describe("research_signals", () => {
  it("lets the owner add, read and delete signals", async () => {
    await asUser(db, A, async (tx) => {
      const row = await insertRow(tx, "research_signals", manual(A));
      const { rows } = await tx.query<{ signal_type: string; expires_at: string | null }>(
        "select signal_type, expires_at from public.research_signals",
      );
      expect(rows).toEqual([{ signal_type: "audience_comment", expires_at: null }]);
      const deleted = await tx.query("delete from public.research_signals where id = $1", [row.id]);
      expect(deleted.affectedRows).toBe(1);
    });
  });

  it("rejects a duplicate (user, source, external_id) but allows the same hash for another creator", async () => {
    await insertRow(db, "research_signals", manual(A, "dup"));
    await expect(insertRow(db, "research_signals", manual(A, "dup"))).rejects.toThrow(/duplicate key|unique/);
    await expect(insertRow(db, "research_signals", manual(B, "dup"))).resolves.toBeTruthy();
  });

  it("upserts YouTube rows on (user_id, source, external_id)", async () => {
    await asUser(db, A, async (tx) => {
      const upsert = (title: string) =>
        tx.query(
          `insert into public.research_signals (user_id, source, external_id, signal_type, title, expires_at)
           values ($1, 'youtube', 'vid1', 'video', $2, now() + interval '7 days')
           on conflict (user_id, source, external_id) do update set title = excluded.title`,
          [A, title],
        );
      await upsert("First");
      await upsert("Second");
      const { rows } = await tx.query<{ title: string }>(
        "select title from public.research_signals where source = 'youtube'",
      );
      expect(rows).toEqual([{ title: "Second" }]);
    });
  });

  it("hides expired rows with the list filter", async () => {
    await asUser(db, A, async (tx) => {
      await insertRow(tx, "research_signals", { ...manual(A, "fresh"), expires_at: null });
      await insertRow(tx, "research_signals", {
        ...manual(A, "old"),
        source: "youtube",
        signal_type: "video",
        expires_at: "2020-01-01T00:00:00Z",
      });
      const { rows } = await tx.query<{ external_id: string }>(
        "select external_id from public.research_signals where (expires_at is null or expires_at > now()) and external_id in ('fresh', 'old')",
      );
      expect(rows).toEqual([{ external_id: "fresh" }]);
    });
  });

  it("isolates creators: B can't read, change or delete A's signals, or add one as A", async () => {
    const id = String((await insertRow(db, "research_signals", manual(A, "private"))).id);
    await asUser(db, B, async (tx) => {
      expect((await tx.query("select id from public.research_signals where id = $1", [id])).rows).toEqual([]);
      expect((await tx.query("update public.research_signals set title = 'x' where id = $1", [id])).affectedRows).toBe(0);
      expect((await tx.query("delete from public.research_signals where id = $1", [id])).affectedRows).toBe(0);
      await expect(insertRow(tx, "research_signals", manual(A, "forged"))).rejects.toThrow(/row-level security/);
    });
    const { rows } = await db.query("select id from public.research_signals where id = $1", [id]);
    expect(rows).toHaveLength(1);
  });
});

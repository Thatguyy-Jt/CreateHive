import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, insertRow, seedCreator } from "./helpers";

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

const diagnosis = JSON.stringify({ schema_version: 1 });

async function post(tx: Transaction): Promise<string> {
  return String(
    (await insertRow(tx, "content_items", { user_id: A, title: "Squats", status: "published", published_at: new Date().toISOString() }))
      .id,
  );
}

async function expectRaise(tx: Transaction, fn: () => Promise<unknown>, message: RegExp) {
  await tx.query("savepoint attempt");
  await expect(fn()).rejects.toThrow(message);
  await tx.query("rollback to savepoint attempt");
}

describe("content_diagnoses", () => {
  it("lets a creator add, read and delete diagnoses of their own post, but never edit one", async () => {
    await asUser(db, A, async (tx) => {
      const itemId = await post(tx);
      const row = await insertRow(tx, "content_diagnoses", {
        user_id: A,
        content_item_id: itemId,
        prompt_version: "v1",
        diagnosis,
      });
      const { rows } = await tx.query("select id from public.content_diagnoses");
      expect(rows).toEqual([{ id: row.id }]);

      await expectRaise(tx, () => tx.query("update public.content_diagnoses set prompt_version = 'v2'"), /permission denied/);
      const deleted = await tx.query("delete from public.content_diagnoses where id = $1", [row.id]);
      expect(deleted.affectedRows).toBe(1);
    });
  });

  it("refuses a diagnosis that points at another creator's post", async () => {
    await asUser(db, A, async (tx) => {
      await expectRaise(
        tx,
        () => insertRow(tx, "content_diagnoses", { user_id: A, content_item_id: bobItem, prompt_version: "v1", diagnosis }),
        /foreign key constraint/,
      );
    });
  });

  it("is deleted with its post", async () => {
    await asUser(db, A, async (tx) => {
      const itemId = await post(tx);
      await insertRow(tx, "content_diagnoses", { user_id: A, content_item_id: itemId, prompt_version: "v1", diagnosis });
      await tx.query("delete from public.content_items where id = $1", [itemId]);
      const { rows } = await tx.query("select id from public.content_diagnoses where content_item_id = $1", [itemId]);
      expect(rows).toEqual([]);
    });
  });

  it("requires a prompt version and content", async () => {
    await asUser(db, A, async (tx) => {
      const itemId = await post(tx);
      await expectRaise(
        tx,
        () => insertRow(tx, "content_diagnoses", { user_id: A, content_item_id: itemId, prompt_version: "", diagnosis }),
        /check constraint/,
      );
      await expectRaise(
        tx,
        () => insertRow(tx, "content_diagnoses", { user_id: A, content_item_id: itemId, prompt_version: "v1" }),
        /null value/,
      );
    });
  });
});

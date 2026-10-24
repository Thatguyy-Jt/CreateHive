import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXPORT_TABLES } from "@/lib/services/account-data";
import { asService, asUser, createTestDb, seedCreator } from "./helpers";

const ALICE = "user_alice";
const BOB = "user_bob";

let db: PGlite;
/** Every public table with a `user_id` column, read from the migrated schema. */
let userTables: string[];

beforeAll(async () => {
  db = await createTestDb();
  await seedCreator(db, ALICE);
  await seedCreator(db, BOB);
  const { rows } = await db.query<{ table_name: string }>(
    `select table_name from information_schema.columns
     where table_schema = 'public' and column_name = 'user_id'
     order by table_name`,
  );
  userTables = rows.map((r) => r.table_name);
});

afterAll(async () => {
  await db.close();
});

const countFor = async (q: Pick<PGlite, "query">, table: string, userId: string) =>
  Number((await q.query<{ n: number }>(`select count(*)::int as n from public.${table} where user_id = $1`, [userId])).rows[0].n);

describe("account export coverage", () => {
  it("exports every table that holds creator rows", () => {
    expect(Object.keys(EXPORT_TABLES).sort()).toEqual(userTables);
  });

  it("lets the creator read every exported table, and only their own rows", async () => {
    await asUser(db, ALICE, async (tx) => {
      for (const table of Object.keys(EXPORT_TABLES)) {
        const { rows } = await tx.query<{ user_id: string }>(`select user_id from public.${table}`);
        expect(rows.length, table).toBeGreaterThan(0);
        expect(new Set(rows.map((r) => r.user_id)), table).toEqual(new Set([ALICE]));
      }
    });
  });
});

describe("account deletion", () => {
  it("deleting the users row as service role removes every row of that creator and none of another's", async () => {
    await asService(db, async (tx) => {
      const before = await Promise.all(userTables.map((t) => countFor(tx, t, BOB)));

      await tx.query("delete from public.users where id = $1", [ALICE]);

      for (const table of userTables) expect(await countFor(tx, table, ALICE), table).toBe(0);
      expect((await tx.query("select 1 from public.users where id = $1", [ALICE])).rows).toHaveLength(0);
      expect(await Promise.all(userTables.map((t) => countFor(tx, t, BOB)))).toEqual(before);
    });
  });

  it("creators can't delete their own users row directly", async () => {
    await asUser(db, ALICE, async (tx) => {
      await expect(tx.query("delete from public.users where id = $1", [ALICE])).rejects.toThrow(/permission denied/);
    });
  });
});

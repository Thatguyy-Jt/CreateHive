import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_ENUM_COLUMNS } from "@/lib/schemas/enums";
import { createTestDb } from "./helpers";

let db: PGlite;
/** `table.column` → allowed values, read from the migrated database's check constraints. */
let dbEnums: Map<string, string[]>;

beforeAll(async () => {
  db = await createTestDb();
  const { rows } = await db.query<{ table_name: string; column_name: string; def: string }>(
    `select t.relname as table_name, a.attname as column_name, pg_get_constraintdef(c.oid) as def
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_attribute a on a.attrelid = t.oid and a.attnum = c.conkey[1]
     where c.contype = 'c'
       and t.relnamespace = 'public'::regnamespace
       and array_length(c.conkey, 1) = 1`,
  );

  dbEnums = new Map();
  for (const row of rows) {
    // Value-list checks render as `= ANY (ARRAY['a'::text, 'b'::text])`.
    if (!row.def.includes("ANY (ARRAY[")) continue;
    const values = [...row.def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
    dbEnums.set(`${row.table_name}.${row.column_name}`, values);
  }
});

afterAll(async () => {
  await db.close();
});

describe("Zod enums match database check constraints", () => {
  it("covers every value-list constraint in the schema", () => {
    expect([...dbEnums.keys()].sort()).toEqual(Object.keys(DB_ENUM_COLUMNS).sort());
  });

  it.each(Object.entries(DB_ENUM_COLUMNS))("%s", (column, schema) => {
    // Order is irrelevant to validity; compare as sets.
    expect(dbEnums.get(column)?.toSorted()).toEqual(schema.options.toSorted());
  });
});

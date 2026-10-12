import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_TABLES, createTestDb } from "./helpers";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

describe("core schema", () => {
  it("creates exactly the core tables in public", async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select relname from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r'
       order by relname`,
    );
    expect(rows.map((r) => r.relname)).toEqual([...CORE_TABLES].sort());
  });

  it("enables and forces RLS on every table", async () => {
    const { rows } = await db.query<{ relname: string; enabled: boolean; forced: boolean }>(
      `select relname, relrowsecurity as enabled, relforcerowsecurity as forced
       from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    );
    expect(rows).toHaveLength(CORE_TABLES.length);
    for (const row of rows) {
      expect(row, row.relname).toMatchObject({ enabled: true, forced: true });
    }
  });

  it("gives every table at least a select policy", async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `select distinct tablename from pg_policies where schemaname = 'public' and cmd = 'SELECT'`,
    );
    expect(rows.map((r) => r.tablename).sort()).toEqual([...CORE_TABLES].sort());
  });

  it("targets every policy at authenticated only", async () => {
    const { rows } = await db.query<{ policyname: string; roles: string }>(
      `select policyname, roles::text from pg_policies where schemaname = 'public'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.roles, row.policyname).toBe("{authenticated}");
    }
  });

  // The SELECT policy also blocks reassignment today, but WITH CHECK must not
  // rely on that: it has to enforce the same ownership predicate as USING.
  it("makes every update policy's WITH CHECK match its USING", async () => {
    const { rows } = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
       where schemaname = 'public' and cmd = 'UPDATE'
         and (with_check is null or with_check <> qual)`,
    );
    expect(rows).toEqual([]);
  });

  it("grants anon nothing on public tables", async () => {
    const { rows } = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon'`,
    );
    expect(rows).toEqual([]);
  });

  it("defines no SECURITY DEFINER functions in public", async () => {
    const { rows } = await db.query<{ proname: string }>(
      `select proname from pg_proc where pronamespace = 'public'::regnamespace and prosecdef`,
    );
    expect(rows).toEqual([]);
  });

  it("indexes user_id on every creator-owned table", async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `select distinct t.relname as tablename
       from pg_index i
       join pg_class t on t.oid = i.indrelid
       join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
       where t.relnamespace = 'public'::regnamespace and a.attname = 'user_id'`,
    );
    const owned = CORE_TABLES.filter((t) => t !== "users");
    expect(rows.map((r) => r.tablename).sort()).toEqual([...owned].sort());
  });

  it("cascades a user's deletion to all of their data", async () => {
    await db.transaction(async (tx) => {
      await tx.query("insert into public.users (id) values ('user_gone')");
      const { rows: item } = await tx.query<{ id: string }>(
        "insert into public.content_items (user_id, title) values ('user_gone', 't') returning id",
      );
      await tx.query(
        "insert into public.content_versions (user_id, content_item_id, version_no, source) values ('user_gone', $1, 1, 'ai')",
        [item[0].id],
      );
      await tx.query("delete from public.users where id = 'user_gone'");
      const { rows } = await tx.query<{ n: number }>(
        `select (select count(*) from public.content_items where user_id = 'user_gone')
              + (select count(*) from public.content_versions where user_id = 'user_gone') as n`,
      );
      expect(Number(rows[0].n)).toBe(0);
      await tx.rollback();
    });
  });
});

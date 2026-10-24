import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ABANDONED_CODE } from "@/lib/jobs/daily-maintenance";
import { asService, createTestDb, insertRow } from "./helpers";

// The maintenance queries as SQL against the migrated schema, mirroring the
// PostgREST filters in lib/jobs/daily-maintenance.ts and lib/ai/limits.ts.

const USER = "user_alice";
let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await insertRow(db, "users", { id: USER, email: "a@example.com" });
});

afterAll(async () => {
  await db.close();
});

/** `checkDailyLimit`'s filter: `status.neq.failed,error_code.eq.invalid_output`. */
const COUNTED = `select count(*)::int as n from public.ai_generations
  where user_id = $1 and (status <> 'failed' or error_code = 'invalid_output')`;

describe("abandoned generations", () => {
  it("fails only old pending rows, which then stop counting toward limits", async () => {
    await asService(db, async (tx) => {
      const seed = (status: string, minutesAgo: number) =>
        insertRow(tx, "ai_generations", {
          user_id: USER,
          kind: "content_package",
          status,
          created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
        });
      await seed("pending", 60);
      await seed("pending", 5);
      await seed("succeeded", 60);

      expect((await tx.query<{ n: number }>(COUNTED, [USER])).rows[0].n).toBe(3);

      const updated = await tx.query(
        `update public.ai_generations set status = 'failed', error_code = $1, completed_at = now()
         where status = 'pending' and created_at < now() - interval '15 minutes'`,
        [ABANDONED_CODE],
      );
      expect(updated.affectedRows).toBe(1);
      expect((await tx.query<{ n: number }>(COUNTED, [USER])).rows[0].n).toBe(2);
    });
  });
});

describe("expired signals", () => {
  it("deletes expired rows and keeps unexpired and expiry-less ones", async () => {
    await asService(db, async (tx) => {
      const seed = (title: string, expiresAt: string | null) =>
        insertRow(tx, "research_signals", {
          user_id: USER,
          source: "manual",
          signal_type: "comment",
          title,
          expires_at: expiresAt,
        });
      await seed("expired", new Date(Date.now() - 60_000).toISOString());
      await seed("fresh", new Date(Date.now() + 60_000).toISOString());
      await seed("forever", null);

      await tx.query("delete from public.research_signals where expires_at < now()");
      const { rows } = await tx.query<{ title: string }>("select title from public.research_signals order by title");
      expect(rows.map((r) => r.title)).toEqual(["forever", "fresh"]);
    });
  });
});

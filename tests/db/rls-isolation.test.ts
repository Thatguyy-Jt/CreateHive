import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asService,
  asSubjectless,
  asUser,
  createTestDb,
  insertRow,
  seedCreator,
  STRATEGY_JSON,
  type CoreTable,
  type Fixture,
} from "./helpers";

const A = "user_alice";
const B = "user_bob";

const DENIED = /row-level security|permission denied/;
const PERMISSION_DENIED = /permission denied/;
const FK_VIOLATION = /foreign key constraint/;

type Op = "select" | "insert" | "update" | "delete";

interface TableSpec {
  table: CoreTable;
  /** Operations the `authenticated` role may perform on its own rows. */
  ops: Op[];
  /** Column holding the owner's Clerk id. */
  ownerCol: "user_id" | "id";
  /** A harmless update the creator is allowed to make (when update is granted). */
  update: Record<string, unknown>;
  /** A valid row owned by `f.userId`. */
  payload: (f: Fixture) => Record<string, unknown>;
}

const ALL: Op[] = ["select", "insert", "update", "delete"];

const SPECS: TableSpec[] = [
  {
    table: "users",
    ops: ["select", "insert", "update"],
    ownerCol: "id",
    update: { display_name: "Renamed" },
    payload: (f) => ({ id: f.userId }),
  },
  {
    table: "subscriptions",
    ops: ["select"],
    ownerCol: "user_id",
    update: { plan: "pro" },
    payload: (f) => ({ user_id: f.userId, plan: "pro" }),
  },
  {
    table: "creator_profiles",
    ops: ALL,
    ownerCol: "user_id",
    update: { niche: "Cooking" },
    payload: (f) => ({ user_id: f.userId, niche: "Cooking" }),
  },
  {
    table: "brand_profiles",
    ops: ALL,
    ownerCol: "user_id",
    update: { tone: "dry" },
    payload: (f) => ({ user_id: f.userId, tone: "dry" }),
  },
  {
    table: "content_pillars",
    ops: ALL,
    ownerCol: "user_id",
    update: { name: "Renamed" },
    payload: (f) => ({ user_id: f.userId, name: "New pillar" }),
  },
  {
    table: "content_ideas",
    ops: ALL,
    ownerCol: "user_id",
    update: { topic: "Changed" },
    payload: (f) => ({ user_id: f.userId, topic: "New", pillar_id: f.pillarId }),
  },
  {
    table: "content_items",
    ops: ALL,
    ownerCol: "user_id",
    update: { title: "Changed" },
    payload: (f) => ({ user_id: f.userId, title: "New", idea_id: f.ideaId }),
  },
  {
    table: "content_versions",
    ops: ["select", "insert"],
    ownerCol: "user_id",
    update: { note: "edited" },
    payload: (f) => ({ user_id: f.userId, content_item_id: f.itemId, version_no: 2, source: "user" }),
  },
  {
    table: "analytics_snapshots",
    ops: ALL,
    ownerCol: "user_id",
    update: { views: 1 },
    payload: (f) => ({ user_id: f.userId, content_item_id: f.itemId, views: 5 }),
  },
  {
    table: "competitors",
    ops: ALL,
    ownerCol: "user_id",
    update: { notes: "changed" },
    payload: (f) => ({ user_id: f.userId, platform: "tiktok", handle: "@other" }),
  },
  {
    table: "research_signals",
    ops: ALL,
    ownerCol: "user_id",
    update: { title: "changed" },
    payload: (f) => ({ user_id: f.userId, source: "manual", signal_type: "trend" }),
  },
  {
    table: "creator_insights",
    ops: ALL,
    ownerCol: "user_id",
    update: { summary: "changed" },
    payload: (f) => ({ user_id: f.userId, insight_type: "topic", summary: "New insight" }),
  },
  {
    table: "ai_generations",
    ops: ["select"],
    ownerCol: "user_id",
    update: { status: "failed" },
    payload: (f) => ({ user_id: f.userId, kind: "strategy" }),
  },
  {
    table: "assets",
    ops: ALL,
    ownerCol: "user_id",
    update: { name: "renamed.png" },
    payload: (f) => ({
      user_id: f.userId,
      name: "new.png",
      mime_type: "image/png",
      size_bytes: 1,
      storage_path: `${f.userId}/new.png`,
    }),
  },
  {
    table: "usage_events",
    ops: ["select"],
    ownerCol: "user_id",
    update: { quantity: 99 },
    payload: (f) => ({ user_id: f.userId, event_type: "ai_generation" }),
  },
  {
    table: "creator_strategies",
    ops: ALL,
    ownerCol: "user_id",
    update: { positioning: "Changed" },
    payload: (f) => ({
      user_id: f.userId,
      positioning: "Spoofed",
      growth_objective: "g",
      monetization_objective: "m",
      ...STRATEGY_JSON,
    }),
  },
  {
    table: "content_diagnoses",
    ops: ["select", "insert", "delete"],
    ownerCol: "user_id",
    update: { prompt_version: "v9" },
    payload: (f) => ({
      user_id: f.userId,
      content_item_id: f.itemId,
      prompt_version: "v1",
      diagnosis: JSON.stringify({ schema_version: 1 }),
    }),
  },
  {
    table: "payments",
    ops: ["select"],
    ownerCol: "user_id",
    update: { status: "succeeded" },
    payload: (f) => ({
      user_id: f.userId,
      provider: "paystack",
      kind: "subscription_start",
      plan: "pro",
      reference: `ch_forged_${f.userId}`,
      amount_minor: 1,
    }),
  },
  {
    table: "notifications",
    ops: ["select", "update", "delete"],
    ownerCol: "user_id",
    update: { read_at: "2026-10-09T00:00:00Z" },
    payload: (f) => ({ user_id: f.userId, type: "digest", title: "Spoofed" }),
  },
];

function setClause(values: Record<string, unknown>, offset = 1) {
  return Object.keys(values)
    .map((col, i) => `${col} = $${i + offset}`)
    .join(", ");
}

let db: PGlite;
let alice: Fixture;
let bob: Fixture;

beforeAll(async () => {
  db = await createTestDb();
  alice = await seedCreator(db, A);
  bob = await seedCreator(db, B);
});

afterAll(async () => {
  await db.close();
});

describe.each(SPECS)("$table", (spec) => {
  const { table, ops, ownerCol } = spec;
  const can = (op: Op) => ops.includes(op);

  it("lets the owner read their own row", async () => {
    const { rows } = await asUser(db, A, (tx) =>
      tx.query(`select 1 from public.${table} where id = $1`, [alice.rowIds[table]]),
    );
    expect(rows).toHaveLength(1);
  });

  it("hides another creator's rows", async () => {
    const { rows } = await asUser(db, B, (tx) =>
      tx.query<{ owner: string }>(`select ${ownerCol} as owner from public.${table}`),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.owner === B)).toBe(true);

    const targeted = await asUser(db, B, (tx) =>
      tx.query(`select 1 from public.${table} where id = $1`, [alice.rowIds[table]]),
    );
    expect(targeted.rows).toHaveLength(0);
  });

  it("blocks inserting a row owned by another creator", async () => {
    await expect(asUser(db, B, (tx) => insertRow(tx, table, spec.payload(alice)))).rejects.toThrow(
      DENIED,
    );
  });

  if (can("update")) {
    it("does not update another creator's row", async () => {
      const result = await asUser(db, B, (tx) =>
        tx.query(`update public.${table} set ${setClause(spec.update)} where id = $${Object.keys(spec.update).length + 1}`, [
          ...Object.values(spec.update),
          alice.rowIds[table],
        ]),
      );
      expect(result.affectedRows).toBe(0);
    });

    it("lets the owner update their own row", async () => {
      const result = await asUser(db, A, (tx) =>
        tx.query(`update public.${table} set ${setClause(spec.update)} where id = $${Object.keys(spec.update).length + 1}`, [
          ...Object.values(spec.update),
          alice.rowIds[table],
        ]),
      );
      expect(result.affectedRows).toBe(1);
    });
  } else {
    it("denies updates, even to the owner's own row", async () => {
      await expect(
        asUser(db, A, (tx) =>
          tx.query(`update public.${table} set ${setClause(spec.update)} where id = $${Object.keys(spec.update).length + 1}`, [
            ...Object.values(spec.update),
            alice.rowIds[table],
          ]),
        ),
      ).rejects.toThrow(PERMISSION_DENIED);
    });
  }

  it("blocks the owner from reassigning their row to another creator", async () => {
    await expect(
      asUser(db, A, (tx) =>
        tx.query(`update public.${table} set ${ownerCol} = $1 where id = $2`, [B, alice.rowIds[table]]),
      ),
    ).rejects.toThrow(DENIED);
  });

  if (can("delete")) {
    it("does not delete another creator's row", async () => {
      const result = await asUser(db, B, (tx) =>
        tx.query(`delete from public.${table} where id = $1`, [alice.rowIds[table]]),
      );
      expect(result.affectedRows).toBe(0);
    });

    it("lets the owner delete their own row", async () => {
      const result = await asUser(db, A, (tx) =>
        tx.query(`delete from public.${table} where id = $1`, [alice.rowIds[table]]),
      );
      expect(result.affectedRows).toBe(1);
    });
  } else {
    it("denies deletes, even of the owner's own row", async () => {
      await expect(
        asUser(db, A, (tx) => tx.query(`delete from public.${table} where id = $1`, [alice.rowIds[table]])),
      ).rejects.toThrow(PERMISSION_DENIED);
    });
  }

  if (!can("insert")) {
    it("denies inserts, even of the owner's own row", async () => {
      await expect(asUser(db, A, (tx) => insertRow(tx, table, spec.payload(alice)))).rejects.toThrow(
        PERMISSION_DENIED,
      );
    });
  }

  it("gives anon no access", async () => {
    await expect(asAnon(db, (tx) => tx.query(`select 1 from public.${table}`))).rejects.toThrow(
      PERMISSION_DENIED,
    );
    await expect(asAnon(db, (tx) => insertRow(tx, table, spec.payload(alice)))).rejects.toThrow(
      PERMISSION_DENIED,
    );
  });

  it("shows nothing to a token without a subject", async () => {
    const { rows } = await asSubjectless(db, (tx) => tx.query(`select 1 from public.${table}`));
    expect(rows).toHaveLength(0);
  });

  it("lets service_role read every creator's rows", async () => {
    const { rows } = await asService(db, (tx) =>
      tx.query<{ owner: string }>(`select distinct ${ownerCol} as owner from public.${table}`),
    );
    expect(rows.map((r) => r.owner).sort()).toEqual([A, B]);
  });
});

describe("cross-creator references", () => {
  it("rejects a content version attached to another creator's item", async () => {
    await expect(
      asUser(db, A, (tx) =>
        insertRow(tx, "content_versions", {
          user_id: A,
          content_item_id: bob.itemId,
          version_no: 9,
          source: "user",
        }),
      ),
    ).rejects.toThrow(FK_VIOLATION);
  });

  it("rejects a content item pointing at another creator's idea or pillar", async () => {
    await expect(
      asUser(db, A, (tx) => insertRow(tx, "content_items", { user_id: A, title: "x", idea_id: bob.ideaId })),
    ).rejects.toThrow(FK_VIOLATION);
    await expect(
      asUser(db, A, (tx) =>
        insertRow(tx, "content_items", { user_id: A, title: "x", pillar_id: bob.pillarId }),
      ),
    ).rejects.toThrow(FK_VIOLATION);
  });

  it("rejects an idea under another creator's pillar", async () => {
    await expect(
      asUser(db, A, (tx) =>
        insertRow(tx, "content_ideas", { user_id: A, topic: "x", pillar_id: bob.pillarId }),
      ),
    ).rejects.toThrow(FK_VIOLATION);
  });

  it("rejects analytics and assets on another creator's item", async () => {
    await expect(
      asUser(db, A, (tx) =>
        insertRow(tx, "analytics_snapshots", { user_id: A, content_item_id: bob.itemId, views: 1 }),
      ),
    ).rejects.toThrow(FK_VIOLATION);
    await expect(
      asUser(db, A, (tx) =>
        insertRow(tx, "assets", {
          user_id: A,
          content_item_id: bob.itemId,
          name: "x",
          mime_type: "image/png",
          size_bytes: 1,
          storage_path: "x/y.png",
        }),
      ),
    ).rejects.toThrow(FK_VIOLATION);
  });

  it("rejects re-pointing an own item at another creator's idea", async () => {
    await expect(
      asUser(db, A, (tx) =>
        tx.query("update public.content_items set idea_id = $1 where id = $2", [bob.ideaId, alice.itemId]),
      ),
    ).rejects.toThrow(FK_VIOLATION);
  });

  it("rejects usage attributed to another creator's generation, even from the server", async () => {
    await expect(
      asService(db, (tx) =>
        insertRow(tx, "usage_events", { user_id: A, event_type: "x", ai_generation_id: bob.generationId }),
      ),
    ).rejects.toThrow(FK_VIOLATION);
  });
});

describe("owner happy path", () => {
  it("lets a new creator build their workspace and read it back", async () => {
    const C = "user_carol";
    await asUser(db, C, async (tx) => {
      await insertRow(tx, "users", { id: C, display_name: "Carol" });
      await insertRow(tx, "creator_profiles", { user_id: C, niche: "Gardening" });
      await insertRow(tx, "brand_profiles", { user_id: C, tone: "calm" });
      const pillar = await insertRow(tx, "content_pillars", { user_id: C, name: "Basics" });
      const idea = await insertRow(tx, "content_ideas", { user_id: C, topic: "Soil", pillar_id: pillar.id });
      const item = await insertRow(tx, "content_items", {
        user_id: C,
        title: "Soil 101",
        idea_id: idea.id,
        pillar_id: pillar.id,
      });
      await insertRow(tx, "content_versions", {
        user_id: C,
        content_item_id: item.id,
        version_no: 1,
        source: "user",
        content: JSON.stringify({ hook: "Your soil is lying to you" }),
      });
      await insertRow(tx, "analytics_snapshots", { user_id: C, content_item_id: item.id, views: 42 });
      await insertRow(tx, "competitors", { user_id: C, platform: "youtube", url: "https://example.com" });
      await insertRow(tx, "research_signals", { user_id: C, source: "manual", signal_type: "question" });
      await insertRow(tx, "creator_insights", { user_id: C, insight_type: "topic", summary: "Soil works" });
      await insertRow(tx, "assets", {
        user_id: C,
        name: "a.png",
        mime_type: "image/png",
        size_bytes: 10,
        storage_path: `${C}/a.png`,
      });

      const { rows } = await tx.query<{ hook: string }>(
        "select content ->> 'hook' as hook from public.content_versions where content_item_id = $1",
        [item.id],
      );
      expect(rows).toEqual([{ hook: "Your soil is lying to you" }]);
    });
  });
});

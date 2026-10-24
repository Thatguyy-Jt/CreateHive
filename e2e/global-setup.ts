import { existsSync } from "node:fs";
import { clerkSetup } from "@clerk/testing/playwright";
import { createClient } from "@supabase/supabase-js";

// Runs once before the suite. Loads .env.local, refuses production Clerk keys,
// gets a Clerk testing token, and resets the dedicated test creator's data so
// every run starts from a fresh account. Only that creator is ever touched.
//
// App modules (`lib/`) import `server-only` and Sentry, so the two calls
// needed here are made directly.

function loadEnv() {
  if (!existsSync(".env.local")) return;
  const shell = { ...process.env };
  process.loadEnvFile(".env.local");
  // Values set in the shell win over the file.
  Object.assign(process.env, shell);
}

async function findTestUserId(email: string, secretKey: string): Promise<string> {
  const url = `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${secretKey}` } });
  if (!response.ok) throw new Error(`E2E setup: Clerk user lookup failed (HTTP ${response.status}).`);
  const users = (await response.json()) as { id: string }[];
  if (users.length !== 1) {
    throw new Error(
      `E2E setup: E2E_CLERK_USER_EMAIL must match exactly one user in the Clerk development instance (found ${users.length}).`,
    );
  }
  return users[0].id;
}

/** Deletes the creator's `users` row; every creator table cascades from it. The Clerk user is kept. */
async function resetCreatorData(userId: string) {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("E2E setup: SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  // The test creator must never hold a live subscription: deleting it here
  // would leave a card renewing (the app's own deletion stops it first).
  const sub = await db.from("subscriptions").select("provider_subscription_id, status").eq("user_id", userId).maybeSingle();
  if (sub.error) throw new Error(`E2E setup: reading the test creator's plan failed (${sub.error.code}).`);
  if (sub.data?.provider_subscription_id && sub.data.status !== "canceled") {
    throw new Error("E2E setup: the test creator has a Paystack subscription. Cancel it in Settings › Billing first.");
  }

  const deleted = await db.from("users").delete().eq("id", userId);
  if (deleted.error) throw new Error(`E2E setup: resetting the test creator failed (${deleted.error.code}).`);
}

export default async function globalSetup() {
  loadEnv();

  const secretKey = process.env.CLERK_SECRET_KEY ?? "";
  if (secretKey.startsWith("sk_live_")) {
    throw new Error("E2E setup: refusing to run against a production Clerk instance (sk_live_ key).");
  }

  const email = process.env.E2E_CLERK_USER_EMAIL?.trim();
  if (email) {
    if (!secretKey) throw new Error("E2E setup: CLERK_SECRET_KEY is required to sign in the test creator.");
    await resetCreatorData(await findTestUserId(email, secretKey));
  }

  await clerkSetup();
}

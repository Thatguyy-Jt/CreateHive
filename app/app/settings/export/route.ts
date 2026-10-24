import { auth } from "@clerk/nextjs/server";
import { logEvent } from "@/lib/observability/log";
import { exportCreatorData } from "@/lib/services/account-data";
import { createUserClient } from "@/lib/supabase/server";

const FAILED = "We couldn't export your data right now. Try again in a minute.";

/** Everything stored for the signed-in creator, as one JSON file. RLS limits it to their own rows. */
export async function GET() {
  const { userId } = await auth.protect();

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "account_export_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return new Response(FAILED, { status: 500 });
  }

  const now = Date.now();
  const result = await exportCreatorData(client, userId, now);
  if (!result.ok) return new Response(FAILED, { status: 500 });

  const date = new Date(now).toISOString().slice(0, 10);
  return new Response(JSON.stringify(result.data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="createhive-data-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

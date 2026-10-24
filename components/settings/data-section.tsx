import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import { hasRenewingPlan } from "@/lib/services/account-data";
import { createUserClient } from "@/lib/supabase/server";
import { DeleteAccountControl } from "./delete-account-control";
import { SectionSkeleton } from "./section-skeleton";

async function DeleteAccount() {
  const { userId } = await auth.protect();
  let renewing = false;
  try {
    renewing = await hasRenewingPlan(createUserClient(), userId);
  } catch {
    // Copy only: the server still stops any renewal before deleting.
  }
  return <DeleteAccountControl hasRenewingPlan={renewing} />;
}

export function DataSection() {
  return (
    <section className="card stack-sm" aria-labelledby="settings-data">
      <h2 id="settings-data" className="text-heading">
        Your data
      </h2>
      <div className="stack-sm">
        <h3 className="text-base font-bold">Download your data</h3>
        <p className="field-help">
          One JSON file with your profile, brand voice, strategy, ideas, Studio drafts and versions, posts, results,
          diagnoses, insights, research signals, plan and payments, and your AI usage record.
        </p>
        <div>
          <a href="/app/settings/export" download className="btn btn-secondary w-full min-[480px]:w-auto">
            Download my data
          </a>
        </div>
      </div>
      <Suspense fallback={<SectionSkeleton />}>
        <DeleteAccount />
      </Suspense>
    </section>
  );
}

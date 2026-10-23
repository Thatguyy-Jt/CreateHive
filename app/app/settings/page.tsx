import type { Metadata } from "next";
import { AccountSection } from "@/components/settings/account-section";
import { AiUsageSection } from "@/components/settings/ai-usage-section";
import { PrivacySection } from "@/components/settings/privacy-section";
import { TimezoneSection } from "@/components/settings/timezone-section";

export const metadata: Metadata = { title: "Settings" };

// The section frames are static. Each section's session-bound data sits behind
// its own Suspense and calls `auth.protect()` itself.
export default function SettingsPage() {
  return (
    <div className="stack-lg max-w-2xl">
      <AccountSection />
      <TimezoneSection />
      <AiUsageSection />
      <PrivacySection />
    </div>
  );
}

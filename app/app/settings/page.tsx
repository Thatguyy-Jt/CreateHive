import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { AccountSection } from "@/components/settings/account-section";
import { AiUsageSection } from "@/components/settings/ai-usage-section";
import { PrivacySection } from "@/components/settings/privacy-section";
import { TimezoneSection } from "@/components/settings/timezone-section";

export const metadata: Metadata = { title: "Settings" };

// The heading and section frames are static. Each section's session-bound data
// sits behind its own Suspense and calls `auth.protect()` itself.
export default function SettingsPage() {
  return (
    <div className="stack-lg max-w-2xl">
      <PageHeader
        icon="settings"
        title="Settings"
        description="Your account, your timezone, your AI usage, and how your data is handled."
      />
      <AccountSection />
      <TimezoneSection />
      <AiUsageSection />
      <PrivacySection />
    </div>
  );
}

import type { Metadata } from "next";
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
      <div className="stack-sm">
        <h1>Settings</h1>
        <p className="lead">Your account, your timezone, your AI usage, and how your data is handled.</p>
      </div>
      <AccountSection />
      <TimezoneSection />
      <AiUsageSection />
      <PrivacySection />
    </div>
  );
}

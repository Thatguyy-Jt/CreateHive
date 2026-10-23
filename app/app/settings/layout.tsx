import { Suspense, type ReactNode } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { SettingsTabs, SettingsTabsFallback } from "@/components/settings/settings-tabs";

// Static frame shared by General and Billing; each page loads its own data.
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="stack-lg">
      <PageHeader
        icon="settings"
        title="Settings"
        description="Your account, your plan and billing, and how your data is handled."
      />
      <Suspense fallback={<SettingsTabsFallback />}>
        <SettingsTabs />
      </Suspense>
      {children}
    </div>
  );
}

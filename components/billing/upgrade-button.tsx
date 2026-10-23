import Link from "next/link";

/** Where every "Upgrade to Pro" goes: Settings › Billing, with the Pro card focused. */
export const UPGRADE_HREF = "/app/settings/billing?plan=pro";

/** "Upgrade to Pro", shown when a Free allowance is used up or a feature is Pro-only. */
export function UpgradeButton({ variant = "primary" }: { variant?: "primary" | "link" }) {
  if (variant === "link") {
    return (
      <Link href={UPGRADE_HREF} className="link font-semibold">
        Upgrade to Pro
      </Link>
    );
  }
  return (
    <div>
      <Link href={UPGRADE_HREF} className="btn btn-primary btn-sm">
        Upgrade to Pro
      </Link>
    </div>
  );
}

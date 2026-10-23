import { redirect } from "next/navigation";

// Billing lives in Settings. Kept so older links still land in the right place.
export default function BillingRedirect() {
  redirect("/app/settings/billing");
}

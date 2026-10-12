import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import { AuthCardLayout } from "@/components/auth/auth-card-layout";

export const metadata: Metadata = { title: "Create your account" };

export default function SignUpPage() {
  return (
    <AuthCardLayout>
      {/* New creators start with onboarding; an explicit redirect_url still wins. */}
      <SignUp fallbackRedirectUrl="/onboarding" />
    </AuthCardLayout>
  );
}

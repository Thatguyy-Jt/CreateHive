import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { AuthCardLayout } from "@/components/auth/auth-card-layout";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <AuthCardLayout>
      <SignIn />
    </AuthCardLayout>
  );
}

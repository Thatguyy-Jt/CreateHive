import Link from "next/link";
import { Logo } from "@/components/marketing/logo";

// A focused setup flow outside the /app shell: logo only, no sidebar.
export default function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="container-narrow py-6">
        <Link href="/app" aria-label="CreateHive dashboard" className="inline-flex">
          <Logo />
        </Link>
      </header>
      <main id="main" className="container-narrow flex-1 pb-16 md:pb-24">
        {children}
      </main>
    </>
  );
}

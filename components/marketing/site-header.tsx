import Link from "next/link";
import { announcement, navLinks } from "@/lib/marketing/sample-data";
import { AuthActions } from "./auth-actions";
import { Logo } from "./logo";

export function SiteHeader() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="announcement-bar">{announcement}</div>
      <header className="site-header">
        <div className="container-page site-header-inner">
          <Link href="/" aria-label="CreateHive home">
            <Logo />
          </Link>
          <nav className="site-header-nav text-sm font-semibold" aria-label="Main">
            {navLinks.map((link) => (
              <a key={link.href} className="link no-underline hover:underline" href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className="site-header-actions">
            <AuthActions size="sm" showSignIn showUserButton className="hidden sm:flex" />
            <details className="disclosure site-header-menu-button relative">
              <summary className="btn btn-ghost btn-sm" aria-label="Menu">
                <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
                Menu
              </summary>
              <nav
                aria-label="Mobile"
                className="card shadow-float absolute right-0 top-full z-50 mt-2 grid w-60 gap-1 p-3 md:p-3"
              >
                {navLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="rounded-sm px-3 py-3 font-semibold hover:bg-surface-muted"
                  >
                    {link.label}
                  </a>
                ))}
                <AuthActions showSignIn className="px-3 pt-2 sm:hidden" />
              </nav>
            </details>
          </div>
        </div>
      </header>
    </>
  );
}

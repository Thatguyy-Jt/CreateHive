import { navLinks } from "@/lib/marketing/sample-data";
import { Logo } from "./logo";

async function CurrentYear() {
  "use cache";
  return new Date().getFullYear();
}

export function SiteFooter() {
  return (
    <footer className="section-sm border-t border-border">
      <div className="container-page grid gap-8 md:grid-cols-[1fr_auto] md:items-start">
        <div className="stack-sm max-w-sm">
          <Logo />
          <p className="text-sm text-muted-foreground">
            The AI strategist that helps creators decide what to make, and learns from every post.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} className="link no-underline hover:underline">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:justify-between md:col-span-2">
          <p>
            © <CurrentYear /> CreateHive
          </p>
          <p>
            Photos from{" "}
            <a className="link" href="https://unsplash.com" rel="noopener noreferrer" target="_blank">
              Unsplash
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}

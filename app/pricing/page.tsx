import type { Metadata } from "next";
import Link from "next/link";
import { PlanCard } from "@/components/billing/plan-card";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { Comparison } from "@/components/pricing/comparison";
import { PlanCta } from "@/components/pricing/plan-cta";
import { PLAN_ALLOWANCES } from "@/lib/billing/features";
import { formatNaira, readPlanCatalog } from "@/lib/billing/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "CreateHive is free to start. Pro gives you more content packages, idea batches and post diagnoses each month, plus YouTube research. Prices in naira.",
};

const PAYMENT_METHOD = {
  title: "Card through Paystack",
  body: "Visa, Mastercard or Verve. Renews monthly until you cancel. Cancel any time and keep Pro until the end of the month you paid for.",
};

function faqs(proPrice: string) {
  const free = PLAN_ALLOWANCES.free;
  return [
    {
      q: "What counts as a use?",
      a: `Each time the AI creates something for you: a content package, a batch of ideas, a section rewrite, a post diagnosis and so on. Free includes ${free.content_package} content packages a month; Pro is ${proPrice} a month for many more. Uses that fail because of a problem on our side don't count.`,
    },
    {
      q: "What happens when I reach a limit?",
      a: "That feature pauses until older uses pass 30 days. Everything else keeps working: your strategy, ideas, calendar, drafts and analytics stay right where they are. On Free, you can upgrade to Pro at that moment.",
    },
    {
      q: "Can I cancel?",
      a: "Yes. Your subscription stops renewing and you keep Pro until the end of the month you paid for.",
    },
    {
      q: "Do unused uses roll over?",
      a: "No. Allowances are a rolling 30-day window, so each use frees up 30 days after you used it.",
    },
    {
      q: "Does CreateHive store my card?",
      a: "No. Paystack holds your card details. We only keep its brand, last four digits and expiry date so you can see which card you pay with.",
    },
  ];
}

export default function PricingPage() {
  const { plans } = readPlanCatalog();
  const proPrice = formatNaira(plans.pro.priceNaira);

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <section className="section">
          <div className="container-page stack-lg">
            <div className="stack-sm mx-auto max-w-2xl text-center">
              <p className="eyebrow">Pricing</p>
              <h1>
                Start free. <span className="accent-word">Upgrade</span> when you&apos;re posting more.
              </h1>
              <p className="lead">
                Free shows you the whole loop with your own content. Pro is for creators posting most days who want a
                package and a diagnosis for every post.
              </p>
              <p className="text-sm text-muted-foreground">Prices in Nigerian naira. Cancel any time.</p>
            </div>
            <div className="mx-auto grid w-full max-w-3xl gap-4 md:grid-cols-2">
              <PlanCard plan={plans.free} headingLevel="h2" cta={<PlanCta plan="free" />} />
              <PlanCard plan={plans.pro} headingLevel="h2" cta={<PlanCta plan="pro" />} />
            </div>
          </div>
        </section>

        <Comparison plans={plans} />

        <section className="section border-t border-border" aria-labelledby="pay-heading">
          <div className="container-page stack-lg">
            <div className="stack-sm max-w-2xl">
              <p className="eyebrow">Paying</p>
              <h2 id="pay-heading">How you pay for Pro</h2>
            </div>
            <div className="card stack-sm max-w-xl">
              <h3 className="text-xl">{PAYMENT_METHOD.title}</h3>
              <p className="text-muted-foreground">{PAYMENT_METHOD.body}</p>
            </div>
          </div>
        </section>

        <section className="section border-t border-border" aria-labelledby="pricing-faq-heading">
          <div className="container-narrow stack-lg">
            <div className="stack-sm text-center">
              <p className="eyebrow">Billing FAQ</p>
              <h2 id="pricing-faq-heading">
                Questions about <span className="accent-word">plans</span>
              </h2>
            </div>
            <div className="border-t border-border">
              {faqs(proPrice).map((item) => (
                <details key={item.q} className="disclosure faq-item border-b border-border">
                  <summary className="flex min-h-14 items-center justify-between gap-4 py-5 text-lg font-bold">
                    {item.q}
                  </summary>
                  <p className="pb-6 text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="section-lg section-tint-butter">
          <div className="container-narrow stack-md items-center text-center">
            <h2 className="text-display-lg">
              Try it on your <span className="accent-word">next post</span>.
            </h2>
            <p className="lead max-w-xl">Start on Free. Upgrade from Settings whenever you&apos;re ready.</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/sign-up" className="btn btn-primary btn-lg">
                Start free
              </Link>
              <Link href="/#how-it-works" className="btn btn-secondary btn-lg">
                See how it works
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

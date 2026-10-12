import { Creators } from "@/components/marketing/creators";
import { Faq } from "@/components/marketing/faq";
import { FeatureSplits } from "@/components/marketing/feature-splits";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { InsightBand } from "@/components/marketing/insight-band";
import { PlatformStrip } from "@/components/marketing/platform-strip";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <Hero />
        <PlatformStrip />
        <HowItWorks />
        <FeatureSplits />
        <InsightBand />
        <Creators />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}

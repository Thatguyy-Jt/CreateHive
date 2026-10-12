import { faqs } from "@/lib/marketing/sample-data";

export function Faq() {
  return (
    <section id="faq" className="section scroll-mt-20 border-t border-border">
      <div className="container-narrow stack-lg">
        <div className="stack-sm text-center">
          <p className="eyebrow">FAQ</p>
          <h2>
            Questions, <span className="accent-word">answered</span>
          </h2>
        </div>
        <div className="border-t border-border">
          {faqs.map((item) => (
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
  );
}

import { AuthActions } from "./auth-actions";

export function FinalCta() {
  return (
    <section className="section-lg section-tint-butter">
      <div className="container-narrow stack-md items-center text-center">
        <h2 className="text-display-lg">
          Stop guessing. Start <span className="accent-word">growing</span>.
        </h2>
        <p className="lead max-w-xl">
          CreateHive is being built for creators who want a clear plan and honest feedback.
          Create your account to get started.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <AuthActions size="lg" />
          <a href="#how-it-works" className="btn btn-secondary btn-lg">
            See how it works
          </a>
        </div>
      </div>
    </section>
  );
}

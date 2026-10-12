import { auth, currentUser } from "@clerk/nextjs/server";
import { Suspense } from "react";
import { ManageAccountButton } from "./manage-account-button";
import { SectionSkeleton } from "./section-skeleton";

async function AccountDetails() {
  await auth.protect();
  const user = await currentUser();
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  const email = user?.primaryEmailAddress?.emailAddress;

  if (!name && !email) return <p>Signed in</p>;

  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
      {name ? (
        <div className="contents">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="[overflow-wrap:anywhere]">{name}</dd>
        </div>
      ) : null}
      {email ? (
        <div className="contents">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="[overflow-wrap:anywhere]">{email}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export function AccountSection() {
  return (
    <section className="card stack-sm" aria-labelledby="settings-account">
      <h2 id="settings-account" className="text-heading">
        Account
      </h2>
      <Suspense fallback={<SectionSkeleton />}>
        <AccountDetails />
      </Suspense>
      <p className="text-muted-foreground">Change your name, email, password and connected accounts.</p>
      <div>
        <ManageAccountButton />
      </div>
    </section>
  );
}

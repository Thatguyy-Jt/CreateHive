// Static, but must stay true: each statement matches what the code does today.
// Update the text whenever data handling changes.
export function PrivacySection() {
  return (
    <section className="card stack-sm" aria-labelledby="settings-privacy">
      <h2 id="settings-privacy" className="text-heading">
        Data and privacy
      </h2>
      <ul className="stack-sm list-disc pl-5">
        <li>
          We store your account email, your creator profile and brand voice, the strategy we generate for you, and a
          record of each AI generation: what kind it was, which model ran, when, how many tokens it used and what it cost. That
          record never includes your prompts or the AI&apos;s replies.
        </li>
        <li>
          To produce a result, the details you submit (for your strategy: your profile and brand voice, never your
          name or email) are sent to OpenAI. We ask OpenAI not to store those responses.
        </li>
        <li>
          If something breaks, an error report goes to our monitoring service (Sentry) with cookies, request details
          and your account removed. Page views are measured with Vercel Analytics, which doesn&apos;t use cookies.
        </li>
        <li>
          Downloading your data: <span className="text-muted-foreground">Coming later</span>
        </li>
        <li>
          Deleting your account and data: <span className="text-muted-foreground">Coming later</span>
        </li>
      </ul>
    </section>
  );
}

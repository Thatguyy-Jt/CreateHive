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
          We store your account email, your creator profile and brand voice, the strategy and content ideas we generate
          for you, and a record of each AI generation: what kind it was, which model ran, when, how many tokens it used
          and what it cost. That record never includes your prompts or the AI&apos;s replies.
        </li>
        <li>
          We store the timezone you confirm and the ideas you put on your calendar, with their dates, so your week shows
          in your own time. Removing an item from your calendar deletes it, unless it already has content you wrote for
          it. Only you can see them.
        </li>
        <li>
          We store each content package we create for you in Studio, and every earlier package for the same item,
          until that item is deleted. Only you can see them.
        </li>
        <li>
          We store the research signals you paste until you delete them. YouTube videos fetched for you are deleted
          after 7 days. To look them up, we send YouTube your niche and one content pillar, nothing else.
        </li>
        <li>
          To produce a result, the details you submit are sent to OpenAI: for your strategy, your profile and brand
          voice; for content ideas, also your strategy, pillars, the topics of your earlier ideas and a short excerpt of
          up to 12 research signals; for a suggested week, your posting capacity, platforms, your strategy&apos;s cadence
          and weekly theme, what&apos;s already on that week, and the topic, pillar, format and hook of up to 30 saved
          ideas; for a content package, your profile, brand voice, pillars and strategy, the titles of your recent
          content, your performance snapshots and learned insights, and the idea&apos;s topic, audience, angle, hook,
          call to action and evidence summaries. Never your name or email. We ask OpenAI not to store those responses.
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

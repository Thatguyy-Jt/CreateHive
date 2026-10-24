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
          We store each content package we create for you in Studio, every edit you save and every earlier version
          of it, until you discard that item. Discarding a draft deletes it and all its versions. Only you can see them.
        </li>
        <li>
          We store the posts you mark as published or log in Analytics (title, platform, format, date, link, the hook you
          used and the length), every set of results you enter for them and every AI diagnosis of them, until you
          delete that post. Deleting a post deletes its results and diagnoses, and its Studio package if it has one. We
          never open your links. Only you can see them.
        </li>
        <li>
          We store your learned insights (each pattern, its next step and the posts it rests on) until you delete your
          account. Dismissed and replaced insights are kept so the same pattern isn&apos;t suggested again. Active
          insights are included when we suggest ideas and write content packages.
        </li>
        <li>
          We store the research signals you paste until you delete them. YouTube videos fetched for you are deleted
          after 7 days. To look them up, we send YouTube your niche and one content pillar, nothing else.
        </li>
        <li>
          To produce a result, the details you submit are sent to OpenAI: for your strategy, your profile and brand
          voice; for content ideas, also your strategy, pillars, the titles of your recent content, your recent posts&apos; results compared with your usual, your
          learned insights, the topics of your earlier ideas and a short excerpt of up to 12 research signals; for a suggested week, your posting capacity, platforms, your strategy&apos;s cadence
          and weekly theme, what&apos;s already on that week, and the topic, pillar, format and hook of up to 30 saved
          ideas; for a content package, your profile, brand voice, pillars and strategy, the titles of your recent
          content, your recent posts&apos; results compared with your usual and your learned insights, and the idea&apos;s topic, audience, angle, hook,
          call to action and evidence summaries; to regenerate one section, the same plus your current package and
          the change you asked for, if any; to diagnose a post, your profile, brand voice, pillars and strategy, the
          post&apos;s title, format, pillar, posting day and hour, the hook you used, its length, its results and your
          usual numbers, its idea and the planned hook and call to action from its package, and the titles, formats,
          hooks, lengths and results of up to 12 of your other posts on that platform; to update your insights, your
          profile, pillars and strategy, the titles, formats, pillars, hooks, lengths, posting day and hour and results
          of up to 30 of your posts with week-old results, your usual numbers, short summaries of their diagnoses, and
          your current and dismissed insights. The links you record for
          published posts are never sent. Never your name or email. We ask OpenAI not to store those responses.
        </li>
        <li>
          If something breaks, an error report goes to our monitoring service (Sentry) with cookies, request details
          and your account removed. Page views are measured with Vercel Analytics, which doesn&apos;t use cookies.
        </li>
        <li>
          You can download all of this as one file from <strong>Your data</strong> below.
        </li>
        <li>
          Deleting your account (below) stops any Pro renewal, then permanently deletes your account, your login and
          everything listed here, including your payment records (Paystack keeps its own). Deleting your account from
          the account settings window does the same.
        </li>
      </ul>
    </section>
  );
}

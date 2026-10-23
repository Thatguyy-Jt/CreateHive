// Sample content for the CreateHive marketing homepage.
// Every mockup that renders this data is labelled "Sample" in the UI:
// none of it represents real creators, real metrics or real users.

const unsplash = (id: string) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1600&q=80`;

export type Photo = { src: string; alt: string };

export const photos = {
  hero: {
    src: unsplash("1542038784456-1ea8e935640e"),
    alt: "A creator holding a camera out toward the viewer in an autumn forest",
  },
  strategy: {
    src: unsplash("1522202176988-66273c2fd55f"),
    alt: "Three people planning together around laptops at a café table",
  },
  studio: {
    src: unsplash("1598550476439-6847785fcea6"),
    alt: "A home recording setup with a camera on a tripod, monitors and lighting",
  },
} satisfies Record<string, Photo>;

export const announcement =
  "CreateHive is in early development. Follow along as we build.";

// Absolute, so the section links also work from /pricing.
export const navLinks = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/#creators", label: "Creators" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

export const platforms = ["YouTube", "TikTok", "Instagram", "LinkedIn", "X", "Podcasts"];

export const todaysPlan = {
  date: "Thursday",
  tasks: [
    { label: "Film: 3 morning-routine mistakes", done: true },
    { label: "Write caption + CTA", done: false },
    { label: "Log last week's results", done: false },
  ],
};

export const topOpportunity = {
  topic: "Budget meal prep for night-shift workers",
  audienceNeed: "Eating well on a rotating schedule",
  angle: "One 45-minute prep that covers a full 3-shift week",
  hook: "I work nights. This is the only meal prep that survived my schedule.",
  format: "60s vertical video",
  evidence: [
    "Asked 14 times in your comments last month",
    "Your recipe posts get 1.8× your median saves",
    "Few creators in your niche cover shift workers",
  ],
  signals: [
    { label: "Audience fit", value: 86 },
    { label: "Evidence strength", value: 72 },
    { label: "Content gap", value: 64 },
  ],
};

export const steps = [
  {
    n: "01",
    title: "Profile",
    body: "Tell CreateHive your niche, audience, goals and how often you can post.",
  },
  {
    n: "02",
    title: "Opportunities",
    body: "Get specific ideas with the evidence behind them, not vague trend lists.",
  },
  {
    n: "03",
    title: "Create",
    body: "Turn an idea into hooks, a script, a shot list and a caption in your voice.",
  },
  {
    n: "04",
    title: "Measure",
    body: "Log how each post performed, compared with your own baseline.",
  },
  {
    n: "05",
    title: "Learn",
    body: "See what's working for you, and let it shape your next recommendations.",
  },
];

export const pillars = [
  { name: "Budget recipes", share: 40 },
  { name: "Shift-work wellness", share: 25 },
  { name: "Kitchen basics", share: 20 },
  { name: "Behind the scenes", share: 15 },
];

export const contentPackage = {
  title: "Budget meal prep for night-shift workers",
  tabs: ["Hooks", "Script", "Shot list", "Caption"],
  hooks: [
    "I work nights. This is the only meal prep that survived my schedule.",
    "Three shifts, one shopping trip, £24.",
    "Stop prepping breakfast food for a 7pm 'morning'.",
  ],
};

export const baseline = {
  post: "3 morning-routine mistakes",
  metrics: [
    { label: "Views", delta: 42 },
    { label: "Watch time", delta: 18 },
    { label: "Saves", delta: -9 },
  ],
  diagnosis:
    "The hook landed: viewers stayed 18% longer than usual. Saves dipped, likely because there was no takeaway to come back to.",
  nextExperiment: "End your next video with a 3-step checklist on screen.",
};

export const learnedPatterns = [
  {
    pattern: "Hooks that name a specific mistake outperform question hooks",
    basis: "Based on 6 posts",
  },
  {
    pattern: "45–60s videos keep viewers longer than your 90s+ videos",
    basis: "Based on 9 posts",
  },
  {
    pattern: "Recipe posts drive most of your saves",
    basis: "Based on 11 posts",
  },
];

export const features = [
  {
    id: "strategy",
    eyebrow: "Strategy",
    title: ["A plan built around", "you", ""],
    lead: "CreateHive turns your niche, audience and goals into a strategy you can actually follow, and keeps it up to date.",
    points: [
      "Positioning and audience profile",
      "3–5 content pillars with a suggested mix",
      "A realistic 30-day plan for your posting capacity",
    ],
  },
  {
    id: "opportunities",
    eyebrow: "Opportunities",
    title: ["Ideas with the", "evidence", "attached"],
    lead: "Every opportunity explains what to make, who it's for, why now, and the angle and format that fit.",
    points: [
      "Audience fit, evidence strength and content gap signals",
      "Sources you can check, never a made-up virality score",
      "One clear next step for each idea",
    ],
  },
  {
    id: "studio",
    eyebrow: "Content Studio",
    title: ["From idea to", "ready-to-film", ""],
    lead: "Go from an opportunity to a full content package written in your voice, then regenerate just the part you want to change.",
    points: [
      "Hooks, script, shot list and caption",
      "Titles, thumbnail concepts and CTAs",
      "Repurposing ideas for your other platforms",
    ],
  },
  {
    id: "analytics",
    eyebrow: "Analytics & diagnosis",
    title: ["Measured against", "your", "baseline"],
    lead: "Instead of generic benchmarks, CreateHive compares each post with your own history and explains the result in plain language.",
    points: [
      "Views, watch time, saves, shares and follower changes",
      "A plain-language diagnosis of what happened",
      "A concrete experiment to try next",
    ],
  },
] as const;

export const creatorTypes = [
  {
    title: "Aspiring YouTuber",
    body: "Pick a niche you can sustain and find your first ten videos worth making.",
    photo: {
      src: unsplash("1539571696357-5a69c17a67c6"),
      alt: "Portrait of a smiling young man wearing a black hat",
    },
  },
  {
    title: "UGC creator",
    body: "Plan brand-ready concepts and keep your hooks sharp across clients.",
    photo: {
      src: unsplash("1544005313-94ddf0286df2"),
      alt: "Portrait of a woman in a striped shirt outdoors at golden hour",
    },
  },
  {
    title: "Personal-brand builder",
    body: "Turn your expertise into a steady stream of posts people save and share.",
    photo: {
      src: unsplash("1573497019940-1c28c88b4f3e"),
      alt: "Portrait of a smiling professional woman in a striped blazer",
    },
  },
  {
    title: "Micro-creator",
    body: "Learn what your small, loyal audience responds to and do more of it.",
    photo: {
      src: unsplash("1531123897727-8f129e1688ce"),
      alt: "Portrait of a woman with short hair against a red background",
    },
  },
];

export const faqs = [
  {
    q: "Is CreateHive available yet?",
    a: "Not yet. CreateHive is in early development, and early access will open once the core workflow is reliable. Everything shown on this page uses sample data.",
  },
  {
    q: "Does CreateHive post to my accounts for me?",
    a: "No. There are no publishing integrations today. CreateHive helps you decide what to make and how to make it; you publish on your own platforms.",
  },
  {
    q: "How is this different from an AI writing tool?",
    a: "Writing tools generate text on request. CreateHive starts from your profile and your results, recommends what to make and why, and learns from how your posts actually perform.",
  },
  {
    q: "Where do the opportunity signals come from?",
    a: "From your own profile and performance data, plus permitted research sources. Each opportunity shows its evidence so you can judge it yourself.",
  },
  {
    q: "Do I need a big audience to use it?",
    a: "No. CreateHive is built for beginners and early-stage creators. It compares you with your own baseline, so it's useful from your first few posts.",
  },
];
